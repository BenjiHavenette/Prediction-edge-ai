/**
 * Time-Structure Engine — learns whether the hour leaves fingerprints on
 * round outcomes. PancakeSwap rounds settle every 5 minutes, so each hour
 * contains four 15-minute quarters × three 5-minute positions. If certain
 * quarters or positions show systematically better calibration under similar
 * conditions, the difference becomes a small contextual adjustment to the
 * core probability — but ONLY when both sample size and walk-forward
 * validation support it. Unproven buckets contribute exactly zero.
 *
 * Recalculated continuously: every settled round reshapes the model, no
 * timers, no fixed retrain windows.
 */

import { TIME_MAX, clamp, normCdf, normInv } from "./core";
import type { RoundRecord } from "./types";

export const QUARTER_COUNT = 4;
export const SLOT_COUNT = 3;
/** Samples a bucket needs before its offset can be applied. */
export const MIN_BUCKET_N = 15;
/** Total usable rounds required before validation is even attempted. */
export const MIN_MODEL_SAMPLES = 120;
/** Per-bucket sample shrinkage: trust grows as n/(n+K). */
const SHRINK_K = 40;
/** Probability-point error → z-units conversion (1/Φ′(0) ≈ 2.507, damped). */
const ERR_TO_Z = 2.2;

export interface TimeBucketKey {
  /** Quarter of the hour the round settles in (0..3). */
  quarter: number;
  /** 5-minute position within the quarter (0..2). */
  slot: number;
}

export const bucketOf = (startTime: number): TimeBucketKey => {
  const minuteOfHour = Math.floor((startTime % 3_600_000) / 60_000);
  return { quarter: Math.floor(minuteOfHour / 15), slot: Math.floor((minuteOfHour % 15) / 5) };
};

export const bucketLabel = (b: TimeBucketKey): string =>
  `Q${b.quarter + 1} · ${b.slot * 5}–${b.slot * 5 + 5}m`;

export interface TimeBucketStat extends TimeBucketKey {
  label: string;
  n: number;
  /** Mean predicted UP probability (0..1). */
  avgPredicted: number;
  /** Realized UP rate (0..1). */
  realized: number;
  /** Shrunk adjustment in z units — applied ONLY when `active`. */
  zAdj: number;
  active: boolean;
}

export interface TimeStructureModel {
  buckets: TimeBucketStat[];
  /** True when walk-forward validation confirmed the adjustments help. */
  valid: boolean;
  samples: number;
  /** Held-out Brier score without the time adjustment. */
  brierBase: number;
  /** Held-out Brier score with the time adjustment. */
  brierAdj: number;
  /** brierBase − brierAdj; positive means the adjustment helps. */
  improvement: number;
  /** Walk-forward folds (of 2) where the adjustment did not hurt. */
  foldsPassed: number;
  note: string;
}

interface BucketAcc {
  n: number;
  sumPred: number;
  sumReal: number;
}

const usableRecords = (records: RoundRecord[]): RoundRecord[] =>
  records.filter((r) => r.result !== "FLAT" && Number.isFinite(r.predictedUp) && r.predictedUp > 0);

function collect(records: RoundRecord[]): BucketAcc[] {
  const acc: BucketAcc[] = Array.from({ length: QUARTER_COUNT * SLOT_COUNT }, () => ({ n: 0, sumPred: 0, sumReal: 0 }));
  for (const r of records) {
    const { quarter, slot } = bucketOf(r.startTime);
    const a = acc[quarter * SLOT_COUNT + slot];
    a.n++;
    a.sumPred += r.predictedUp / 100;
    a.sumReal += r.result === "UP" ? 1 : 0;
  }
  return acc;
}

/** Raw offsets: realized minus predicted, converted to z units and shrunk by sample size. */
function offsetsFrom(acc: BucketAcc[]): number[] {
  return acc.map((a) => {
    if (a.n === 0) return 0;
    const err = (a.sumReal - a.sumPred) / a.n;
    return clamp(err * ERR_TO_Z, -TIME_MAX, TIME_MAX) * (a.n / (a.n + SHRINK_K));
  });
}

