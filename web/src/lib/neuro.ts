/**
 * Neuroplasticity Engine — models the AI's signal trust as a living brain
 * instead of static math.
 *
 * Every signal condition (MACD state, RSI zone, candle streaks, volume spikes,
 * EMA stacks, VWAP side, category scores…) is a SYNAPSE. Each settled round
 * fires Hebbian learning across the synapses that were active:
 *
 *  - Long-Term Potentiation (LTP): a synapse whose implied direction matched
 *    the round outcome gets STRONGER.
 *  - Long-Term Depression (LTD): a synapse that pointed the wrong way gets
 *    WEAKER — and errors carve deeper than wins reinforce (error-driven
 *    learning, like dopamine prediction error).
 *  - Homeostatic decay: every synapse slowly drifts back toward baseline so
 *    stale beliefs fade unless the tape keeps confirming them.
 *  - Adaptive plasticity: when the model's recent calls are losing, the
 *    plasticity rate SPIKES (rapid rewiring); on a hot streak it drops
 *    (consolidation — protect what's working).
 *
 * The result is a live probability adjustment layered on top of the indicator
 * forecast: signals the brain currently trusts push the forecast, signals it
 * has learned to distrust are discounted.
 */

import type { Analysis, RoundRecord, RoundSnapshot } from "./types";

export type SynapseKey =
  | "macd"
  | "rsi"
  | "streak"
  | "volume"
  | "ema-stack"
  | "ema-cross"
  | "vwap"
  | "cat-trend"
  | "cat-structure"
  | "cat-confluence";

const SYNAPSE_KEYS: SynapseKey[] = [
  "macd",
  "rsi",
  "streak",
  "volume",
  "ema-stack",
  "ema-cross",
  "vwap",
  "cat-trend",
  "cat-structure",
  "cat-confluence",
];

export const SYNAPSE_LABELS: Record<SynapseKey, string> = {
  macd: "MACD momentum",
  rsi: "RSI zone",
  streak: "Candle streaks",
  volume: "Volume pressure",
  "ema-stack": "EMA stack",
  "ema-cross": "EMA crossovers",
  vwap: "VWAP side",
  "cat-trend": "Trend engine",
  "cat-structure": "Structure engine",
  "cat-confluence": "Confluence engine",
};

/** A signal condition active right now, with the direction it implies. */
export interface FeatureHit {
  key: SynapseKey;
  dir: 1 | -1;
}

/** Normalized inputs the extractors read — buildable from a snapshot or live analysis. */
export interface FeatureInput {
  rsi: number;
  macdHist: number;
  consecGreen: number;
  consecRed: number;
  volumeSpike: boolean;
  bullPressure: number;
  emaAboveCount: number;
  emaCross: "golden" | "death" | null;
  vwapAbove: boolean;
  catTrend: number;
  catStructure: number;
  catConfluence: number;
}

export interface SynapseInfo {
  key: SynapseKey;
  label: string;
  /** Trust multiplier: 1 = baseline, >1 potentiated (LTP), <1 depressed (LTD). */
  strength: number;
  /** Rounds where this synapse fired a directional call. */
  activations: number;
  /** Fraction of activations that matched the outcome (0..1). */
  hitRate: number;
}

export type NeuroMode = "rewiring" | "adapting" | "consolidated";

export interface NeuroState {
  /** Trust multiplier per synapse. */
  map: Record<SynapseKey, number>;
  /** Synapses sorted by how far they've drifted from baseline. */
  synapses: SynapseInfo[];
  /** Live plasticity rate (learning speed). */
  plasticity: number;
  /** Plasticity as 0..100 for display. */
  plasticityPct: number;
  mode: NeuroMode;
  /** Model call hit rate over the recent modulation window (0..1). */
  recentHitRate: number;
  graded: number;
}

const BASE_PLASTICITY = 0.065;
const MIN_PLASTICITY = 0.03;
const MAX_PLASTICITY = 0.14;
const LTP_GAIN = 0.55;
/** Errors depress harder than wins potentiate. */
const LTD_GAIN = 0.78;
const HOMEOSTATIC_DECAY = 0.012;
const MIN_STRENGTH = 0.3;
const MAX_STRENGTH = 2.1;
/** Probability points contributed per unit of synaptic drift. */
const PROB_GAIN = 2.4;
/** Hard cap on the total neuro adjustment, in probability points. */
const MAX_DELTA = 6;
const LOOKBACK = 400;
const MODULATION_WINDOW = 12;

/** Extracts the active signal conditions and their implied directions. */
export function extractFeatures(f: FeatureInput): FeatureHit[] {
  const hits: FeatureHit[] = [];
  if (f.macdHist > 0) hits.push({ key: "macd", dir: 1 });
  else if (f.macdHist < 0) hits.push({ key: "macd", dir: -1 });
  if (f.rsi >= 58) hits.push({ key: "rsi", dir: 1 });
  else if (f.rsi <= 42) hits.push({ key: "rsi", dir: -1 });
  if (f.consecGreen >= 3) hits.push({ key: "streak", dir: 1 });
  else if (f.consecRed >= 3) hits.push({ key: "streak", dir: -1 });
  if (f.volumeSpike && f.bullPressure >= 55) hits.push({ key: "volume", dir: 1 });
  else if (f.volumeSpike && f.bullPressure <= 45) hits.push({ key: "volume", dir: -1 });
  if (f.emaAboveCount >= 3) hits.push({ key: "ema-stack", dir: 1 });
  else if (f.emaAboveCount <= 1) hits.push({ key: "ema-stack", dir: -1 });
  if (f.emaCross === "golden") hits.push({ key: "ema-cross", dir: 1 });
  else if (f.emaCross === "death") hits.push({ key: "ema-cross", dir: -1 });
  hits.push({ key: "vwap", dir: f.vwapAbove ? 1 : -1 });
  if (f.catTrend >= 20) hits.push({ key: "cat-trend", dir: 1 });
  else if (f.catTrend <= -20) hits.push({ key: "cat-trend", dir: -1 });
  if (f.catStructure >= 20) hits.push({ key: "cat-structure", dir: 1 });
  else if (f.catStructure <= -20) hits.push({ key: "cat-structure", dir: -1 });
  if (f.catConfluence >= 25) hits.push({ key: "cat-confluence", dir: 1 });
  else if (f.catConfluence <= -25) hits.push({ key: "cat-confluence", dir: -1 });
  return hits;
}

