import type { Candle } from "./types";
import { TRIO_TF_MS, aggregateTrioCandles } from "./tripleCandle";
import type { TrioTimeframe } from "./tripleCandle";

/**
 * 4th-candle machine-learning predictor.
 *
 * An online logistic-regression model (one per coin + timeframe) reads the
 * shape of the last 3 closed candles and predicts the direction of the 4th.
 * Every closed bar becomes a training sample: the model predicts first
 * (walk-forward, no peeking), the outcome is logged, then the weights are
 * nudged toward the truth — so predictions genuinely improve as data arrives.
 * Model weights, learning stats, and the full prediction log persist in
 * localStorage and survive reloads; only unseen bars are ever trained on.
 */

export type C4Tier = "high" | "medium" | "low";

export interface C4Actual {
  dir: "up" | "down" | "flat";
  returnPct: number;
  /** null when the bar closed flat/doji — excluded from accuracy. */
  correct: boolean | null;
}

export interface C4Prediction {
  /** Open time of the predicted (4th) bar. */
  barTime: number;
  madeAt: number;
  timeframe: TrioTimeframe;
  dir: "up" | "down";
  /** Probability the 4th candle closes green, 0..100. */
  probUp: number;
  /** Distance from coin-flip, 0..100. */
  confidence: number;
  tier: C4Tier;
  /** Signed expected close-to-open move of the 4th candle, %. */
  expectedMovePct: number;
  /** Expected full high-low range of the 4th candle, %. */
  expectedRangePct: number;
  /** Training samples the model had seen when this call was made. */
  trainedAt: number;
  actual?: C4Actual;
}

export interface C4Bucket {
  label: string;
  total: number;
  correct: number;
}

export interface C4Signal {
  name: string;
  weight: number;
}

export interface PredictorSnapshot {
  prediction: C4Prediction | null;
  /** Newest first; pending prediction included at the head. */
  log: C4Prediction[];
  trained: number;
  /** Walk-forward accuracy over ALL training samples, %. */
  wfAccuracy: number | null;
  /** Accuracy over the last 30 walk-forward samples, %. */
  recentAccuracy: number | null;
  /** Resolved logged predictions (excludes flat bars). */
  liveResolved: number;
  liveCorrect: number;
  buckets: C4Bucket[];
  topSignals: C4Signal[];
}

export const C4_FEATURE_NAMES: string[] = [
  "C3 momentum",
  "C2 momentum",
  "C1 momentum",
  "C3 body force",
  "C2 body force",
  "C3 close position",
  "C3 wick skew",
  "C2 wick skew",
  "Direction streak",
  "Body acceleration",
  "C3 range vs ATR",
  "C3 volume surge",
  "Engulfing flip",
  "Highs/lows trend",
];

const N_FEATURES = C4_FEATURE_NAMES.length;
const LOG_CAP = 120;
const BUCKET_LABELS = ["≤56%", "56–65%", "65–75%", "75%+"];

interface ModelState {
  w: number[];
  b: number;
  trained: number;
  lastBarTime: number;
  wfTotal: number;
  wfCorrect: number;
  /** Ring of last 30 walk-forward results (1 hit / 0 miss). */
  recent: number[];
  buckets: { total: number; correct: number }[];
  /** EWMA of |next-bar return %| for magnitude estimates. */
  emaAbsMove: number;
  /** EWMA of next-bar range %, for the ghost candle. */
  emaRange: number;
}

const freshModel = (): ModelState => ({
  w: Array.from({ length: N_FEATURES }, () => 0),
  b: 0,
  trained: 0,
  lastBarTime: 0,
  wfTotal: 0,
  wfCorrect: 0,
  recent: [],
  buckets: BUCKET_LABELS.map(() => ({ total: 0, correct: 0 })),
  emaAbsMove: 0,
  emaRange: 0,
});

