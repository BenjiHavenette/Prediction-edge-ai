import { analyzeAt, computeBundle } from "./analysis";
import { computeRegime } from "./regime";
import type { RegimeState } from "./regime";
import type { Analysis, Candle, Recommendation, RoundRecord, RoundSnapshot } from "./types";

export const ROUND_MS = 5 * 60 * 1000;

/** Start timestamp of the 5-minute round containing `ts`. */
export const roundStartOf = (ts: number): number => Math.floor(ts / ROUND_MS) * ROUND_MS;

/** Sequential round number derived from epoch time. */
export const roundNumberOf = (startTime: number): number => Math.floor(startTime / ROUND_MS);

function snapshotFrom(a: Analysis): RoundSnapshot {
  return {
    consecGreen: a.consecGreen,
    consecRed: a.consecRed,
    rsi: a.momentum.rsi,
    stochRsi: a.momentum.stochRsi,
    macdHist: a.momentum.macdHist,
    volumeRelative: a.volume.relative,
    volumeSpike: a.volume.spike,
    bullPressure: a.volume.bullPressure,
    emaAboveCount: a.trend.aboveCount,
    emaCross: a.trend.cross,
    vwapSide: a.vwap.distancePct >= 0 ? "above" : "below",
    bbEvent: a.bollinger.event,
    patterns: a.patterns.map((p) => p.name),
    smc: a.smc.map((e) => e.label),
    categories: a.categories,
    narrative: a.narrative,
    expectedMovePct: a.expectedMovePct,
    gapZ: a.fifth.zScore,
    coinFlip: a.fifth.coinFlip,
    evUp: a.fifth.evUp,
    evDown: a.fifth.evDown,
  };
}

/**
 * Trend-regime gate: a directional call is only LOGGED when the tape is in a
 * trend regime, the call rides WITH that trend, and the 15m frame is not
 * fighting it. Everything else is recorded as WAIT (no call) — chop and storm
 * rounds are coin flips and would only dilute the hit ratio.
 */
export function gateRecommendation(rec: Recommendation, regime: RegimeState | null): Recommendation {
  if (regime === null || rec === "WAIT") return rec;
  const trending = regime.kind === "trend-up" || regime.kind === "trend-down";
  if (!trending) return "WAIT";
  if (regime.alignment === "conflict") return "WAIT";
  const trendDir: Recommendation = regime.kind === "trend-up" ? "UP" : "DOWN";
  return rec === trendDir ? rec : "WAIT";
}

/** Builds a completed round record from the analysis captured at lock time. */
export function buildRecord(
  a: Analysis,
  startTime: number,
  lockPrice: number,
  closePrice: number,
  live: boolean,
  regime: RegimeState | null = null,
): RoundRecord {
  const movePct = lockPrice !== 0 ? ((closePrice - lockPrice) / lockPrice) * 100 : 0;
  return {
    id: startTime,
    startTime,
    lockPrice,
    closePrice,
    result: closePrice > lockPrice ? "UP" : closePrice < lockPrice ? "DOWN" : "FLAT",
    movePct,
    predictedUp: a.upProbability,
    confidence: a.confidence,
    recommendation: gateRecommendation(a.recommendation, regime),
    rawRecommendation: a.recommendation,
    regimeKind: regime?.kind,
    regimeLabel: regime?.label,
    live,
    snapshot: snapshotFrom(a),
  };
}

/**
 * Replays historical 1m candles into simulated 5-minute rounds,
 * running the full prediction engine at each round's lock moment (no lookahead).
 */
export function buildSeedRecords(candles: Candle[]): RoundRecord[] {
  const records: RoundRecord[] = [];
  if (candles.length < 260) return records;
  const bundle = computeBundle(candles);
  for (let i = 230; i + 4 < candles.length; i++) {
    if (candles[i].time % ROUND_MS !== 0) continue;
    const lockPrice = candles[i].open;
    const closePrice = candles[i + 4].close;
    const a = analyzeAt(candles, bundle, i - 1, { price: lockPrice, lockPrice });
    // Same trend-regime gate as live rounds — no lookahead, computed at lock.
    const regime = computeRegime(candles, i - 1);
    records.push(buildRecord(a, candles[i].time, lockPrice, closePrice, false, regime));
  }
  return records;
}

const STORAGE_KEY = "pea_live_rounds_v1";

