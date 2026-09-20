import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { analyzeAt, computeBundle } from "@/lib/analysis";
import { fetchKlines, fetchKlinesDeep, openMarketStream } from "@/lib/binance";
import type { KlineUpdate } from "@/lib/binance";
import { COINS, loadSelectedCoin, saveSelectedCoin } from "@/lib/coins";
import type { CoinConfig, CoinId } from "@/lib/coins";
import { gradeImport, loadImportAudit, parsePancakeCsv, saveImportAudit } from "@/lib/importCsv";
import type { ImportAudit, ImportOutcome } from "@/lib/importCsv";
import { pearson, returnsOf } from "@/lib/indicators";
import { computeLearning } from "@/lib/learning";
import type { LearningState } from "@/lib/learning";
import { computeNeuro } from "@/lib/neuro";
import type { NeuroState } from "@/lib/neuro";
import { computeCalibration } from "@/lib/calibration";
import type { CalibrationReport } from "@/lib/calibration";
import { evThreshold, normCdf } from "@/lib/core";
import { matchLiveCondition, searchConditions } from "@/lib/conditionSearch";
import type { ConditionProof } from "@/lib/conditionSearch";
import { bucketOf, fitTimeModel } from "@/lib/timeStructure";
import type { TimeStructureModel } from "@/lib/timeStructure";
import { fetchLiveChainRound } from "@/lib/pancake";
import type { ChainRound } from "@/lib/pancake";
import { loadPositions, savePositions } from "@/lib/positions";
import type { PositionSide, UserPosition } from "@/lib/positions";
import { computeRegime } from "@/lib/regime";
import type { RegimeKind, RegimeState } from "@/lib/regime";
import { computeRegimeAudit } from "@/lib/regimeAudit";
import type { RegimeAudit } from "@/lib/regimeAudit";
import { buildRegimeSeries, computeRegimeForecast } from "@/lib/regimeForecast";
import type { RegimeForecast, RegimePoint } from "@/lib/regimeForecast";
import { ROUND_MS, buildRecord, buildSeedRecords, loadLiveRecords, roundNumberOf, roundStartOf, saveLiveRecords } from "@/lib/rounds";
import { evaluatePlaybook } from "@/lib/wallstreet";
import type { PlaybookResult } from "@/lib/wallstreet";
import type { AlertItem, Analysis, Candle, RoundRecord } from "@/lib/types";

export interface LiveRound {
  startTime: number;
  closeTime: number;
  lockPrice: number;
  roundNumber: number;
  /** True when synced to the on-chain PancakeSwap round schedule. */
  synced: boolean;
}

export interface CorrelationPair {
  /** Display label, e.g. "ETH / BTC". */
  label: string;
  /** Pearson correlation of 60m returns (-1..1). */
  value: number;
}

export interface CorrelationState {
  pairs: CorrelationPair[];
}

/** Entry decision state for the NEXT (bettable) PancakeSwap round. */
export interface NextRoundState {
  /** Epoch of the round open for betting (null when chain sync unavailable). */
  epoch: number | null;
  /** Model probability the next round closes UP (0..100). */
  upProb: number;
  confidence: number;
  /** Live payout multipliers from the next round's pool (null when pool too small/unknown). */
  payoutUp: number | null;
  payoutDown: number | null;
  totalBnb: number | null;
  evUp: number;
  evDown: number;
  /** Directional side the model favors right now, if any. */
  side: "UP" | "DOWN" | null;
  /** Seconds the current side has been continuously held. */
  stableFor: number;
  /** True when inside the recommended entry window before lock. */
  entryWindow: boolean;
  action: "ENTER UP" | "ENTER DOWN" | "WAIT" | "STAND DOWN";
  reason: string;
  /** Live BTC behavioral regime driving the noise discount and entry gates. */
  regime: RegimeState;
  /** True when recent live calls have been losing — entry bars raised. */
  cold: boolean;
  coldHitRate: number;
  coldSample: number;
  /** Probability the next round closes UP before the time-structure adjustment (0..100). */
  rawUpProb: number;
  /** Minimal core decomposition of the current forecast (all terms in σ units). */
  core: Analysis["core"];
  /** Dynamic EV threshold currently enforced per 1 staked. */
  evGate: number;
  /** Label of the proven condition authorizing this side (null when none matched). */
  condition: string | null;
  /** True once at least one condition has proven forward on out-of-sample history. */
  conditionsKnown: boolean;
  /** Wall Street Playbook evaluation for this round. */
  playbook: PlaybookResult;
}

