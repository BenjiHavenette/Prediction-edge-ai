/**
 * Minimal mathematical core — the entire probability model in one place:
 *
 *   P(UP) = Φ( zGap + zDrift + zTime + zStruct )
 *
 * zGap   — distance from the lock price divided by the remaining volatility.
 *          This is the round's physical question: is the gap bigger than the
 *          noise the market can still produce before close?
 * zDrift — ONE directional drift value compressed from every indicator
 *          (trend + momentum + volume through learned weights). Confluence is
 *          deliberately excluded from the compression: it is derived from the
 *          other categories, so counting it would double count.
 * zTime  — time-structure adjustment learned from history (15-minute quarters ×
 *          5-minute positions), applied only when sample size AND walk-forward
 *          validation support it (see timeStructure.ts).
 * zStruct— a small, hard-capped structure term from market-structure events.
 *
 * Every term is expressed in standard-deviation units, so they add cleanly and
 * no signal can enter the model twice.
 */

import type { CoreOutput, PoolInfo, RoundRecord } from "./types";

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Standard normal CDF (Abramowitz–Stegun 26.2.17, |err| < 7.5e-8). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam's rational approximation, |err| < 1.15e-9). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** Hard cap on the compressed drift term (z units). The gap dominates late; drift is secondary. */
export const DRIFT_MAX = 0.55;
/** Hard cap on the structure term — deliberately small so it can only nudge, never drive. */
export const STRUCT_MAX = 0.14;
/** Hard cap on the learned time-structure adjustment. */
export const TIME_MAX = 0.3;
/** |z| below this (late in a locked round) means the outcome is inside random noise. */
export const COIN_FLIP_Z = 0.55;
/** Round length in seconds, used when no countdown is known. */
export const ROUND_SECONDS = 300;
/** PancakeSwap treasury fee taken from the prize pool. */
export const TREASURY_FEE = 0.03;
/** Fallback payout multiplier when live pools are unavailable. */
export const DEFAULT_PAYOUT = 1.95;

export interface CorePartsInput {
  /** (price − lock) / remaining σ. */
  zGap: number;
  /** Compressed indicator drift, −100..100 (weighted trend + momentum + volume). */
  wtd: number;
  /** Market-structure composite, −100..100. */
  structScore: number;
  /** Regime trust factor 0..1 (how much the tape lets indicators speak). */
  shrink: number;
  /** Pre-validated time-structure adjustment in z units (already shrunk upstream). */
  zTime?: number;
}

/** Combines the four core terms into the round probability. */
export function coreFromParts(input: CorePartsInput): CoreOutput {
  const shrink = clamp(input.shrink, 0, 1);
  const zDrift = DRIFT_MAX * Math.tanh(input.wtd / 100) * shrink;
  const zStruct = STRUCT_MAX * Math.tanh(input.structScore / 100) * shrink;
  const zTime = clamp(input.zTime ?? 0, -TIME_MAX, TIME_MAX);
  const zTotal = input.zGap + zDrift + zStruct + zTime;
  return {
    zGap: input.zGap,
    zDrift,
    zStruct,
    zTime,
    zTotal,
    shrink,
    pUp: clamp(normCdf(zTotal) * 100, 2, 98),
  };
}

// ---------------- Volatility ----------------

/** Realized 1-minute dollar volatility over the last ~45 closed bars. */
export function sigma1mOf(candles: { close: number }[], index: number, atr: number, price: number): number {
  const start = Math.max(1, index - 44);
  const diffs: number[] = [];
  for (let j = start; j <= index; j++) diffs.push(candles[j].close - candles[j - 1].close);
  let sigma = 0;
  if (diffs.length >= 8) {
    const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    const variance = diffs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / diffs.length;
    sigma = Math.sqrt(variance);
  }
  return Math.max(sigma, atr * 0.5, price * 0.00005);
}

/** Scales 1-minute volatility to the time left in the round (Brownian scaling). */
export const sigmaRemainingOf = (sigma1m: number, secondsLeft: number): number =>
  sigma1m * Math.sqrt(Math.max(secondsLeft, 5) / 60);

/** Gap below this is statistically meaningless noise. */
export const noiseFloorOf = (sigmaRemaining: number): number => 0.5 * sigmaRemaining;

// ---------------- Payouts & expected value ----------------

export interface PayoutInfo {
  payoutUp: number | null;
  payoutDown: number | null;
  crowd: "up-heavy" | "down-heavy" | "balanced" | null;
  /** True when the 1.95x fallback is used instead of live pools. */
  estimated: boolean;
}

/** Live payout multipliers from the round's prize pool (null when pool unknown/too small). */
export function payoutsOf(pool: PoolInfo | null): PayoutInfo {
  if (pool && pool.totalBnb > 0 && pool.bullBnb > 0 && pool.bearBnb > 0) {
    return {
      payoutUp: (pool.totalBnb / pool.bullBnb) * (1 - TREASURY_FEE),
      payoutDown: (pool.totalBnb / pool.bearBnb) * (1 - TREASURY_FEE),
      crowd:
        pool.bullBnb > pool.bearBnb * 1.25
          ? "up-heavy"
          : pool.bearBnb > pool.bullBnb * 1.25
            ? "down-heavy"
            : "balanced",
      estimated: false,
    };
  }
  return { payoutUp: null, payoutDown: null, crowd: null, estimated: true };
}

/** Expected value per 1 staked at `payout` for a side with `pPercent` win probability. */
export const evOf = (pPercent: number, payout: number): number => (pPercent / 100) * payout - 1;

// ---------------- Dynamic EV gate ----------------

export interface EvGateContext {
  /** True when the model's recent logged calls are running below 45%. */
  cold: boolean;
  /** Number of decided (graded) calls on record. */
  decidedSample: number;
  /** Mean absolute calibration error in probability points (null when unknown). */
  meanGapPct: number | null;
}

/**
 * The decision gate is expected value with a small DYNAMIC threshold:
 * 1.5% base, rising while the model is cold, unproven on few samples, or
 * measurably miscalibrated — because EV computed from a badly calibrated
 * probability is not edge, it is wishful thinking.
 */
export function evThreshold(ctx: EvGateContext): number {
  let t = 0.015;
  if (ctx.cold) t += 0.02;
  if (ctx.decidedSample < 30) t += 0.01;
  if (ctx.meanGapPct !== null && ctx.meanGapPct > 6) t += 0.01;
  return Math.min(t, 0.05);
}

// ---------------- Record → core inputs (shared by backtest & condition search) ----------------

/** Trust factor inferred from the stored regime when the record predates `shrink` snapshots. */
export function shrinkFromRegime(kind: RoundRecord["regimeKind"]): number {
  if (kind === "trend-up" || kind === "trend-down") return 0.85;
  if (kind === "storm") return 0.18;
  if (kind === "chop") return 0.28;
  return 0.6;
}

/**
 * Pre-time z composite for a stored round. New records carry it exactly
 * (snapshot.zBase); older ones are inverted from their own stored probability,
 * which is the best causal reconstruction available.
 */
export function zBaseOfRecord(r: RoundRecord): number {
  const z = r.snapshot.zBase;
  if (typeof z === "number" && Number.isFinite(z)) return z;
  const p = clamp(r.predictedUp / 100, 0.02, 0.98);
  return normInv(p);
}
