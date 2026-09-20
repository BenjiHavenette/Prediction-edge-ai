/**
 * Learning Engine — turns the stored round database into a self-improving model:
 *
 * 1. Adaptive weights — each scoring category (trend, momentum, volume,
 *    structure, confluence) is graded against actual round outcomes. Categories
 *    that empirically predict outcomes get more weight; categories that don't
 *    get cut. Weights shrink toward the baseline until enough samples exist.
 * 2. Calibration — buckets predicted UP probability vs the realized UP rate so
 *    the model (and the user) can see where it is over- or under-confident.
 */

import type { CategoryScores, RoundRecord } from "./types";

export interface CategoryWeights {
  trend: number;
  momentum: number;
  volume: number;
  structure: number;
  confluence: number;
}

/** Hand-tuned baseline weights (Trend 25%, Momentum 20%, Volume 20%, Structure 15%, Confluence 20%). */
export const BASE_WEIGHTS: CategoryWeights = {
  trend: 0.25,
  momentum: 0.2,
  volume: 0.2,
  structure: 0.15,
  confluence: 0.2,
};

const CATEGORY_KEYS: (keyof CategoryScores)[] = ["trend", "momentum", "volume", "structure", "confluence"];

/** Dead zone: category scores inside ±8 are treated as "no call". */
const DEAD_ZONE = 8;
/** Samples needed before a category's empirical edge gets full trust. */
const SHRINK_K = 40;
/** How many recent rounds feed the learner. */
const LOOKBACK = 400;

export interface CategoryEdge {
  key: keyof CategoryScores;
  label: string;
  /** Rounds where this category made a directional call. */
  samples: number;
  /** Fraction of calls that matched the round result (0..1). */
  hitRate: number;
  /** Live adaptive weight (0..1, all categories sum to 1). */
  weight: number;
  /** Baseline weight for comparison. */
  baseWeight: number;
}

export interface CalibrationBucket {
  label: string;
  /** Predicted UP probability range lower bound (inclusive). */
  lo: number;
  hi: number;
  rounds: number;
  /** Realized UP rate within the bucket (0..1). */
  actualUpRate: number;
  /** Midpoint of predicted range (0..1) for gap display. */
  predictedMid: number;
}

export interface LearningState {
  weights: CategoryWeights;
  edges: CategoryEdge[];
  calibration: CalibrationBucket[];
  /** Total graded rounds feeding the learner. */
  graded: number;
  /** True once enough data exists for the adaptive weights to differ meaningfully. */
  active: boolean;
}

const LABELS: Record<keyof CategoryScores, string> = {
  trend: "Trend",
  momentum: "Momentum",
  volume: "Volume",
  structure: "Structure",
  confluence: "Confluence",
};

/**
 * Grades every category against outcomes and produces adaptive weights.
 * A category's edge is its hit rate above 50%; weights are the baseline scaled
 * by empirical performance, shrunk toward baseline by sample size, normalized.
 */
export function computeLearning(records: RoundRecord[]): LearningState {
  const recent = records.slice(-LOOKBACK).filter((r) => r.result !== "FLAT");
  const stats = new Map<keyof CategoryScores, { samples: number; hits: number }>();
  for (const k of CATEGORY_KEYS) stats.set(k, { samples: 0, hits: 0 });

  for (const r of recent) {
    const cats = r.snapshot.categories;
    for (const k of CATEGORY_KEYS) {
      const score = cats[k];
      if (!Number.isFinite(score) || Math.abs(score) < DEAD_ZONE) continue;
      const call = score > 0 ? "UP" : "DOWN";
      const s = stats.get(k);
      if (!s) continue;
      s.samples++;
      if (call === r.result) s.hits++;
    }
  }

  const raw: Record<string, number> = {};
  const edges: CategoryEdge[] = [];
  let anyEdge = false;
  for (const k of CATEGORY_KEYS) {
    const s = stats.get(k);
    const samples = s?.samples ?? 0;
    const hitRate = samples > 0 && s ? s.hits / samples : 0.5;
    // Trust the empirical hit rate only as samples accumulate.
    const trust = samples / (samples + SHRINK_K);
    const blendedHit = 0.5 + (hitRate - 0.5) * trust;
    // Scale baseline by performance: 50% hit → 1x, 60% → ~1.6x, 42% → ~0.5x (floored).
    const multiplier = Math.max(0.3, 1 + (blendedHit - 0.5) * 6);
    raw[k] = BASE_WEIGHTS[k] * multiplier;
    if (Math.abs(multiplier - 1) > 0.08) anyEdge = true;
    edges.push({ key: k, label: LABELS[k], samples, hitRate, weight: 0, baseWeight: BASE_WEIGHTS[k] });
  }

  const sum = CATEGORY_KEYS.reduce((acc, k) => acc + raw[k], 0) || 1;
  const weights: CategoryWeights = {
    trend: raw.trend / sum,
    momentum: raw.momentum / sum,
    volume: raw.volume / sum,
    structure: raw.structure / sum,
    confluence: raw.confluence / sum,
  };
  for (const e of edges) e.weight = weights[e.key];

  return {
    weights,
    edges,
    calibration: computeCalibration(recent),
    graded: recent.length,
    active: anyEdge && recent.length >= 60,
  };
}

const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "≤ 40% UP", lo: 0, hi: 40 },
  { label: "40–50%", lo: 40, hi: 50 },
  { label: "50–60%", lo: 50, hi: 60 },
  { label: "≥ 60% UP", lo: 60, hi: 101 },
];

function computeCalibration(records: RoundRecord[]): CalibrationBucket[] {
  return BUCKETS.map((b) => {
    let rounds = 0;
    let ups = 0;
    let probSum = 0;
    for (const r of records) {
      if (r.predictedUp < b.lo || r.predictedUp >= b.hi) continue;
      rounds++;
      probSum += r.predictedUp;
      if (r.result === "UP") ups++;
    }
    return {
      label: b.label,
      lo: b.lo,
      hi: b.hi,
      rounds,
      actualUpRate: rounds > 0 ? ups / rounds : 0,
      predictedMid: rounds > 0 ? probSum / rounds / 100 : (b.lo + Math.min(b.hi, 100)) / 200,
    };
  });
}