interface MarketContextValue {
  status: "loading" | "ready" | "error";
  connected: boolean;
  /** The coin the whole engine is currently tracking. */
  coin: CoinConfig;
  /** Switches the tracked market (BTC / BNB / ETH) — fully re-initializes the engine. */
  setCoin: (id: CoinId) => void;
  candles: Candle[];
  livePrice: number;
  analysis: Analysis | null;
  round: LiveRound | null;
  secondsLeft: number;
  records: RoundRecord[];
  alerts: AlertItem[];
  correlation: CorrelationState;
  nextRound: NextRoundState | null;
  learning: LearningState;
  /** Neuroplasticity brain state — synaptic trust per signal (display/telemetry). */
  neuro: NeuroState;
  /** Time-structure model — refit on every settled round, applied only when validated. */
  timeModel: TimeStructureModel;
  /** Calibration by probability bucket — recomputed on every settled round. */
  calibration: CalibrationReport | null;
  /** Condition ledger — discovered conditions with prove-forward status. */
  conditions: ConditionProof[];
  regimeForecast: RegimeForecast | null;
  /** Historical accuracy audit per regime × 15m-frame condition. */
  regimeAudit: RegimeAudit | null;
  /** Personal audit of the last imported PancakeSwap history CSV (per coin). */
  importAudit: ImportAudit | null;
  /** Imports a PancakeSwap history CSV — injects matched rounds as training data. */
  importCsvData: (text: string) => ImportOutcome;
  /** Positions the user manually locked in and logged for engine tracking. */
  positions: UserPosition[];
  /** Logs a locked-in position on the next bettable round. */
  logPosition: (side: PositionSide, amountBnb: number | null) => void;
  /** Removes a logged position that hasn't locked yet. */
  cancelPosition: (id: string) => void;
  retry: () => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

interface LiteBar {
  time: number;
  close: number;
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const [coinId, setCoinId] = useState<CoinId>(() => loadSelectedCoin());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [connected, setConnected] = useState<boolean>(false);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState<number>(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [round, setRound] = useState<LiveRound | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [records, setRecords] = useState<RoundRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [correlation, setCorrelation] = useState<CorrelationState>({ pairs: [] });
  const [nextRound, setNextRound] = useState<NextRoundState | null>(null);
  const [learning, setLearning] = useState<LearningState>(() => computeLearning([]));
  const [neuro, setNeuro] = useState<NeuroState>(() => computeNeuro([]));
  const [timeModel, setTimeModel] = useState<TimeStructureModel>(() => fitTimeModel([]));
  const [calibration, setCalibration] = useState<CalibrationReport | null>(null);
  const [conditions, setConditions] = useState<ConditionProof[]>([]);
  const [regimeForecast, setRegimeForecast] = useState<RegimeForecast | null>(null);
  const [regimeAudit, setRegimeAudit] = useState<RegimeAudit | null>(null);
  const [positions, setPositions] = useState<UserPosition[]>(() => loadPositions(COINS[loadSelectedCoin()].storageSuffix));
  const [importAudit, setImportAudit] = useState<ImportAudit | null>(() => loadImportAudit(COINS[loadSelectedCoin()].storageSuffix));
  const [attempt, setAttempt] = useState<number>(0);

  const coinRef = useRef<CoinConfig>(COINS[coinId]);
  const candlesRef = useRef<Candle[]>([]);
  const chainRoundRef = useRef<ChainRound | null>(null);
  const peerARef = useRef<LiteBar[]>([]);
  const peerBRef = useRef<LiteBar[]>([]);
  const priceRef = useRef<number>(0);
  const roundRef = useRef<LiveRound | null>(null);
  const lockAnalysisRef = useRef<Analysis | null>(null);
  const lockRegimeRef = useRef<RegimeState | null>(null);
  const learningRef = useRef<LearningState>(computeLearning([]));
  const neuroRef = useRef<NeuroState>(computeNeuro([]));
  const timeModelRef = useRef<TimeStructureModel>(fitTimeModel([]));
  const calibrationRef = useRef<CalibrationReport | null>(null);
  const conditionsRef = useRef<ConditionProof[]>([]);
  const entrySideRef = useRef<{ side: "UP" | "DOWN" | null; since: number }>({ side: null, since: 0 });
  const prevAnalysisRef = useRef<Analysis | null>(null);
  const recordsRef = useRef<RoundRecord[]>([]);
  const prevRegimeRef = useRef<RegimeKind | null>(null);
  const regimePointsRef = useRef<RegimePoint[]>([]);
  const alertKeysRef = useRef<Set<string>>(new Set());
  const positionsRef = useRef<UserPosition[]>(loadPositions(COINS[loadSelectedCoin()].storageSuffix));
  const nextRoundRef = useRef<NextRoundState | null>(null);
  const auditRef = useRef<RegimeAudit | null>(null);

  const pushAlert = useCallback(
    (roundStart: number, type: string, message: string, direction: AlertItem["direction"], severity: AlertItem["severity"]) => {
      const key = `${roundStart}:${type}`;
      if (alertKeysRef.current.has(key)) return;
      alertKeysRef.current.add(key);
      if (alertKeysRef.current.size > 400) alertKeysRef.current.clear();
      const item: AlertItem = { id: `${key}:${Date.now()}`, time: Date.now(), type, message, direction, severity };
      setAlerts((prev) => [item, ...prev].slice(0, 60));
      if (severity === "critical") {
        toast(message, { description: "Prediction Edge AI signal" });
      }
    },
    [],
  );

  const fireAlerts = useCallback(
    (a: Analysis, p: Analysis | null, rs: number) => {
      if (a.confidence >= 85 && (p?.confidence ?? 0) < 85) {
        pushAlert(rs, "conf85", `Confidence above 85% — ${a.recommendation === "DOWN" ? "DOWN" : a.recommendation === "UP" ? "UP" : "mixed"} bias`, a.totalScore >= 0 ? "bull" : "bear", "critical");
      } else if (a.confidence >= 75 && (p?.confidence ?? 0) < 75) {
        pushAlert(rs, "conf75", "Confidence crossed above 75%", a.totalScore >= 0 ? "bull" : "bear", "high");
      }
      if (a.volume.spike && !(p?.volume.spike ?? false)) {
        pushAlert(rs, "volspike", `Volume spike detected (${a.volume.relative.toFixed(1)}x average)`, a.candleDirection === "green" ? "bull" : "bear", "high");
      }
      if (a.consecGreen >= 3 && (p?.consecGreen ?? 0) < 3) {
        pushAlert(rs, "green3", `${a.consecGreen} consecutive green candles`, "bull", "info");
      }
      if (a.consecRed >= 3 && (p?.consecRed ?? 0) < 3) {
        pushAlert(rs, "red3", `${a.consecRed} consecutive red candles`, "bear", "info");
      }
      if (a.trend.cross === "golden" && p?.trend.cross !== "golden") {
        pushAlert(rs, "golden", "EMA 9/20 golden cross", "bull", "high");
      }
      if (a.trend.cross === "death" && p?.trend.cross !== "death") {
        pushAlert(rs, "death", "EMA 9/20 death cross", "bear", "high");
      }
      const prevRsi = p?.momentum.rsi ?? 50;
      if (prevRsi < 30 && a.momentum.rsi >= 30) {
        pushAlert(rs, "rsirev-up", "RSI reversal out of oversold", "bull", "high");
      }
      if (prevRsi > 70 && a.momentum.rsi <= 70) {
        pushAlert(rs, "rsirev-down", "RSI reversal out of overbought", "bear", "high");
      }
      if (a.upProbability >= 70 && a.confidence >= 70 && !((p?.upProbability ?? 0) >= 70 && (p?.confidence ?? 0) >= 70)) {
        pushAlert(rs, "strong-bull", `Strong bullish setup — UP probability ${a.upProbability}%`, "bull", "critical");
      }
      if (a.downProbability >= 70 && a.confidence >= 70 && !((p?.downProbability ?? 0) >= 70 && (p?.confidence ?? 0) >= 70)) {
        pushAlert(rs, "strong-bear", `Strong bearish setup — DOWN probability ${a.downProbability}%`, "bear", "critical");
      }
      if (a.fifth.coinFlip && !(p?.fifth?.coinFlip ?? false)) {
        pushAlert(
          rs,
          "coinflip",
          `Coin-flip zone — $${Math.abs(a.fifth.gap).toFixed(2)} gap is inside the ±$${a.fifth.noiseFloor.toFixed(2)} noise floor. No edge, stand down.`,
          "neutral",
          "critical",
        );
      }
      const bothNegative = a.fifth.payoutUp !== null && a.fifth.evUp <= 0 && a.fifth.evDown <= 0;
      const prevBothNegative = (p?.fifth?.payoutUp ?? null) !== null && (p?.fifth?.evUp ?? 1) <= 0 && (p?.fifth?.evDown ?? 1) <= 0;
      if (bothNegative && !prevBothNegative) {
        pushAlert(rs, "evtrap", "Payout trap — neither side offers positive expected value this round", "neutral", "high");
      }
    },
    [pushAlert],
  );

  const handleKline = useCallback((u: KlineUpdate) => {
    const cfg = coinRef.current;
    if (u.symbol === cfg.symbol) {
      const arr = candlesRef.current;
      const last = arr[arr.length - 1];
      if (last && last.time === u.candle.time) {
        arr[arr.length - 1] = u.candle;
      } else if (!last || u.candle.time > last.time) {
        arr.push(u.candle);
        if (arr.length > 3300) arr.splice(0, arr.length - 3000);
      }
      priceRef.current = u.candle.close;
      return;
    }
    const target = u.symbol === cfg.peers[0].symbol ? peerARef : u.symbol === cfg.peers[1].symbol ? peerBRef : null;
    if (!target) return;
    const arr = target.current;
    const last = arr[arr.length - 1];
    if (last && last.time === u.candle.time) {
      last.close = u.candle.close;
    } else if (!last || u.candle.time > last.time) {
      arr.push({ time: u.candle.time, close: u.candle.close });
      if (arr.length > 300) arr.splice(0, arr.length - 260);
    }
  }, []);

  const tick = useCallback(() => {
    const localNow = Date.now();
    const arr = candlesRef.current;

    // Round schedule: prefer the on-chain PancakeSwap round; fall back to clock-aligned 5m blocks.
    const chain = chainRoundRef.current;
    const chainFresh = chain !== null && localNow - chain.fetchedAt < 90_000;
    // Correct for device clock skew so the countdown matches blockchain time exactly.
    const nowMs = chainFresh && chain ? localNow + chain.clockOffsetMs : localNow;
    let rs: number;
    let closeTime: number;
    let roundNumber: number;
    if (chainFresh && chain) {
      rs = chain.startTime;
      closeTime = chain.closeTime;
      roundNumber = chain.epoch;
    } else {
      rs = roundStartOf(nowMs);
      closeTime = rs + ROUND_MS;
      roundNumber = roundNumberOf(rs);
    }
    setSecondsLeft(Math.max(0, Math.round((closeTime - nowMs) / 1000)));
    if (arr.length < 260) return;

    const price = priceRef.current;
    setLivePrice(price);
    setCandles(arr.slice());

    const forming = arr[arr.length - 1];
    const closedIdx = arr.length - 2;
    const elapsed = Math.min(1, Math.max(0.05, (nowMs - forming.time) / 60000));
    const bundle = computeBundle(arr);
    const lockPrice = roundRef.current?.lockPrice ?? null;
    const pool =
      chainFresh && chain && chain.totalBnb > 0 && chain.bullBnb > 0 && chain.bearBnb > 0
        ? { bullBnb: chain.bullBnb, bearBnb: chain.bearBnb, totalBnb: chain.totalBnb }
        : null;
    const weights = learningRef.current.weights;

    // BTC Mind: classify the live behavioral regime and derive the noise discount.
    const regime = computeRegime(arr, closedIdx);
    if (
      prevRegimeRef.current !== null &&
      prevRegimeRef.current !== regime.kind &&
      (regime.kind === "chop" || regime.kind === "storm")
    ) {
      pushAlert(rs, `regime-${regime.kind}`, `Regime flip — ${regime.label}. Entries suspended until the tape trends again.`, "neutral", "high");
    }
    if (
      prevRegimeRef.current !== null &&
      prevRegimeRef.current !== "trend-up" &&
      prevRegimeRef.current !== "trend-down" &&
      (regime.kind === "trend-up" || regime.kind === "trend-down")
    ) {
      pushAlert(
        rs,
        `regime-${regime.kind}`,
        `Trending tape ignited — ${regime.label}. Entries are back on the table.`,
        regime.kind === "trend-up" ? "bull" : "bear",
        "critical",
      );
    }
    prevRegimeRef.current = regime.kind;

    // Regime Clock: classify history once per closed bar, forecast every tick.
    regimePointsRef.current = buildRegimeSeries(arr, closedIdx, regimePointsRef.current);
    setRegimeForecast(computeRegimeForecast(regimePointsRef.current, nowMs));

    // Regime Efficiency Audit: re-grade history once per closed bar (15m-frame reanalysis).
    const lastAuditedTime = auditRef.current !== null ? arr[Math.min(auditRef.current.computedAtIndex, arr.length - 1)]?.time ?? 0 : 0;
    if (auditRef.current === null || arr[closedIdx].time !== lastAuditedTime) {
      const audit = computeRegimeAudit(arr, closedIdx);
      auditRef.current = audit;
      setRegimeAudit(audit);
    }

    const a = analyzeAt(arr, bundle, closedIdx, {
      price,
      lockPrice,
      forming,
      elapsedFraction: elapsed,
      secondsLeft: Math.max(0, (closeTime - nowMs) / 1000),
      pool,
      weights,
      probShrink: regime.shrink,
      timeModel: timeModelRef.current,
      // rs — at the boundary tick this snapshot becomes the NEW round's lock
      // analysis, so it must carry the new round's time bucket.
      roundStart: rs,
    });

    // ---- Next-round entry forecast: the round you can actually bet on. ----
    const secsToLock = Math.max(0, (closeTime - nowMs) / 1000);
    const chainNext = chainFresh && chain ? chain.next : null;
    // Tiny early pools produce wildly skewed payouts — ignore below 0.2 BNB.
    const nextPool =
      chainNext && chainNext.totalBnb >= 0.2 && chainNext.bullBnb > 0 && chainNext.bearBnb > 0
        ? { bullBnb: chainNext.bullBnb, bearBnb: chainNext.bearBnb, totalBnb: chainNext.totalBnb }
        : null;
    const nextA = analyzeAt(arr, bundle, closedIdx, {
      price,
      lockPrice: null,
      forming,
      elapsedFraction: elapsed,
      secondsLeft: null,
      pool: nextPool,
      weights,
      probShrink: regime.shrink,
      timeModel: timeModelRef.current,
      roundStart: closeTime,
    });
    // The core probability IS the forecast — no post-hoc layer may bend it,
    // otherwise the calibration dashboard would be measuring a fiction.
    const nUp = nextA.upProbability;
    const rawUp = Math.round(Math.min(95, Math.max(5, normCdf(nextA.core.zTotal - nextA.core.zTime) * 100)));
    const nEvUp = nextA.fifth.evUp;
    const nEvDown = nextA.fifth.evDown;

    // Discipline guard: grade the model's own LOGGED calls (trend-regime gated).
    // When it is cold, raise every entry bar instead of doubling down.
    const gradedCalls = recordsRef.current
      .filter((r) => r.live && r.result !== "FLAT" && r.recommendation !== "WAIT")
      .slice(-24);
    let coldHits = 0;
    for (const r of gradedCalls) {
      if (r.recommendation === r.result) coldHits++;
    }
    const coldSample = gradedCalls.length;
    const coldHitRate = coldSample > 0 ? coldHits / coldSample : 0.5;
    const cold = coldSample >= 8 && coldHitRate < 0.45;
    // Trailing consecutive wrong calls (Livermore's never-average-losses rule).
    let lossStreak = 0;
    for (let gi = gradedCalls.length - 1; gi >= 0; gi--) {
      const g = gradedCalls[gi];
      if (g.recommendation === g.result) break;
      lossStreak++;
    }

    // EV IS the decision gate: a small dynamic threshold (base 1.5%) rises while
    // the model is cold, the graded sample is thin, calibration drifts, or the
    // regime audit is below target. The expected value of the actual payout must
    // clear the bar — no probability-bar games.
    const audit = auditRef.current;
    const auditPenalty = audit !== null && audit.bettableRounds >= 10 && !audit.clearsTarget ? 2 : 0;
    const evGate = Math.min(
      0.06,
      evThreshold({ cold, decidedSample: coldSample, meanGapPct: calibrationRef.current?.meanGap ?? null }) + auditPenalty / 100,
    );
    const trending = regime.kind === "trend-up" || regime.kind === "trend-down";
    const htfOk = regime.alignment !== "conflict";
    // Only ever bet WITH the tape AND the 15-minute frame: a micro trend fighting
    // the 15m structure is a pullback in disguise and is never bet.
    let side: "UP" | "DOWN" | null = null;
    if (trending && htfOk && !nextA.fifth.coinFlip) {
      if (regime.kind === "trend-up" && nUp >= 53 && nEvUp >= evGate) side = "UP";
      else if (regime.kind === "trend-down" && nUp <= 47 && nEvDown >= evGate) side = "DOWN";
    }
    // Proven-condition ledger: once history has proven conditions forward, a live
    // setup must match one — that is how the app learns when it should wait.
    const conds = conditionsRef.current;
    const conditionsKnown = conds.some((c) => c.status === "proven");
    let condition: string | null = null;
    let conditionBlocked = false;
    if (side !== null && conditionsKnown) {
      const match = matchLiveCondition(conds, {
        regimeKind: regime.kind,
        alignment: regime.alignment ?? undefined,
        zGap: nextA.core.zGap,
        zDrift: nextA.core.zDrift,
        zStruct: nextA.core.zStruct,
        zTime: nextA.core.zTime,
        pUp: nUp,
        ...bucketOf(closeTime),
      });
      if (match) {
        condition = match.proof.label;
      } else {
        side = null;
        conditionBlocked = true;
      }
    }
    // Wall Street Playbook: the legends get the final word on every entry.
    const playbook = evaluatePlaybook({
      regimeKind: regime.kind,
      alignment: regime.alignment,
      upProb: nUp,
      confidence: nextA.confidence,
      side,
      evUp: nEvUp,
      evDown: nEvDown,
      payoutUp: nextA.fifth.payoutUp,
      payoutDown: nextA.fifth.payoutDown,
      cold,
      coldHitRate,
      lossStreak,
      consecGreen: nextA.consecGreen,
      consecRed: nextA.consecRed,
      auditHitRatePct: audit !== null && audit.bettableRounds >= 10 ? audit.bettableHitRatePct : null,
      auditRounds: audit?.bettableRounds ?? 0,
    });
    if (entrySideRef.current.side !== side) {
      entrySideRef.current = { side, since: localNow };
    }
    const stableFor = Math.floor((localNow - entrySideRef.current.since) / 1000);
    const entryWindow = secsToLock <= 75 && secsToLock > 8;
    const coldNote = cold ? ` Model is cold (${Math.round(coldHitRate * 100)}% on its last ${coldSample} calls) — entry bars raised.` : "";
    let action: NextRoundState["action"];
    let reason: string;
    if (!trending) {
      action = "STAND DOWN";
      reason = `${regime.label}: ${regime.detail} The strongest edge here is not betting.${coldNote}`;
    } else if (!htfOk) {
      action = "STAND DOWN";
      reason = `${regime.label} on the micro tape, but the 15-minute frame points the other way (${regime.htf.label}). Counter-15m entries graded ${audit !== null && audit.buckets[2].rounds > 0 ? `${audit.buckets[2].hitRatePct.toFixed(0)}% over ${audit.buckets[2].rounds} audited rounds` : "below target historically"} — this setup is blocked.${coldNote}`;
    } else if (conditionBlocked) {
      action = "STAND DOWN";
      reason = `${regime.label} clears the EV gate, but this setup matches no proven condition. The engine only bets patterns that held up on untouched out-of-sample history — waiting IS the position.${coldNote}`;
    } else if (side === null) {
      const bestEv = Math.max(nEvUp, nEvDown);
      const fmt = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
      reason = `${regime.label}: core reads ${nUp >= 50 ? nUp : 100 - nUp}% ${nUp >= 50 ? "UP" : "DOWN"} (gap ${fmt(nextA.core.zGap)}σ · drift ${fmt(nextA.core.zDrift)} · time ${fmt(nextA.core.zTime)} · structure ${fmt(nextA.core.zStruct)}), best EV ${(bestEv * 100).toFixed(1)}% vs the ${(evGate * 100).toFixed(1)}% gate — below the bar, or the tape isn't a confirmed trend.${coldNote}`;
    } else if (playbook.veto !== null) {
      action = "STAND DOWN";
      reason = `${playbook.veto.legend}'s rule (${playbook.veto.trade}) blocks this entry. ${playbook.veto.note}`;
    } else if (secsToLock <= 8) {
      action = "WAIT";
      reason = "Under 8s to lock — a transaction sent now risks missing the round.";
    } else if (!entryWindow) {
      action = "WAIT";
      reason = `${side} signal forming with the ${regime.kind === "trend-up" ? "up" : "down"}trend — enter in the final 75s before lock, when the model has the most information.`;
    } else if (stableFor < 25) {
      action = "WAIT";
      reason = `${side} signal is only ${stableFor}s old — wait for it to hold at least 25s before committing.`;
    } else {
      action = side === "UP" ? "ENTER UP" : "ENTER DOWN";
      const htfNote = regime.alignment === "aligned" ? " and the 15-minute frame confirms" : " (15m frame flat — EV gate was raised and still cleared)";
      const ev = side === "UP" ? nEvUp : nEvDown;
      reason = `${side} rides the ${regime.kind === "trend-up" ? "up" : "down"}trend regime${htfNote}: core ${nUp >= 50 ? nUp : 100 - nUp}% with ${(ev * 100).toFixed(1)}% EV against the ${(evGate * 100).toFixed(1)}% gate${condition ? ` — proven condition: ${condition}` : ""}.`;
      if (playbook.conviction) {
        const conv = playbook.fired.find((f) => f.stance === "conviction");
        if (conv) reason += ` CONVICTION: ${conv.note}`;
      }
    }
    const nextState: NextRoundState = {
      epoch: chainNext ? chainNext.epoch : null,
      upProb: nUp,
      confidence: nextA.confidence,
      payoutUp: nextA.fifth.payoutUp,
      payoutDown: nextA.fifth.payoutDown,
      totalBnb: chainNext ? chainNext.totalBnb : null,
      evUp: nEvUp,
      evDown: nEvDown,
      side,
      stableFor,
      entryWindow,
      action,
      reason,
      rawUpProb: rawUp,
      regime,
      cold,
      coldHitRate,
      coldSample,
      core: nextA.core,
      evGate,
      condition,
      conditionsKnown,
      playbook,
    };
    nextRoundRef.current = nextState;
    setNextRound(nextState);

    const chainLock = chainFresh && chain && chain.lockPrice > 0 ? chain.lockPrice : 0;

    // Round rollover: finalize the previous round against its lock-time analysis.
    let settledPrev: LiveRound | null = null;
    if (roundRef.current && roundRef.current.startTime !== rs) {
      const prev = roundRef.current;
      settledPrev = prev;
      const lockA = lockAnalysisRef.current;
      if (lockA) {
        const rec = buildRecord(lockA, prev.startTime, prev.lockPrice, price, true, lockRegimeRef.current);
        setRecords((old) => {
          const next = [...old.filter((r) => r.id !== rec.id), rec]
            .sort((x, y) => x.startTime - y.startTime)
            .slice(-1200);
          saveLiveRecords(next.filter((r) => r.live || r.imported), coinRef.current.storageSuffix);
          return next;
        });
      }
      roundRef.current = { startTime: rs, closeTime, lockPrice: chainLock || price, roundNumber, synced: chainFresh };
      setRound(roundRef.current);
      lockAnalysisRef.current = a;
      lockRegimeRef.current = regime;
    } else if (!roundRef.current) {
      roundRef.current = { startTime: rs, closeTime, lockPrice: chainLock || price, roundNumber, synced: chainFresh };
      setRound(roundRef.current);
      lockAnalysisRef.current = a;
      lockRegimeRef.current = regime;
    } else if (!lockAnalysisRef.current) {
      lockAnalysisRef.current = a;
      lockRegimeRef.current = regime;
    } else if (
      chainLock > 0 &&
      roundRef.current.roundNumber === roundNumber &&
      roundRef.current.lockPrice !== chainLock
    ) {
      // Chainlink lock price arrived (or was refined) after the round started.
      roundRef.current = { ...roundRef.current, lockPrice: chainLock, synced: true };
      setRound(roundRef.current);
    }

    // ---- User position tracking: lock in, settle, and grade logged entries. ----
    const curRound = roundRef.current;
    if (curRound && positionsRef.current.length > 0) {
      let dirty = false;
      const updatedPositions = positionsRef.current.map((p): UserPosition => {
        if (p.status !== "pending" && p.status !== "live") return p;
        // Settle: the position's round just closed.
        if (settledPrev && p.epoch === settledPrev.roundNumber) {
          const lock = p.lockPrice ?? settledPrev.lockPrice;
          const result = price > lock ? "UP" : price < lock ? "DOWN" : "FLAT";
          const status: UserPosition["status"] = result === "FLAT" ? "flat" : result === p.side ? "won" : "lost";
          const payout = p.payoutAtEntry ?? 1.95;
          const pnl = p.amountBnb === null ? null : status === "won" ? p.amountBnb * (payout - 1) : -p.amountBnb;
          const gap = Math.abs(price - lock);
          if (status === "won") {
            pushAlert(rs, `pos-win-${p.epoch}`, `Your ${p.side} position on round #${p.epoch} WON — closed $${gap.toFixed(2)} ${result === "UP" ? "above" : "below"} lock.`, p.side === "UP" ? "bull" : "bear", "critical");
          } else if (status === "flat") {
            pushAlert(rs, `pos-flat-${p.epoch}`, `Round #${p.epoch} closed exactly at lock — the house takes both sides.`, "neutral", "critical");
          } else {
            pushAlert(rs, `pos-loss-${p.epoch}`, `Your ${p.side} position on round #${p.epoch} LOST — closed $${gap.toFixed(2)} ${result === "UP" ? "above" : "below"} lock.`, "neutral", "critical");
          }
          dirty = true;
          return { ...p, status, lockPrice: lock, closePrice: price, settledAt: localNow, pnlBnb: pnl };
        }
        // Lock-in: the position's round just became the live round.
        if (p.status === "pending" && p.epoch === curRound.roundNumber) {
          pushAlert(rs, `pos-lock-${p.epoch}`, `Your ${p.side} position locked in on round #${p.epoch} at $${curRound.lockPrice.toFixed(2)}. Tracking it live.`, p.side === "UP" ? "bull" : "bear", "high");
          dirty = true;
          return { ...p, status: "live", startTime: curRound.startTime, lockPrice: curRound.lockPrice };
        }
        // Refine the lock price if the Chainlink price arrived after lock.
        if (p.status === "live" && p.epoch === curRound.roundNumber && p.lockPrice !== curRound.lockPrice) {
          dirty = true;
          return { ...p, lockPrice: curRound.lockPrice };
        }
        // Stale: the app missed the settlement window — void instead of guessing.
        const missedRounds = curRound.roundNumber - p.epoch;
        if ((missedRounds >= 1 && missedRounds < 1000) || localNow - p.enteredAt > 30 * 60_000) {
          dirty = true;
          return { ...p, status: "void", settledAt: localNow };
        }
        return p;
      });
      if (dirty) {
        positionsRef.current = updatedPositions;
        setPositions(updatedPositions);
        savePositions(updatedPositions, coinRef.current.storageSuffix);
      }
      // Warn when the model turns hard against the live locked position.
      const livePos = updatedPositions.find((p) => p.status === "live" && p.epoch === curRound.roundNumber);
      if (livePos) {
        const againstProb = livePos.side === "UP" ? a.downProbability : a.upProbability;
        if (againstProb >= 62) {
          pushAlert(rs, `pos-risk-${livePos.epoch}`, `Model has turned against your ${livePos.side} position — ${againstProb}% odds this round closes ${livePos.side === "UP" ? "DOWN" : "UP"}.`, "neutral", "critical");
        }
      }
    }

    setAnalysis(a);
    fireAlerts(a, prevAnalysisRef.current, rs);
    prevAnalysisRef.current = a;

    const mainCloses = arr.slice(-61).map((c) => c.close);
    const peerACloses = peerARef.current.slice(-61).map((c) => c.close);
    const peerBCloses = peerBRef.current.slice(-61).map((c) => c.close);
    const coinCfg = coinRef.current;
    setCorrelation({
      pairs: [
        {
          label: `${coinCfg.peers[0].id} / ${coinCfg.id}`,
          value: peerACloses.length > 20 ? pearson(returnsOf(mainCloses), returnsOf(peerACloses)) : 0,
        },
        {
          label: `${coinCfg.peers[1].id} / ${coinCfg.id}`,
          value: peerBCloses.length > 20 ? pearson(returnsOf(mainCloses), returnsOf(peerBCloses)) : 0,
        },
      ],
    });
  }, [fireAlerts, pushAlert]);

  // Re-train the learning engine whenever the round database changes.
  useEffect(() => {
    recordsRef.current = records;
    const state = computeLearning(records);
    learningRef.current = state;
    setLearning(state);
    // Neuroplasticity stays a telemetry layer — the core probability is the
    // single source of truth, so nothing double counts.
    const brain = computeNeuro(records);
    neuroRef.current = brain;
    setNeuro(brain);
    // Continuous recalculation: every settled round refits the time structure,
    // the calibration report and the condition ledger. No timers, no fixed
    // four-hour retrain windows — the model moves when the market does.
    const tm = fitTimeModel(records);
    timeModelRef.current = tm;
    setTimeModel(tm);
    const cal = computeCalibration(records);
    calibrationRef.current = cal;
    setCalibration(cal);
    const conds = searchConditions(records);
    conditionsRef.current = conds;
    setConditions(conds);
  }, [records]);

  // Poll the PancakeSwap prediction contract so rounds mirror the real on-chain schedule.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const contract = COINS[coinId].contract;
    chainRoundRef.current = null;

    const poll = async (): Promise<void> => {
      try {
        const chainRound = await fetchLiveChainRound(contract);
        if (cancelled) return;
        chainRoundRef.current = chainRound;
      } catch (err) {
        console.warn("PancakeSwap round sync failed, will retry", err);
      }
      if (cancelled) return;
      // Poll faster around round rollover so the next epoch is picked up quickly.
      const cur = chainRoundRef.current;
      const msToClose = cur ? cur.closeTime - (Date.now() + cur.clockOffsetMs) : 0;
      const delay = cur === null ? 5000 : msToClose <= 5000 ? 2000 : Math.min(15_000, Math.max(4000, msToClose - 5000));
      timer = window.setTimeout(() => void poll(), delay);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [attempt, coinId]);

  useEffect(() => {
    let cancelled = false;
    let closeStream: (() => void) | null = null;
    let interval: number | null = null;

    const cfg = COINS[coinId];

    const init = async (): Promise<void> => {
      setStatus("loading");
      // Full engine reset — nothing learned on one coin may leak into another.
      coinRef.current = cfg;
      candlesRef.current = [];
      peerARef.current = [];
      peerBRef.current = [];
      priceRef.current = 0;
      roundRef.current = null;
      lockAnalysisRef.current = null;
      lockRegimeRef.current = null;
      prevAnalysisRef.current = null;
      prevRegimeRef.current = null;
      regimePointsRef.current = [];
      auditRef.current = null;
      nextRoundRef.current = null;
      entrySideRef.current = { side: null, since: 0 };
      alertKeysRef.current = new Set();
      setCandles([]);
      setAnalysis(null);
      setRound(null);
      setNextRound(null);
      setAlerts([]);
      setRegimeForecast(null);
      setRegimeAudit(null);
      timeModelRef.current = fitTimeModel([]);
      calibrationRef.current = null;
      conditionsRef.current = [];
      setTimeModel(fitTimeModel([]));
      setCalibration(null);
      setConditions([]);
      setCorrelation({ pairs: [] });
      const storedPositions = loadPositions(cfg.storageSuffix);
      positionsRef.current = storedPositions;
      setPositions(storedPositions);
      setImportAudit(loadImportAudit(cfg.storageSuffix));
      try {
        const [main, peerA, peerB] = await Promise.all([
          fetchKlinesDeep(cfg.symbol, "1m", 3000),
          fetchKlines(cfg.peers[0].symbol, "1m", 240),
          fetchKlines(cfg.peers[1].symbol, "1m", 240),
        ]);
        if (cancelled) return;
        candlesRef.current = main;
        peerARef.current = peerA.map((c) => ({ time: c.time, close: c.close }));
        peerBRef.current = peerB.map((c) => ({ time: c.time, close: c.close }));
        priceRef.current = main.length > 0 ? main[main.length - 1].close : 0;
        setCandles(main.slice());
        setLivePrice(priceRef.current);

        const seeds = buildSeedRecords(main);
        const stored = loadLiveRecords(cfg.storageSuffix);
        const byId = new Map<number, RoundRecord>();
        for (const r of seeds) byId.set(r.id, r);
        for (const r of stored) byId.set(r.id, r);
        const merged = Array.from(byId.values())
          .sort((x, y) => x.startTime - y.startTime)
          .slice(-1200);
        setRecords(merged);

        const chain = chainRoundRef.current;
        if (chain && Date.now() - chain.fetchedAt < 90_000) {
          roundRef.current = {
            startTime: chain.startTime,
            closeTime: chain.closeTime,
            lockPrice: chain.lockPrice > 0 ? chain.lockPrice : priceRef.current,
            roundNumber: chain.epoch,
            synced: true,
          };
        } else {
          const rs = roundStartOf(Date.now());
          let lockPrice = priceRef.current;
          for (let i = main.length - 1; i >= Math.max(0, main.length - 8); i--) {
            if (main[i].time === rs) {
              lockPrice = main[i].open;
              break;
            }
          }
          roundRef.current = { startTime: rs, closeTime: rs + ROUND_MS, lockPrice, roundNumber: roundNumberOf(rs), synced: false };
        }
        setRound(roundRef.current);

        setStatus("ready");
        closeStream = openMarketStream([cfg.symbol, cfg.peers[0].symbol, cfg.peers[1].symbol], handleKline, setConnected);
        interval = window.setInterval(tick, 1000);
        tick();
      } catch (err) {
        console.error("Market init failed", err);
        if (!cancelled) setStatus("error");
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (closeStream) closeStream();
      if (interval !== null) window.clearInterval(interval);
    };
  }, [attempt, coinId, handleKline, tick]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  /**
   * Imports a PancakeSwap history CSV: anchors each round's epoch to the
   * on-chain schedule, replays the engine at that round's lock bar (no
   * lookahead) with the REAL Chainlink lock/close prices, and injects the
   * results as training records — the learning + neuro layers retrain
   * automatically. The user's own bets are graded into a persistent audit.
   */
  const importCsvData = useCallback((text: string): ImportOutcome => {
    const rows = parsePancakeCsv(text);
    if (rows.length === 0) {
      return {
        ok: false,
        parsed: 0,
        matched: 0,
        audit: null,
        message:
          "No rounds found — the file only contains the header row. On PancakeSwap, open Predictions → History, wait for your rounds to load, then export again.",
      };
    }

    const anchor = chainRoundRef.current;
    const arr = candlesRef.current;
    const newRecords: RoundRecord[] = [];
    let matched = 0;
    let priceMismatch = 0;
    if (anchor !== null && arr.length >= 300) {
      const bundle = computeBundle(arr);
      const firstTime = arr[0].time;
      const lastTime = arr[arr.length - 1].time;
      for (const row of rows) {
        if (row.failed) continue;
        const lock = row.lockPrice;
        const close = row.closePrice;
        if (lock === null || close === null || lock <= 0 || close <= 0) continue;
        // Anchor the epoch to the live on-chain round: every round is 5 minutes.
        const startTime = anchor.startTime - (anchor.epoch - row.epoch) * ROUND_MS;
        if (startTime < firstTime + 235 * 60_000 || startTime > lastTime) continue;
        // Locate the last closed 1m candle at/before the round's lock moment.
        let i = Math.min(arr.length - 1, Math.max(0, Math.floor((startTime - firstTime) / 60_000)));
        while (i > 0 && arr[i].time > startTime) i--;
        while (i + 1 < arr.length && arr[i + 1].time <= startTime) i++;
        if (i - 1 < 230) continue;
        // Sanity: a lock price far off the local tape means a different market's export.
        const ref = arr[i].close;
        if (ref > 0 && Math.abs(lock - ref) / ref > 0.15) {
          priceMismatch++;
          continue;
        }
        const a = analyzeAt(arr, bundle, i - 1, { price: lock, lockPrice: lock });
        const regime = computeRegime(arr, i - 1);
        const rec = buildRecord(a, startTime, lock, close, false, regime);
        rec.imported = true;
        if (row.position !== null) {
          rec.userSide = row.position;
          if (row.betAmount !== null) rec.betAmount = row.betAmount;
        }
        newRecords.push(rec);
        matched++;
      }
    }

    if (newRecords.length > 0) {
      setRecords((old) => {
        const byId = new Map<number, RoundRecord>();
        for (const r of old) byId.set(r.id, r);
        // Imported records carry real Chainlink prices — they override seeds.
        for (const r of newRecords) byId.set(r.id, r);
        const next = Array.from(byId.values())
          .sort((x, y) => x.startTime - y.startTime)
          .slice(-1200);
        saveLiveRecords(next.filter((r) => r.live || r.imported), coinRef.current.storageSuffix);
        return next;
      });
    }

    const audit = gradeImport(rows, matched);
    saveImportAudit(audit, coinRef.current.storageSuffix);
    setImportAudit(audit);

    let message = `Imported ${rows.length} rounds — ${matched} matched the ${coinRef.current.id} tape and now train the AI.`;
    if (anchor === null) {
      message += " Chain sync isn't available yet, so rounds couldn't be timestamped — re-import in a minute to convert them into training data.";
    } else if (priceMismatch > rows.length / 2) {
      message += ` Most lock prices don't match ${coinRef.current.id} — this looks like a different market's export. Switch coins and re-import.`;
    } else if (matched === 0) {
      message += " These rounds are older than the loaded candle history, so only your personal bet audit was updated.";
    }
    return { ok: true, parsed: rows.length, matched, audit, message };
  }, []);

  const setCoin = useCallback((id: CoinId) => {
    saveSelectedCoin(id);
    setCoinId((prev) => (prev === id ? prev : id));
  }, []);

  const logPosition = useCallback((side: PositionSide, amountBnb: number | null) => {
    const n = nextRoundRef.current;
    const cur = roundRef.current;
    const epoch = n?.epoch ?? (cur ? cur.roundNumber + 1 : null);
    if (epoch === null) return;
    const payout = side === "UP" ? (n?.payoutUp ?? null) : (n?.payoutDown ?? null);
    const agrees = n && n.side !== null ? n.side === side : null;
    const pos: UserPosition = {
      id: `${epoch}-${Date.now()}`,
      epoch,
      side,
      amountBnb,
      enteredAt: Date.now(),
      payoutAtEntry: payout,
      modelUpProb: n ? n.upProb : null,
      modelAction: n ? n.action : null,
      regimeLabel: n ? n.regime.label : null,
      agreesWithModel: agrees,
      status: "pending",
      startTime: null,
      lockPrice: null,
      closePrice: null,
      settledAt: null,
      pnlBnb: null,
    };
    // Only one un-locked entry at a time — re-logging replaces it.
    const next = [...positionsRef.current.filter((p) => p.status !== "pending"), pos].slice(-200);
    positionsRef.current = next;
    setPositions(next);
    savePositions(next, coinRef.current.storageSuffix);
    if (n && (n.action === "STAND DOWN" || agrees === false)) {
      toast(`Position logged — ${side} on round #${epoch}`, {
        description:
          agrees === false
            ? `Heads up: the engine currently favors ${n.side}. Tracking your call anyway.`
            : `Heads up: the engine is standing down this round (${n.regime.label}). Tracking your call anyway.`,
      });
    } else {
      toast(`Position logged — ${side} on round #${epoch}`, {
        description: "The engine will track, grade, and warn you on this entry.",
      });
    }
  }, []);

  const cancelPosition = useCallback((id: string) => {
    const next = positionsRef.current.filter((p) => !(p.id === id && p.status === "pending"));
    if (next.length === positionsRef.current.length) return;
    positionsRef.current = next;
    setPositions(next);
    savePositions(next, coinRef.current.storageSuffix);
    toast("Position log removed");
  }, []);

  const value = useMemo<MarketContextValue>(
    () => ({ status, connected, coin: COINS[coinId], setCoin, candles, livePrice, analysis, round, secondsLeft, records, alerts, correlation, nextRound, learning, neuro, timeModel, calibration, conditions, regimeForecast, regimeAudit, importAudit, importCsvData, positions, logPosition, cancelPosition, retry }),
    [status, connected, coinId, setCoin, candles, livePrice, analysis, round, secondsLeft, records, alerts, correlation, nextRound, learning, neuro, timeModel, calibration, conditions, regimeForecast, regimeAudit, importAudit, importCsvData, positions, logPosition, cancelPosition, retry],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

/** Access hook for the shared market/prediction state. */
export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error("useMarket must be used within MarketProvider");
  return ctx;
}