/** Loads live-tracked round records persisted in localStorage for one coin. */
export function loadLiveRecords(storageSuffix: string = ""): RoundRecord[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}${storageSuffix}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RoundRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persists live-tracked and imported round records for one coin (capped at 1200). */
export function saveLiveRecords(records: RoundRecord[], storageSuffix: string = ""): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}${storageSuffix}`, JSON.stringify(records.slice(-1200)));
  } catch {
    // storage full or unavailable — non-fatal
  }
}

// ---------------- Pattern win-rate analytics ----------------

export interface PatternDef {
  id: string;
  label: string;
  side: "UP" | "DOWN";
  test: (s: RoundSnapshot) => boolean;
}

export const PATTERN_DEFS: PatternDef[] = [
  { id: "g2", label: "2 Green Candles", side: "UP", test: (s) => s.consecGreen >= 2 },
  { id: "g3", label: "3 Green Candles", side: "UP", test: (s) => s.consecGreen >= 3 },
  { id: "r2", label: "2 Red Candles", side: "DOWN", test: (s) => s.consecRed >= 2 },
  { id: "r3", label: "3 Red Candles", side: "DOWN", test: (s) => s.consecRed >= 3 },
  { id: "rsi60", label: "RSI Above 60", side: "UP", test: (s) => s.rsi > 60 },
  { id: "rsi40", label: "RSI Below 40", side: "DOWN", test: (s) => s.rsi < 40 },
  { id: "golden", label: "EMA Golden Cross", side: "UP", test: (s) => s.emaCross === "golden" },
  { id: "death", label: "EMA Death Cross", side: "DOWN", test: (s) => s.emaCross === "death" },
  { id: "spikeUp", label: "Volume Spike + Green Run", side: "UP", test: (s) => s.volumeSpike && s.consecGreen >= 1 },
  { id: "spikeDown", label: "Volume Spike + Red Run", side: "DOWN", test: (s) => s.volumeSpike && s.consecRed >= 1 },
  { id: "vwapUp", label: "Price Above VWAP", side: "UP", test: (s) => s.vwapSide === "above" },
  { id: "vwapDown", label: "Price Below VWAP", side: "DOWN", test: (s) => s.vwapSide === "below" },
  { id: "macdUp", label: "MACD Histogram Positive", side: "UP", test: (s) => s.macdHist > 0 },
  { id: "macdDown", label: "MACD Histogram Negative", side: "DOWN", test: (s) => s.macdHist < 0 },
  { id: "bbUp", label: "Bollinger Breakout Up", side: "UP", test: (s) => s.bbEvent === "breakout-up" },
  { id: "bbDown", label: "Bollinger Breakout Down", side: "DOWN", test: (s) => s.bbEvent === "breakout-down" },
  { id: "engulfBull", label: "Bullish Engulfing", side: "UP", test: (s) => s.patterns.includes("Bullish Engulfing") },
  { id: "engulfBear", label: "Bearish Engulfing", side: "DOWN", test: (s) => s.patterns.includes("Bearish Engulfing") },
  { id: "hammer", label: "Hammer", side: "UP", test: (s) => s.patterns.includes("Hammer") },
  { id: "star", label: "Shooting Star", side: "DOWN", test: (s) => s.patterns.includes("Shooting Star") },
  { id: "emaStackBull", label: "Price Above All 4 EMAs", side: "UP", test: (s) => s.emaAboveCount === 4 },
  { id: "emaStackBear", label: "Price Below All 4 EMAs", side: "DOWN", test: (s) => s.emaAboveCount === 0 },
];

export interface PatternStat {
  id: string;
  label: string;
  side: "UP" | "DOWN";
  occurrences: number;
  wins: number;
  winRate: number;
}

/** Win rate of each predefined pattern following its expected direction. */
export function patternStats(records: RoundRecord[]): PatternStat[] {
  return PATTERN_DEFS.map((def) => {
    let occurrences = 0;
    let wins = 0;
    for (const r of records) {
      if (r.result === "FLAT") continue;
      if (!def.test(r.snapshot)) continue;
      occurrences++;
      if (r.result === def.side) wins++;
    }
    return {
      id: def.id,
      label: def.label,
      side: def.side,
      occurrences,
      wins,
      winRate: occurrences > 0 ? (wins / occurrences) * 100 : 0,
    };
  });
}

export interface ModelStat {
  total: number;
  decided: number;
  wins: number;
  winRate: number;
}

/** Accuracy of the model's UP/DOWN recommendations over the latest `n` rounds. */
export function modelStats(records: RoundRecord[], n: number): ModelStat {
  const slice = records.slice(-n);
  let decided = 0;
  let wins = 0;
  for (const r of slice) {
    if (r.recommendation === "WAIT" || r.result === "FLAT") continue;
    decided++;
    if (r.result === r.recommendation) wins++;
  }
  return { total: slice.length, decided, wins, winRate: decided > 0 ? (wins / decided) * 100 : 0 };
}

// ---------------- Backtesting engine ----------------

export interface BacktestCondition {
  id: string;
  label: string;
  group: string;
  test: (s: RoundSnapshot) => boolean;
}

export const BACKTEST_CONDITIONS: BacktestCondition[] = [
  { id: "c2g", label: "2+ Green Candles", group: "Price Action", test: (s) => s.consecGreen >= 2 },
  { id: "c3g", label: "3+ Green Candles", group: "Price Action", test: (s) => s.consecGreen >= 3 },
  { id: "c4g", label: "4+ Green Candles", group: "Price Action", test: (s) => s.consecGreen >= 4 },
  { id: "c2r", label: "2+ Red Candles", group: "Price Action", test: (s) => s.consecRed >= 2 },
  { id: "c3r", label: "3+ Red Candles", group: "Price Action", test: (s) => s.consecRed >= 3 },
  { id: "c4r", label: "4+ Red Candles", group: "Price Action", test: (s) => s.consecRed >= 4 },
  { id: "engulfB", label: "Bullish Engulfing", group: "Price Action", test: (s) => s.patterns.includes("Bullish Engulfing") },
  { id: "engulfS", label: "Bearish Engulfing", group: "Price Action", test: (s) => s.patterns.includes("Bearish Engulfing") },
  { id: "hammer", label: "Hammer", group: "Price Action", test: (s) => s.patterns.includes("Hammer") },
  { id: "star", label: "Shooting Star", group: "Price Action", test: (s) => s.patterns.includes("Shooting Star") },
  { id: "doji", label: "Doji", group: "Price Action", test: (s) => s.patterns.includes("Doji") },
  { id: "rsi55", label: "RSI Above 55", group: "Momentum", test: (s) => s.rsi > 55 },
  { id: "rsi60", label: "RSI Above 60", group: "Momentum", test: (s) => s.rsi > 60 },
  { id: "rsi45", label: "RSI Below 45", group: "Momentum", test: (s) => s.rsi < 45 },
  { id: "rsi40", label: "RSI Below 40", group: "Momentum", test: (s) => s.rsi < 40 },
  { id: "stochHi", label: "Stoch RSI Above 80", group: "Momentum", test: (s) => s.stochRsi > 80 },
  { id: "stochLo", label: "Stoch RSI Below 20", group: "Momentum", test: (s) => s.stochRsi < 20 },
  { id: "macdPos", label: "MACD Histogram Positive", group: "Momentum", test: (s) => s.macdHist > 0 },
  { id: "macdNeg", label: "MACD Histogram Negative", group: "Momentum", test: (s) => s.macdHist < 0 },
  { id: "spike", label: "Volume Spike (1.8x+)", group: "Volume", test: (s) => s.volumeSpike },
  { id: "vol15", label: "Relative Volume Above 1.5x", group: "Volume", test: (s) => s.volumeRelative > 1.5 },
  { id: "buyers", label: "Buyers Control Tape (60%+)", group: "Volume", test: (s) => s.bullPressure >= 60 },
  { id: "sellers", label: "Sellers Control Tape (60%+)", group: "Volume", test: (s) => s.bullPressure <= 40 },
  { id: "golden", label: "EMA Golden Cross", group: "Trend", test: (s) => s.emaCross === "golden" },
  { id: "death", label: "EMA Death Cross", group: "Trend", test: (s) => s.emaCross === "death" },
  { id: "ema4", label: "Above All 4 EMAs", group: "Trend", test: (s) => s.emaAboveCount === 4 },
  { id: "ema0", label: "Below All 4 EMAs", group: "Trend", test: (s) => s.emaAboveCount === 0 },
  { id: "vwapA", label: "Above VWAP", group: "Trend", test: (s) => s.vwapSide === "above" },
  { id: "vwapB", label: "Below VWAP", group: "Trend", test: (s) => s.vwapSide === "below" },
  { id: "bbUp", label: "BB Breakout Up", group: "Structure", test: (s) => s.bbEvent === "breakout-up" },
  { id: "bbDown", label: "BB Breakout Down", group: "Structure", test: (s) => s.bbEvent === "breakout-down" },
  { id: "bbRejUp", label: "BB Upper Rejection", group: "Structure", test: (s) => s.bbEvent === "rejection-upper" },
  { id: "bbRejLo", label: "BB Lower Rejection", group: "Structure", test: (s) => s.bbEvent === "rejection-lower" },
  { id: "smcAny", label: "Any Smart Money Event", group: "Structure", test: (s) => s.smc.length > 0 },
];

export interface BacktestResult {
  occurrences: number;
  decided: number;
  wins: number;
  losses: number;
  winRate: number;
  avgMove: number;
  avgAbsMove: number;
  roi: number;
  matches: RoundRecord[];
}

/**
 * Backtests a combination of conditions against stored rounds.
 * `side` is the direction being bet when all conditions match.
 * ROI assumes a 1.95x payout per winning round (PancakeSwap-style).
 */
export function runBacktest(records: RoundRecord[], conditionIds: string[], side: "UP" | "DOWN"): BacktestResult {
  const conds = BACKTEST_CONDITIONS.filter((c) => conditionIds.includes(c.id));
  const matches: RoundRecord[] = [];
  for (const r of records) {
    if (conds.every((c) => c.test(r.snapshot))) matches.push(r);
  }
  let wins = 0;
  let losses = 0;
  let moveSum = 0;
  let absSum = 0;
  for (const m of matches) {
    const signed = side === "UP" ? m.movePct : -m.movePct;
    moveSum += signed;
    absSum += Math.abs(m.movePct);
    if (m.result === "FLAT") continue;
    if (m.result === side) wins++;
    else losses++;
  }
  const decided = wins + losses;
  return {
    occurrences: matches.length,
    decided,
    wins,
    losses,
    winRate: decided > 0 ? (wins / decided) * 100 : 0,
    avgMove: matches.length > 0 ? moveSum / matches.length : 0,
    avgAbsMove: matches.length > 0 ? absSum / matches.length : 0,
    roi: decided > 0 ? ((wins * 0.95 - losses) / decided) * 100 : 0,
    matches,
  };
}