const modelKey = (suffix: string, tf: TrioTimeframe): string => `pea_c4_model_v1${suffix}:${tf}`;
const logKey = (suffix: string, tf: TrioTimeframe): string => `pea_c4_log_v1${suffix}:${tf}`;

function loadModel(suffix: string, tf: TrioTimeframe): ModelState {
  try {
    const raw = localStorage.getItem(modelKey(suffix, tf));
    if (raw) {
      const m = JSON.parse(raw) as ModelState;
      if (Array.isArray(m.w) && m.w.length === N_FEATURES && typeof m.trained === "number") return m;
    }
  } catch {
    // corrupt/unavailable — start fresh
  }
  return freshModel();
}

function loadLog(suffix: string, tf: TrioTimeframe): C4Prediction[] {
  try {
    const raw = localStorage.getItem(logKey(suffix, tf));
    if (raw) {
      const arr = JSON.parse(raw) as C4Prediction[];
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    // corrupt/unavailable — start fresh
  }
  return [];
}

function save(suffix: string, tf: TrioTimeframe, model: ModelState, log: C4Prediction[]): void {
  try {
    localStorage.setItem(modelKey(suffix, tf), JSON.stringify(model));
    localStorage.setItem(logKey(suffix, tf), JSON.stringify(log.slice(0, LOG_CAP)));
  } catch {
    // storage unavailable — non-fatal, model just won't persist
  }
}

const clamp = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, v));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function candleSign(c: Candle): number {
  return c.close > c.open ? 1 : c.close < c.open ? -1 : 0;
}

function retPct(c: Candle): number {
  return c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
}