function inputFromSnapshot(s: RoundSnapshot): FeatureInput {
  return {
    rsi: s.rsi,
    macdHist: s.macdHist,
    consecGreen: s.consecGreen,
    consecRed: s.consecRed,
    volumeSpike: s.volumeSpike,
    bullPressure: s.bullPressure,
    emaAboveCount: s.emaAboveCount,
    emaCross: s.emaCross,
    vwapAbove: s.vwapSide === "above",
    catTrend: s.categories.trend,
    catStructure: s.categories.structure,
    catConfluence: s.categories.confluence,
  };
}

/** Extracts the live feature set from a full analysis snapshot. */
export function featuresFromAnalysis(a: Analysis): FeatureHit[] {
  return extractFeatures({
    rsi: a.momentum.rsi,
    macdHist: a.momentum.macdHist,
    consecGreen: a.consecGreen,
    consecRed: a.consecRed,
    volumeSpike: a.volume.spike,
    bullPressure: a.volume.bullPressure,
    emaAboveCount: a.trend.aboveCount,
    emaCross: a.trend.cross,
    vwapAbove: a.vwap.distancePct >= 0,
    catTrend: a.categories.trend,
    catStructure: a.categories.structure,
    catConfluence: a.categories.confluence,
  });
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Replays the round database chronologically, firing Hebbian LTP/LTD across
 * every active synapse with a plasticity rate modulated by the model's own
 * recent call performance. Deterministic — same records, same brain.
 */
export function computeNeuro(records: RoundRecord[]): NeuroState {
  const map = Object.fromEntries(SYNAPSE_KEYS.map((k) => [k, 1])) as Record<SynapseKey, number>;
  const activations = Object.fromEntries(SYNAPSE_KEYS.map((k) => [k, 0])) as Record<SynapseKey, number>;
  const correct = Object.fromEntries(SYNAPSE_KEYS.map((k) => [k, 0])) as Record<SynapseKey, number>;

  const recent = records.slice(-LOOKBACK).filter((r) => r.result !== "FLAT");
  let plasticity = BASE_PLASTICITY;
  const window: boolean[] = [];

  for (const r of recent) {
    const resultDir: 1 | -1 = r.result === "UP" ? 1 : -1;
    const hits = extractFeatures(inputFromSnapshot(r.snapshot));

    for (const h of hits) {
      activations[h.key]++;
      if (h.dir === resultDir) {
        correct[h.key]++;
        map[h.key] = clamp(map[h.key] + plasticity * LTP_GAIN, MIN_STRENGTH, MAX_STRENGTH);
      } else {
        map[h.key] = clamp(map[h.key] - plasticity * LTD_GAIN, MIN_STRENGTH, MAX_STRENGTH);
      }
    }

    // Homeostatic decay: unconfirmed beliefs drift back to baseline.
    for (const k of SYNAPSE_KEYS) map[k] += (1 - map[k]) * HOMEOSTATIC_DECAY;

    // Plasticity modulation from the model's own directional calls.
    if (r.predictedUp >= 55 || r.predictedUp <= 45) {
      const call: 1 | -1 = r.predictedUp >= 55 ? 1 : -1;
      window.push(call === resultDir);
      if (window.length > MODULATION_WINDOW) window.shift();
      const hitRate = window.filter(Boolean).length / window.length;
      // Losing → rewire fast; winning → consolidate.
      plasticity = clamp(BASE_PLASTICITY * (1 + (0.5 - hitRate) * 2.6), MIN_PLASTICITY, MAX_PLASTICITY);
    }
  }

  const recentHitRate = window.length > 0 ? window.filter(Boolean).length / window.length : 0.5;
  const mode: NeuroMode = plasticity >= 0.085 ? "rewiring" : plasticity <= 0.048 ? "consolidated" : "adapting";

  const synapses: SynapseInfo[] = SYNAPSE_KEYS.map((k) => ({
    key: k,
    label: SYNAPSE_LABELS[k],
    strength: map[k],
    activations: activations[k],
    hitRate: activations[k] > 0 ? correct[k] / activations[k] : 0.5,
  })).sort((a, b) => Math.abs(b.strength - 1) - Math.abs(a.strength - 1));

  return {
    map,
    synapses,
    plasticity,
    plasticityPct: Math.round(((plasticity - MIN_PLASTICITY) / (MAX_PLASTICITY - MIN_PLASTICITY)) * 100),
    mode,
    recentHitRate,
    graded: recent.length,
  };
}

/**
 * Live probability adjustment (in probability points, capped ±6): synapses the
 * brain trusts push the forecast their way, distrusted synapses pull it back.
 */
export function neuroDelta(state: NeuroState, features: FeatureHit[]): number {
  let delta = 0;
  for (const f of features) delta += f.dir * (state.map[f.key] - 1) * PROB_GAIN;
  return clamp(Math.round(delta * 10) / 10, -MAX_DELTA, MAX_DELTA);
}
