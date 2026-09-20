/**
 * Condition Search — hunts history for the most predictable conditions and
 * then PROVES them forward. Every candidate condition is scored on the first
 * 60% of stored rounds (in-sample). Only conditions that cleared the bar
 * in-sample are checked against the untouched last 40% (out-of-sample).
 *
 *   proven      — cleared the bar in-sample AND held up out-of-sample
 *   failed      — looked good in-sample but did not survive the forward test
 *   observation — not enough samples either way yet
 *
 * The live entry gate consults this ledger: once at least one condition is
 * proven, a live setup must match one to be allowed through. That is how the
 * app learns when it truly knows — and when it should wait.
 *
 * Conditions are evaluated strictly from information available at decision
 * time (stored snapshots carry the pre-lock analysis), so there is no look-ahead.
 */

import { clamp, normCdf, shrinkFromRegime } from "./core";
import { DRIFT_MAX, STRUCT_MAX } from "./core";
import { bucketOf } from "./timeStructure";
import type { RoundRecord } from "./types";

export type ConditionSide = "UP" | "DOWN";

/** Everything known at decision time, for one round (live or stored). */
export interface ConditionContext {
  regimeKind?: "trend-up" | "trend-down" | "chop" | "storm";
  alignment?: "aligned" | "unconfirmed" | "conflict";
  zGap: number;
  zDrift: number;
  zStruct: number;
  zTime: number;
  pUp: number;
  quarter: number;
  slot: number;
}

interface ConditionDef {
  id: string;
  label: string;
  group: string;
  /** The side this condition bets when it matches, or null when it doesn't apply. */
  test: (c: ConditionContext) => ConditionSide | null;
}

const DEFS: ConditionDef[] = [
  {
    id: "trend-aligned",
    label: "Trend with 15m aligned",
    group: "Regime",
    test: (c) =>
      c.regimeKind === "trend-up" && c.alignment === "aligned"
        ? "UP"
        : c.regimeKind === "trend-down" && c.alignment === "aligned"
          ? "DOWN"
          : null,
  },
  {
    id: "trend-unconfirmed",
    label: "Trend, 15m unconfirmed",
    group: "Regime",
    test: (c) =>
      c.regimeKind === "trend-up" && c.alignment === "unconfirmed"
        ? "UP"
        : c.regimeKind === "trend-down" && c.alignment === "unconfirmed"
          ? "DOWN"
          : null,
  },
  {
    id: "trend-drift",
    label: "Trend + drift same direction",
    group: "Regime",
    test: (c) => {
      if (c.regimeKind !== "trend-up" && c.regimeKind !== "trend-down") return null;
      const dir = c.regimeKind === "trend-up" ? 1 : -1;
      return c.zDrift * dir >= 0.12 ? (dir > 0 ? "UP" : "DOWN") : null;
    },
  },
  {
    id: "gap-strong",
    label: "|gap| ≥ 1σ from lock",
    group: "Gap physics",
    test: (c) => (Math.abs(c.zGap) >= 1 ? (c.zGap > 0 ? "UP" : "DOWN") : null),
  },
  {
    id: "gap-moderate",
    label: "|gap| ≥ 0.6σ from lock",
    group: "Gap physics",
    test: (c) => (Math.abs(c.zGap) >= 0.6 ? (c.zGap > 0 ? "UP" : "DOWN") : null),
  },
  {
    id: "drift-strong",
    label: "Strong compressed drift (≥ 0.25)",
    group: "Drift",
    test: (c) => (Math.abs(c.zDrift) >= 0.25 ? (c.zDrift > 0 ? "UP" : "DOWN") : null),
  },
  {
    id: "gap-drift-agree",
    label: "Gap & drift agree (≥ 0.4σ + drift)",
    group: "Confluence",
    test: (c) =>
      Math.abs(c.zGap) >= 0.4 && Math.abs(c.zDrift) >= 0.12 && Math.sign(c.zGap) === Math.sign(c.zDrift)
        ? c.zGap > 0
          ? "UP"
          : "DOWN"
        : null,
  },
  {
    id: "struct-agree",
    label: "Structure confirms the gap",
    group: "Confluence",
    test: (c) =>
      Math.abs(c.zGap) >= 0.4 && Math.abs(c.zStruct) >= 0.05 && Math.sign(c.zGap) === Math.sign(c.zStruct)
        ? c.zGap > 0
          ? "UP"
          : "DOWN"
        : null,
  },
];