/** ATR over up to 14 bars ending just before `endIdx` (exclusive). */
function atrAt(bars: Candle[], endIdx: number): number {
  const from = Math.max(1, endIdx - 14);
  let sum = 0;
  let n = 0;
  for (let i = from; i < endIdx; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    sum += tr;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function avgVolAt(bars: Candle[], endIdx: number): number {
  const from = Math.max(0, endIdx - 20);
  let sum = 0;
  let n = 0;
  for (let i = from; i < endIdx; i++) {
    sum += bars[i].volume;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Normalized feature vector describing the 3 candles ending at `endIdx - 1`.
 * The prediction target is the bar at `endIdx`.
 */
function extractFeatures(bars: Candle[], endIdx: number): number[] | null {
  if (endIdx < 18 || endIdx > bars.length) return null;
  const c1 = bars[endIdx - 3];
  const c2 = bars[endIdx - 2];
  const c3 = bars[endIdx - 1];
  const atr = atrAt(bars, endIdx - 1);
  const avgVol = avgVolAt(bars, endIdx - 1);
  const atrPct = atr > 0 && c3.close > 0 ? (atr / c3.close) * 100 : 0.1;

  const anat = (c: Candle) => {
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const sign = candleSign(c);
    return {
      sign,
      body,
      range,
      bodyRatio: range > 0 ? body / range : 0,
      closePos: range > 0 ? (c.close - c.low) / range : 0.5,
      upWick: range > 0 ? (c.high - Math.max(c.open, c.close)) / range : 0,
      loWick: range > 0 ? (Math.min(c.open, c.close) - c.low) / range : 0,
      rangeVsAtr: atr > 0 ? range / atr : 1,
      volRel: avgVol > 0 ? c.volume / avgVol : 1,
    };
  };
  const a1 = anat(c1);
  const a2 = anat(c2);
  const a3 = anat(c3);

  // Same-direction streak ending at c3, scanned back up to 4 bars.
  let streak = 0;
  if (a3.sign !== 0) {
    for (let i = endIdx - 1; i >= Math.max(0, endIdx - 4); i--) {
      if (candleSign(bars[i]) === a3.sign) streak++;
      else break;
    }
  }

  const accel = a2.body > 0 ? clamp(a3.body / a2.body - 1, 1) * a3.sign : 0;

  const engulf =
    a3.sign !== 0 &&
    a3.sign !== a2.sign &&
    a3.body > a2.body &&
    Math.max(c3.open, c3.close) >= Math.max(c2.open, c2.close) &&
    Math.min(c3.open, c3.close) <= Math.min(c2.open, c2.close)
      ? a3.sign
      : 0;

  const hlTrend = c3.high > c2.high && c3.low > c2.low ? 1 : c3.high < c2.high && c3.low < c2.low ? -1 : 0;

  return [
    clamp(retPct(c3) / Math.max(atrPct, 0.001), 1.5) / 1.5,
    clamp(retPct(c2) / Math.max(atrPct, 0.001), 1.5) / 1.5,
    clamp(retPct(c1) / Math.max(atrPct, 0.001), 1.5) / 1.5,
    a3.sign * a3.bodyRatio,
    a2.sign * a2.bodyRatio,
    a3.closePos * 2 - 1,
    a3.loWick - a3.upWick,
    a2.loWick - a2.upWick,
    (a3.sign * Math.min(streak, 3)) / 3,
    accel,
    clamp(a3.rangeVsAtr - 1, 1),
    clamp(a3.volRel - 1, 1),
    engulf,
    hlTrend,
  ];
}

function predictProb(model: ModelState, x: number[]): number {
  let z = model.b;
  for (let i = 0; i < N_FEATURES; i++) z += model.w[i] * x[i];
  return sigmoid(z);
}

function bucketIdx(confidence: number): number {
  return confidence < 12 ? 0 : confidence < 30 ? 1 : confidence < 50 ? 2 : 3;
}

function tierOf(confidence: number): C4Tier {
  return confidence >= 30 ? "high" : confidence >= 12 ? "medium" : "low";
}

/** One SGD step toward the observed outcome. */
function train(model: ModelState, x: number[], outcomeUp: boolean): void {
  const p = predictProb(model, x);
  const y = outcomeUp ? 1 : 0;
  const lr = 0.3 / (1 + model.trained / 300);
  const err = y - p;
  for (let i = 0; i < N_FEATURES; i++) {
    model.w[i] = model.w[i] * (1 - 0.0001) + lr * err * x[i];
  }
  model.b += lr * err * 0.5;
  model.trained++;
}

function buildPrediction(model: ModelState, x: number[], barTime: number, tf: TrioTimeframe): C4Prediction {
  const p = predictProb(model, x);
  const probUp = p * 100;
  const confidence = Math.abs(probUp - 50) * 2;
  const dir: "up" | "down" = p >= 0.5 ? "up" : "down";
  const baseMove = model.emaAbsMove > 0 ? model.emaAbsMove : 0.05;
  const expectedMovePct = (dir === "up" ? 1 : -1) * baseMove * (0.55 + (0.9 * confidence) / 100);
  const expectedRangePct = Math.max(model.emaRange > 0 ? model.emaRange : baseMove * 1.8, Math.abs(expectedMovePct) * 1.25);
  return {
    barTime,
    madeAt: Date.now(),
    timeframe: tf,
    dir,
    probUp,
    confidence,
    tier: tierOf(confidence),
    expectedMovePct,
    expectedRangePct,
    trainedAt: model.trained,
  };
}

/**
 * Advances the predictor for one coin + timeframe: trains on every unseen
 * closed bar (walk-forward), resolves pending logged predictions against
 * their actual candles, emits/refreshes the forecast for the NEXT bar, and
 * persists everything. Idempotent — safe to call on every tick.
 */
export function stepPredictor(
  storageSuffix: string,
  timeframe: TrioTimeframe,
  oneMinCandles: Candle[],
): PredictorSnapshot | null {
  const tfMs = TRIO_TF_MS[timeframe];
  const bars = timeframe === "1m" ? oneMinCandles : aggregateTrioCandles(oneMinCandles, tfMs);
  // The last aggregated bar is still forming — only closed bars train/resolve.
  const closed = bars.slice(0, -1);
  if (closed.length < 22) return null;

  const model = loadModel(storageSuffix, timeframe);
  let log = loadLog(storageSuffix, timeframe);
  let dirty = false;

  // 1) Resolve pending logged predictions whose bar has now closed.
  const byTime = new Map<number, Candle>();
  for (const c of closed) byTime.set(c.time, c);
  for (const rec of log) {
    if (rec.actual) continue;
    const bar = byTime.get(rec.barTime);
    if (!bar) continue;
    const ret = retPct(bar);
    const sign = candleSign(bar);
    const dir: C4Actual["dir"] = sign > 0 ? "up" : sign < 0 ? "down" : "flat";
    rec.actual = {
      dir,
      returnPct: ret,
      correct: dir === "flat" ? null : (dir === "up") === (rec.dir === "up"),
    };
    dirty = true;
  }

  // 2) Walk-forward training on every unseen closed bar.
  for (let i = 18; i < closed.length; i++) {
    const bar = closed[i];
    if (bar.time <= model.lastBarTime) continue;
    const x = extractFeatures(closed, i);
    model.lastBarTime = bar.time;
    if (!x) continue;
    const sign = candleSign(bar);
    // Grade the pre-update prediction (honest walk-forward accuracy).
    if (sign !== 0) {
      const p = predictProb(model, x);
      const conf = Math.abs(p * 100 - 50) * 2;
      const hit = (p >= 0.5) === (sign > 0);
      model.wfTotal++;
      if (hit) model.wfCorrect++;
      model.recent.push(hit ? 1 : 0);
      if (model.recent.length > 30) model.recent.shift();
      const bk = model.buckets[bucketIdx(conf)];
      bk.total++;
      if (hit) bk.correct++;
      train(model, x, sign > 0);
    }
    const absRet = Math.abs(retPct(bar));
    const rangePct = bar.close > 0 ? ((bar.high - bar.low) / bar.close) * 100 : 0;
    model.emaAbsMove = model.emaAbsMove === 0 ? absRet : model.emaAbsMove * 0.94 + absRet * 0.06;
    model.emaRange = model.emaRange === 0 ? rangePct : model.emaRange * 0.94 + rangePct * 0.06;
    dirty = true;
  }

  // 3) Forecast the NEXT (4th) bar from the last 3 closed candles.
  const lastClosed = closed[closed.length - 1];
  const nextBarTime = lastClosed.time + tfMs;
  const x = extractFeatures(closed, closed.length);
  let prediction: C4Prediction | null = null;
  if (x) {
    const existing = log.find((r) => r.barTime === nextBarTime);
    if (existing && !existing.actual) {
      prediction = existing;
    } else if (!existing) {
      prediction = buildPrediction(model, x, nextBarTime, timeframe);
      log = [prediction, ...log].slice(0, LOG_CAP);
      dirty = true;
    } else {
      prediction = existing;
    }
  }

  if (dirty) save(storageSuffix, timeframe, model, log);

  const liveRecords = log.filter((r) => r.actual && r.actual.correct !== null);
  const liveCorrect = liveRecords.filter((r) => r.actual?.correct === true).length;
  const recentHits = model.recent.reduce((s, v) => s + v, 0);

  const topSignals = model.w
    .map((w, i) => ({ name: C4_FEATURE_NAMES[i], weight: w }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 5);

  return {
    prediction,
    log,
    trained: model.trained,
    wfAccuracy: model.wfTotal >= 10 ? (model.wfCorrect / model.wfTotal) * 100 : null,
    recentAccuracy: model.recent.length >= 10 ? (recentHits / model.recent.length) * 100 : null,
    liveResolved: liveRecords.length,
    liveCorrect,
    buckets: model.buckets.map((b, i) => ({ label: BUCKET_LABELS[i], total: b.total, correct: b.correct })),
    topSignals,
  };
}