/**
 * Fits the time-structure model from settled rounds. Validation is strictly
 * walk-forward: offsets are trained only on data BEFORE each holdout fold,
 * and the adjustment is kept only if it improves the Brier score on BOTH
 * holdout folds. Anything less and the model reports valid=false — every
 * bucket then stays inert (zAdj reported but never applied).
 */
export function fitTimeModel(records: RoundRecord[]): TimeStructureModel {
  const usable = usableRecords(records);
  const samples = usable.length;
  const all = collect(usable);
  const buckets: TimeBucketStat[] = all.map((a, idx) => {
    const key: TimeBucketKey = { quarter: Math.floor(idx / SLOT_COUNT), slot: idx % SLOT_COUNT };
    const raw = offsetsFrom([a])[0];
    return {
      ...key,
      label: bucketLabel(key),
      n: a.n,
      avgPredicted: a.n > 0 ? a.sumPred / a.n : 0.5,
      realized: a.n > 0 ? a.sumReal / a.n : 0.5,
      zAdj: raw,
      active: false,
    };
  });

  if (samples < MIN_MODEL_SAMPLES) {
    return {
      buckets,
      valid: false,
      samples,
      brierBase: 0,
      brierAdj: 0,
      improvement: 0,
      foldsPassed: 0,
      note: `Learning — ${samples}/${MIN_MODEL_SAMPLES} settled rounds. Time buckets stay inert until there is enough history to validate.`,
    };
  }

  // Walk-forward validation: two expanding holdout folds, offsets trained on the past only.
  const cut1 = Math.floor(samples * 0.5);
  const cut2 = Math.floor(samples * 0.66);
  let brierBase = 0;
  let brierAdj = 0;
  let foldsPassed = 0;
  for (const cut of [cut1, cut2]) {
    const train = collect(usable.slice(0, cut));
    const offs = offsetsFrom(train).map((o, idx) => (train[idx].n >= MIN_BUCKET_N ? o : 0));
    let fBase = 0;
    let fAdj = 0;
    for (const r of usable.slice(cut)) {
      const z = normInv(clamp(r.predictedUp / 100, 0.02, 0.98));
      const real = r.result === "UP" ? 1 : 0;
      const { quarter, slot } = bucketOf(r.startTime);
      const pBase = normCdf(z);
      const pAdj = normCdf(z + offs[quarter * SLOT_COUNT + slot]);
      fBase += (pBase - real) ** 2;
      fAdj += (pAdj - real) ** 2;
    }
    if (fAdj <= fBase) foldsPassed++;
    brierBase += fBase;
    brierAdj += fAdj;
  }
  const improvement = (brierBase - brierAdj) / Math.max(samples, 1);
  const valid = foldsPassed === 2 && improvement > 0;

  for (const b of buckets) b.active = valid && b.n >= MIN_BUCKET_N && Math.abs(b.zAdj) > 0.005;

  const note = valid
    ? `Validated walk-forward: Brier ${(brierBase / samples).toFixed(4)} → ${(brierAdj / samples).toFixed(4)} on held-out folds (${buckets.filter((b) => b.active).length}/${buckets.length} buckets active).`
    : `Held out of the model — walk-forward validation did not confirm an edge (folds passed ${foldsPassed}/2, Brier Δ ${(improvement * 100).toFixed(2)}pp). Predictions run without time adjustments.`;

  return { buckets, valid, samples, brierBase: brierBase / samples, brierAdj: brierAdj / samples, improvement, foldsPassed, note };
}

/** The z adjustment that applies to a round starting at `startTime` — zero unless validated and active. */
export function activeTimeAdjustment(model: TimeStructureModel | null | undefined, startTime: number): number {
  if (!model || !model.valid) return 0;
  const { quarter, slot } = bucketOf(startTime);
  const b = model.buckets[quarter * SLOT_COUNT + slot];
  return b && b.active ? b.zAdj : 0;
}
