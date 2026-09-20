/**
 * Fifth Dimension Engine — models the dimensions the indicator stack can't see:
 *
 * 1. Gap physics — probability the price ends above the lock given the current
 *    gap, remaining time and realized volatility (Brownian close model).
 * 2. Time decay — the gap model's weight grows as the round runs out; in the
 *    final minute the gap, not the indicators, decides the outcome.
 * 3. Noise floor — when the gap is inside random noise the round is a coin
 *    flip and NO bet has an edge.
 * 4. Payout gravity — expected value per side from the live prize pools; a
 *    crowd-heavy side (thin payout) can be negative-EV even when it wins.
 */

import type { Candle, FifthDimension, PoolInfo, Signal } from "./types";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Standard normal CDF (Abramowitz–Stegun 26.2.17, |err| < 7.5e-8). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** PancakeSwap treasury fee taken from the prize pool. */
const TREASURY_FEE = 0.03;
/** Fallback payout multiplier when live pools are unavailable. */
const DEFAULT_PAYOUT = 1.95;
/** Round length used for time-decay weighting, seconds. */
const ROUND_SECONDS = 300;

export interface FifthInput {
  candles: Candle[];
  /** Index of the last closed candle. */
  index: number;
  price: number;
  lockPrice: number | null;
  secondsLeft: number | null;
  atr: number;
  /** UP probability (0..100) from the indicator stack alone. */
  indicatorUpProb: number;
  pool: PoolInfo | null;
}

export interface FifthResult {
  fifth: FifthDimension;
  /** Final UP probability (0..100) after blending the gap model in. */
  blendedUpProb: number;
}

/** Runs the Fifth Dimension model and blends it with the indicator probability. */
export function computeFifthDimension(input: FifthInput): FifthResult {
  const { candles, index, price, lockPrice, pool } = input;
  const secondsLeft = input.secondsLeft ?? ROUND_SECONDS;

  // Realized 1-minute dollar volatility from the recent closed bars.
  const start = Math.max(1, index - 44);
  const diffs: number[] = [];
  for (let j = start; j <= index; j++) diffs.push(candles[j].close - candles[j - 1].close);
  let sigma1m = 0;
  if (diffs.length >= 8) {
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const variance = diffs.reduce((s, d) => s + (d - mean) * (d - mean), 0) / diffs.length;
    sigma1m = Math.sqrt(variance);
  }
  sigma1m = Math.max(sigma1m, input.atr * 0.5, price * 0.00005);

  const sigmaRemaining = sigma1m * Math.sqrt(Math.max(secondsLeft, 5) / 60);
  const noiseFloor = 0.5 * sigmaRemaining;

  const hasLock = lockPrice !== null && lockPrice > 0;
  const gap = hasLock ? price - lockPrice : 0;
  const zScore = hasLock && sigmaRemaining > 0 ? gap / sigmaRemaining : 0;
  const gapProbUp = clamp(normCdf(zScore) * 100, 2, 98);

  // Time decay: indicators dominate early, the gap model dominates late.
  const elapsedFrac = clamp(1 - secondsLeft / ROUND_SECONDS, 0, 1);
  const blendWeight = hasLock ? 0.12 + 0.78 * Math.pow(elapsedFrac, 1.6) : 0;
  const blendedUpProb = blendWeight * gapProbUp + (1 - blendWeight) * input.indicatorUpProb;

  // Coin-flip zone: late in the round with the gap buried inside noise.
  // Widened after live losses at $0.80 and $3.12 gaps — these are unwinnable.
  const coinFlip = hasLock && secondsLeft <= 180 && Math.abs(zScore) < 0.55;

  // Payout gravity from the live prize pools.
  let payoutUp: number | null = null;
  let payoutDown: number | null = null;
  let crowd: FifthDimension["crowd"] = null;
  let evEstimated = true;
  if (pool && pool.totalBnb > 0 && pool.bullBnb > 0 && pool.bearBnb > 0) {
    payoutUp = (pool.totalBnb / pool.bullBnb) * (1 - TREASURY_FEE);
    payoutDown = (pool.totalBnb / pool.bearBnb) * (1 - TREASURY_FEE);
    crowd =
      pool.bullBnb > pool.bearBnb * 1.25
        ? "up-heavy"
        : pool.bearBnb > pool.bullBnb * 1.25
          ? "down-heavy"
          : "balanced";
    evEstimated = false;
  }
  const pUp = blendedUpProb / 100;
  const evUp = pUp * (payoutUp ?? DEFAULT_PAYOUT) - 1;
  const evDown = (1 - pUp) * (payoutDown ?? DEFAULT_PAYOUT) - 1;

  const signals: Signal[] = [];
  if (hasLock) {
    const insideNoise = Math.abs(gap) < noiseFloor;
    signals.push({
      label: insideNoise ? "Gap buried inside noise floor" : `Gap ${Math.abs(zScore).toFixed(1)}σ ${gap >= 0 ? "above" : "below"} lock`,
      direction: insideNoise ? "neutral" : gap >= 0 ? "bull" : "bear",
      detail: `${gap >= 0 ? "+" : "−"}$${Math.abs(gap).toFixed(2)} vs ±$${noiseFloor.toFixed(2)}`,
    });
    signals.push({
      label: "Physics close model",
      direction: gapProbUp >= 55 ? "bull" : gapProbUp <= 45 ? "bear" : "neutral",
      detail: `${gapProbUp.toFixed(0)}% UP`,
    });
  }
  if (crowd === "down-heavy" && payoutDown !== null) {
    signals.push({ label: "Crowd stacked on DOWN — thin payout", direction: "neutral", detail: `${payoutDown.toFixed(2)}x` });
  } else if (crowd === "up-heavy" && payoutUp !== null) {
    signals.push({ label: "Crowd stacked on UP — thin payout", direction: "neutral", detail: `${payoutUp.toFixed(2)}x` });
  }
  if (coinFlip) {
    signals.push({ label: "Coin-flip zone — stand down", direction: "neutral", detail: `${Math.round(secondsLeft)}s left` });
  }

  let verdict: string;
  if (coinFlip) {
    verdict = "Outcome is inside random noise — any bet here is a coin flip. Stand down.";
  } else if (evUp <= 0 && evDown <= 0) {
    verdict = evEstimated
      ? "Neither side clears the payout breakeven — no statistical edge."
      : "Crowd-skewed payouts: both sides carry negative expected value.";
  } else {
    const side = evUp >= evDown ? "UP" : "DOWN";
    const ev = Math.max(evUp, evDown);
    verdict = `${side} is the +EV side: ${(ev * 100).toFixed(1)}% expected value per bet${evEstimated ? " (est. payout)" : ""}.`;
  }

  return {
    fifth: {
      gap,
      sigmaRemaining,
      noiseFloor,
      zScore,
      gapProbUp,
      blendWeight,
      coinFlip,
      payoutUp,
      payoutDown,
      evUp,
      evDown,
      evEstimated,
      crowd,
      signals,
      verdict,
    },
    blendedUpProb,
  };
}
