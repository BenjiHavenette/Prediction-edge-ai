/**
 * Calibration — measures whether the model's probabilities mean what they say.
 * Rounds are grouped by side-confidence (the larger of P(UP) and P(DOWN)) into
 * buckets, and each bucket's realized win rate is compared with its average
 * predicted probability. The gap between them — and the Brier score — feed
 * the dynamic EV gate: a badly calibrated model must clear a higher bar
 * before it is allowed to call an edge.
 *
 * Recomputed on every settled round, continuously.
 */

import type { RoundRecord } from "./types";

/** Minimal shape calibration needs — real records and backtest projections both satisfy it. */
type CalibrationInput = ReadonlyArray<Pick<RoundRecord, "predictedUp" | "result">>;

export interface CalibrationBucketStat {
  label: string;
  /** Lower bound of the side-confidence range in % (inclusive). */
  lo: number;
  hi: number;
  n: number;
  /** Mean predicted side-confidence (0..1). */
  avgPredicted: number;
  /** Realized win rate of the predicted side (0..1). */
  realized: number;
  /** realized − avgPredicted in probability points. */
  gapPp: number;
  /** Mean Brier contribution of this bucket. */
  brier: number;
}

export interface CalibrationReport {
  buckets: CalibrationBucketStat[];
  /** Overall Brier score (lower is better; 0.25 = coin flip). */
  brier: number;
  /** Graded rounds used. */
  samples: number;
  /** Sample-weighted mean |predicted − realized| in probability points. */
  meanGap: number;
  /** Mean predicted UP minus realized UP rate, in points (positive = overconfident on UP). */
  biasUp: number;
}

const RANGES: { label: string; lo: number; hi: number }[] = [
  { label: "50–55%", lo: 50, hi: 55 },
  { label: "55–60%", lo: 55, hi: 60 },
  { label: "60–65%", lo: 60, hi: 65 },
  { label: "65–70%", lo: 65, hi: 70 },
  { label: "70–75%", lo: 70, hi: 75 },
  { label: "75–85%", lo: 75, hi: 85 },
  { label: "85%+", lo: 85, hi: 101 },
];

export function computeCalibration(records: CalibrationInput): CalibrationReport {
  const buckets = RANGES.map((r) => ({ ...r, n: 0, sumPred: 0, wins: 0, brierSum: 0 }));
  let totalBrier = 0;
  let samples = 0;
  let upPred = 0;
  let upReal = 0;
  let ups = 0;

  for (const r of records) {
    if (r.result === "FLAT" || !Number.isFinite(r.predictedUp)) continue;
    const pUp = r.predictedUp / 100;
    const sideUp = pUp >= 0.5;
    const conf = sideUp ? pUp : 1 - pUp;
    const win = (r.result === "UP") === sideUp ? 1 : 0;
    const idx = RANGES.findIndex((rg) => conf * 100 >= rg.lo && conf * 100 < rg.hi);
    if (idx >= 0) {
      const b = buckets[idx];
      b.n++;
      b.sumPred += conf;
      b.wins += win;
      b.brierSum += (conf - win) ** 2;
    }
    totalBrier += (pUp - (r.result === "UP" ? 1 : 0)) ** 2;
    samples++;
    upPred += pUp;
    ups += r.result === "UP" ? 1 : 0;
    upReal += r.result === "UP" ? 1 : 0;
  }

  const stats: CalibrationBucketStat[] = buckets.map((b) => {
    const avgPredicted = b.n > 0 ? b.sumPred / b.n : 0;
    const realized = b.n > 0 ? b.wins / b.n : 0;
    return {
      label: b.label,
      lo: b.lo,
      hi: b.hi,
      n: b.n,
      avgPredicted,
      realized,
      gapPp: b.n > 0 ? (realized - avgPredicted) * 100 : 0,
      brier: b.n > 0 ? b.brierSum / b.n : 0,
    };
  });

  const graded = stats.reduce((s, b) => s + b.n, 0);
  const meanGap = graded > 0 ? stats.reduce((s, b) => s + Math.abs(b.gapPp) * b.n, 0) / graded : 0;

  return {
    buckets: stats,
    brier: samples > 0 ? totalBrier / samples : 0,
    samples,
    meanGap,
    biasUp: samples > 0 ? (upPred / samples) * 100 - (upReal / samples) * 100 : 0,
  };
}
