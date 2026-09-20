/**
 * Walk-Forward Backtest — replays stored rounds with strict no-look-ahead.
 *
 * At every round k the model may only use:
 *   - the round's own pre-lock snapshot (captured at decision time, before the
 *     outcome existed), and
 *   - parameters fitted exclusively on rounds settled BEFORE k
 *     (category weights and the time-structure model, refreshed every 25
 *     rounds — walk-forward, never full-history fits).
 *
 * The decision gate mirrors the live engine: expected value against a small
 * dynamic threshold (raised while the rolling recent form is cold), riding
 * only with the trend regime, and never into a 15m conflict.
 */

import { computeLearning } from "./learning";
import type { CategoryWeights } from "./learning";
import { COIN_FLIP_Z, DEFAULT_PAYOUT, clamp, coreFromParts, evOf, shrinkFromRegime } from "./core";
import type { CorePartsInput } from "./core";
import { activeTimeAdjustment, fitTimeModel } from "./timeStructure";
import { searchConditions } from "./conditionSearch";
import type { ConditionProof } from "./conditionSearch";
import { computeCalibration } from "./calibration";
import type { CalibrationReport } from "./calibration";
import type { RoundRecord } from "./types";

export interface WalkForwardPoint {
  time: number;
  bank: number;
  pUp: number;
  bet: "UP" | "DOWN" | null;
  /** null when no bet was placed. */
  win: boolean | null;
}

export interface WalkForwardResult {
  rounds: number;
  decided: number;
  wins: number;
  hitRate: number;
  /** Net ROI per decided bet in % (1.95x payout, 1-unit flat stake). */
  roi: number;
  finalBank: number;
  maxDrawdown: number;
  /** Share of rounds that produced a bet (lower = more selective). */
  selectivity: number;
  /** Brier score of the walk-forward probabilities. */
  brier: number;
  /** How many times parameters were refit on past-only data. */
  refreshes: number;
  curve: WalkForwardPoint[];
  calibration: CalibrationReport;
  conditions: ConditionProof[];
}

const WARMUP = 60;
const REFRESH = 25;
const BASE_EV_GATE = 0.02;
const COLD_EV_GATE = 0.045;
const FLAT_WIN = 0.95;

/** Weighted drift score from stored categories using the given weights (same partition as live). */
function driftScoreOf(cats: RoundRecord["snapshot"]["categories"], w: CategoryWeights): number {
  const sum = w.trend + w.momentum + w.volume || 1;
  return (w.trend * cats.trend + w.momentum * cats.momentum + w.volume * cats.volume) / sum;
}

function partsOfRecord(r: RoundRecord, weights: CategoryWeights, timeModel: ReturnType<typeof fitTimeModel> | null): CorePartsInput {
  const s = r.snapshot;
  return {
    zGap: s.gapZ ?? 0,
    wtd: driftScoreOf(s.categories, weights),
    structScore: s.categories.structure,
    shrink: s.shrink ?? shrinkFromRegime(r.regimeKind),
    zTime: activeTimeAdjustment(timeModel, r.startTime),
  };
}

export function runWalkForward(records: RoundRecord[]): WalkForwardResult {
  const sorted = [...records].sort((a, b) => a.startTime - b.startTime);
  const rounds = Math.max(0, sorted.length - WARMUP);
  const curve: WalkForwardPoint[] = [];
  const empty: WalkForwardResult = {
    rounds: 0,
    decided: 0,
    wins: 0,
    hitRate: 0,
    roi: 0,
    finalBank: 1,
    maxDrawdown: 0,
    selectivity: 0,
    brier: 0,
    refreshes: 0,
    curve: [],
    calibration: computeCalibration([]),
    conditions: [],
  };
  if (sorted.length <= WARMUP) return empty;

  let weights = computeLearning(sorted.slice(0, WARMUP)).weights;
  let timeModel = fitTimeModel(sorted.slice(0, WARMUP));
  let refreshes = 0;

  let bank = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let decided = 0;
  let wins = 0;
  let brierSum = 0;
  const recent: boolean[] = [];

  for (let k = WARMUP; k < sorted.length; k++) {
    const r = sorted[k];
    if ((k - WARMUP) % REFRESH === 0) {
      weights = computeLearning(sorted.slice(0, k)).weights;
      timeModel = fitTimeModel(sorted.slice(0, k));
      refreshes++;
    }

    const core = coreFromParts(partsOfRecord(r, weights, timeModel));
    const real = r.result === "UP" ? 1 : 0;
    brierSum += (core.pUp / 100 - real) ** 2;

    // ---- Decision gate (mirror of the live advisor, pre-lock only) ----
    let bet: "UP" | "DOWN" | null = null;
    const trending = r.regimeKind === "trend-up" || r.regimeKind === "trend-down";
    const conflict = r.snapshot.regimeAlignment === "conflict";
    if (trending && !conflict && r.result !== "FLAT" && Math.abs(core.zTotal) >= COIN_FLIP_Z * 0.5) {
      const cold = recent.length >= 8 && recent.slice(-8).filter(Boolean).length < 4;
      const thr = cold ? COLD_EV_GATE : BASE_EV_GATE;
      const evUp = evOf(core.pUp, DEFAULT_PAYOUT);
      const evDown = evOf(100 - core.pUp, DEFAULT_PAYOUT);
      const side: "UP" | "DOWN" = evUp >= evDown ? "UP" : "DOWN";
      const ev = side === "UP" ? evUp : evDown;
      const trendDir: "UP" | "DOWN" = r.regimeKind === "trend-up" ? "UP" : "DOWN";
      const pSide = side === "UP" ? core.pUp : 100 - core.pUp;
      if (side === trendDir && ev >= thr && pSide >= 53) bet = side;
    }

    let win: boolean | null = null;
    if (bet !== null) {
      decided++;
      win = r.result === bet;
      bank += win ? FLAT_WIN : -1;
      peak = Math.max(peak, bank);
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - bank) / peak : 0);
      if (win) wins++;
      recent.push(win);
      if (recent.length > 24) recent.shift();
    }
    curve.push({ time: r.startTime, bank, pUp: core.pUp, bet, win });
  }

  // Calibration on the walk-forward probabilities (side-confidence buckets).
  const wfInput = curve.map((p, idx) => ({
    predictedUp: Math.round(clamp(p.pUp, 2, 98)),
    result: sorted[WARMUP + idx].result,
  }));

  return {
    rounds,
    decided,
    wins,
    hitRate: decided > 0 ? wins / decided : 0,
    roi: decided > 0 ? ((wins * FLAT_WIN - (decided - wins)) / decided) * 100 : 0,
    finalBank: bank,
    maxDrawdown,
    selectivity: rounds > 0 ? decided / rounds : 0,
    brier: curve.length > 0 ? brierSum / curve.length : 0,
    refreshes,
    curve,
    calibration: computeCalibration(wfInput),
    conditions: searchConditions(sorted),
  };
}

