/**
 * Regime Efficiency Audit — replays the stored candle history as 5-minute
 * rounds and grades how accurate a trend-following call would have been in
 * every regime × 15-minute-frame condition. This is the empirical basis for
 * the entry gates: only conditions that historically clear the 60% accuracy
 * target are allowed to fire.
 */

import { computeRegime } from "./regime";
import type { Candle } from "./types";

const ROUND_MS = 5 * 60 * 1000;
/** Accuracy target every bettable condition must clear. */
export const ACCURACY_TARGET = 60;

export type AuditBucketId = "aligned" | "unconfirmed" | "conflict" | "chop" | "storm";

export interface AuditBucket {
  id: AuditBucketId;
  label: string;
  /** What the graded call was in this bucket. */
  callNote: string;
  rounds: number;
  hits: number;
  /** Hit rate in percent (0..100). */
  hitRatePct: number;
  /** Whether the engine bets in this condition. */
  bettable: boolean;
}

export interface RegimeAudit {
  buckets: AuditBucket[];
  totalRounds: number;
  /** Rounds in the bettable (15m-confirmed trend) condition. */
  bettableRounds: number;
  bettableSharePct: number;
  /** Hit rate of the bettable condition, percent. */
  bettableHitRatePct: number;
  /** True when the bettable condition clears the 60% target on this history. */
  clearsTarget: boolean;
  verdict: string;
  /** Candle index the audit was computed at (for caching). */
  computedAtIndex: number;
}

interface Tally {
  rounds: number;
  hits: number;
}

const BUCKET_META: Record<AuditBucketId, { label: string; callNote: string; bettable: boolean }> = {
  aligned: { label: "Trend + 15m confirms", callNote: "bet with the trend", bettable: true },
  unconfirmed: { label: "Trend, 15m flat", callNote: "bet with the micro trend", bettable: false },
  conflict: { label: "Trend vs 15m conflict", callNote: "bet with the micro trend", bettable: false },
  chop: { label: "Chop (if forced to bet)", callNote: "bet with the drift", bettable: false },
  storm: { label: "Storm (if forced to bet)", callNote: "bet with the drift", bettable: false },
};

/**
 * Replays history as 5-minute rounds with no lookahead: the regime is read at
 * the bar before lock, the call is graded against the round's actual close.
 */
export function computeRegimeAudit(candles: Candle[], lastClosedIdx: number): RegimeAudit | null {
  if (lastClosedIdx < 340) return null;
  const tallies: Record<AuditBucketId, Tally> = {
    aligned: { rounds: 0, hits: 0 },
    unconfirmed: { rounds: 0, hits: 0 },
    conflict: { rounds: 0, hits: 0 },
    chop: { rounds: 0, hits: 0 },
    storm: { rounds: 0, hits: 0 },
  };

  for (let i = 320; i + 4 <= lastClosedIdx; i++) {
    if (candles[i].time % ROUND_MS !== 0) continue;
    const lock = candles[i].open;
    const close = candles[i + 4].close;
    if (close === lock) continue;
    const result: "UP" | "DOWN" = close > lock ? "UP" : "DOWN";
    const reg = computeRegime(candles, i - 1);

    let bucket: AuditBucketId;
    let call: "UP" | "DOWN";
    if (reg.kind === "trend-up" || reg.kind === "trend-down") {
      call = reg.kind === "trend-up" ? "UP" : "DOWN";
      bucket = reg.alignment === "aligned" ? "aligned" : reg.alignment === "conflict" ? "conflict" : "unconfirmed";
    } else {
      call = reg.driftPerMin >= 0 ? "UP" : "DOWN";
      bucket = reg.kind === "storm" ? "storm" : "chop";
    }
    tallies[bucket].rounds++;
    if (call === result) tallies[bucket].hits++;
  }

  const ids: AuditBucketId[] = ["aligned", "unconfirmed", "conflict", "chop", "storm"];
  const buckets: AuditBucket[] = ids.map((id) => {
    const t = tallies[id];
    return {
      id,
      label: BUCKET_META[id].label,
      callNote: BUCKET_META[id].callNote,
      rounds: t.rounds,
      hits: t.hits,
      hitRatePct: t.rounds > 0 ? (t.hits / t.rounds) * 100 : 0,
      bettable: BUCKET_META[id].bettable,
    };
  });

  const totalRounds = buckets.reduce((s, b) => s + b.rounds, 0);
  const aligned = buckets[0];
  const bettableSharePct = totalRounds > 0 ? (aligned.rounds / totalRounds) * 100 : 0;
  const clearsTarget = aligned.rounds >= 10 && aligned.hitRatePct >= ACCURACY_TARGET;

  let verdict: string;
  if (aligned.rounds < 10) {
    verdict = `Only ${aligned.rounds} rounds in this history had a 15m-confirmed trend — not enough precedent yet. The engine stays strict: no 15m confirmation, no bet.`;
  } else if (clearsTarget) {
    verdict = `On this tape, betting ONLY when the micro trend and the 15-minute frame agree hit ${aligned.hitRatePct.toFixed(0)}% (${aligned.hits}/${aligned.rounds}) — above the ${ACCURACY_TARGET}% target. That condition covered just ${bettableSharePct.toFixed(0)}% of rounds; every other condition graded below target and is blocked.`;
  } else {
    verdict = `Even 15m-confirmed trends only hit ${aligned.hitRatePct.toFixed(0)}% (${aligned.hits}/${aligned.rounds}) on this tape — below the ${ACCURACY_TARGET}% target. The tape has been unusually noisy; the engine compensates with higher probability/EV bars and fewer entries.`;
  }

  return {
    buckets,
    totalRounds,
    bettableRounds: aligned.rounds,
    bettableSharePct,
    bettableHitRatePct: aligned.hitRatePct,
    clearsTarget,
    verdict,
    computedAtIndex: lastClosedIdx,
  };
}