/** Rebuilds the decision-time context for a stored round (no look-ahead). */
export function conditionCtxOfRecord(r: RoundRecord): ConditionContext {
  const s = r.snapshot;
  const shrink = s.shrink ?? shrinkFromRegime(r.regimeKind);
  // Compressed drift reconstructed with equal drift-category weights — the same
  // partition the live engine uses, without needing the learned weights.
  const cats = s.categories;
  const wtd = (cats.trend + cats.momentum + cats.volume) / 3;
  const zBase = s.zBase ?? 0;
  const zGap = s.gapZ ?? 0;
  const zDrift = DRIFT_MAX * Math.tanh(wtd / 100) * shrink;
  const zStruct = STRUCT_MAX * Math.tanh(cats.structure / 100) * shrink;
  const zTime = clamp(zBase - zGap - zDrift - zStruct, -0.3, 0.3);
  const { quarter, slot } = bucketOf(r.startTime);
  return {
    regimeKind: r.regimeKind,
    alignment: s.regimeAlignment,
    zGap,
    zDrift,
    zStruct,
    zTime,
    pUp: r.predictedUp,
    quarter,
    slot,
  };
}

export type ConditionStatus = "proven" | "failed" | "observation";

export interface ConditionProof {
  id: string;
  label: string;
  group: string;
  /** In-sample (first 60% of history). */
  nIS: number;
  accIS: number;
  roiIS: number;
  /** Out-of-sample (last 40%, untouched during discovery). */
  nOOS: number;
  accOOS: number;
  roiOOS: number;
  status: ConditionStatus;
}

/** Discovery thresholds — deliberately strict. */
const MIN_IS_N = 40;
const MIN_IS_ACC = 0.57;
const MIN_OOS_N = 15;
const MIN_OOS_ACC = 0.54;
const MAX_OOS_DECAY = 0.07;

/** Scores every condition on history, proving the survivors forward. */
export function searchConditions(records: RoundRecord[]): ConditionProof[] {
  const usable = records.filter((r) => r.result !== "FLAT" && Number.isFinite(r.predictedUp));
  const cut = Math.floor(usable.length * 0.6);
  const ctxs = usable.map(conditionCtxOfRecord);

  return DEFS.map((def) => {
    const proof: ConditionProof = {
      id: def.id,
      label: def.label,
      group: def.group,
      nIS: 0,
      accIS: 0,
      roiIS: 0,
      nOOS: 0,
      accOOS: 0,
      roiOOS: 0,
      status: "observation",
    };
    const grade = (from: number, to: number): { n: number; wins: number } => {
      let n = 0;
      let wins = 0;
      for (let k = from; k < to; k++) {
        const side = def.test(ctxs[k]);
        if (side === null) continue;
        n++;
        if (usable[k].result === side) wins++;
      }
      return { n, wins };
    };
    const is = grade(0, cut);
    const oos = grade(cut, usable.length);
    proof.nIS = is.n;
    proof.accIS = is.n > 0 ? is.wins / is.n : 0;
    proof.roiIS = is.n > 0 ? ((is.wins * 0.95 - (is.n - is.wins)) / is.n) * 100 : 0;
    proof.nOOS = oos.n;
    proof.accOOS = oos.n > 0 ? oos.wins / oos.n : 0;
    proof.roiOOS = oos.n > 0 ? ((oos.wins * 0.95 - (oos.n - oos.wins)) / oos.n) * 100 : 0;

    const isGood = is.n >= MIN_IS_N && proof.accIS >= MIN_IS_ACC;
    const oosGood = oos.n >= MIN_OOS_N && proof.accOOS >= MIN_OOS_ACC && proof.accOOS >= proof.accIS - MAX_OOS_DECAY;
    proof.status = isGood ? (oosGood ? "proven" : "failed") : "observation";
    return proof;
  });
}

/**
 * Matches the live decision context against the ledger. Returns the first
 * PROVEN condition that currently applies, or null — and null is a verdict:
 * once the engine has proven conditions, setups that match none are waits.
 */
export function matchLiveCondition(
  proofs: ConditionProof[],
  ctx: ConditionContext,
): { proof: ConditionProof; side: ConditionSide } | null {
  for (const proof of proofs) {
    if (proof.status !== "proven") continue;
    const def = DEFS.find((d) => d.id === proof.id);
    if (!def) continue;
    const side = def.test(ctx);
    if (side !== null) return { proof, side };
  }
  return null;
}

/** Whether the ledger has produced at least one proven condition. */
export const hasProvenConditions = (proofs: ConditionProof[]): boolean =>
  proofs.some((p) => p.status === "proven");

/** Probability the current context implies — re-exported convenience for gates. */
export const sideProbability = (ctx: ConditionContext, side: ConditionSide): number =>
  clamp(side === "UP" ? ctx.pUp : 100 - ctx.pUp, 0, 100);

/** Brier-style sanity helper reused by the backtest for consistency checks. */
export const brierOf = (pPercent: number, won: boolean): number => (pPercent / 100 - (won ? 1 : 0)) ** 2;

/** Expected value at the default payout for a side (shared with the backtest gate). */
export const evAtPayout = (ctx: ConditionContext, side: ConditionSide, payout: number): number =>
  (sideProbability(ctx, side) / 100) * payout - 1;

/** Convenience for gates that want the Φ(z) probability of a context composite. */
export const probOfZ = (z: number): number => clamp(normCdf(z) * 100, 2, 98);
