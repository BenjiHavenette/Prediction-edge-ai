import type { Candle, Direction } from "./types";

export type TrioTimeframe = "1m" | "5m" | "15m";

export const TRIO_TF_MS: Record<TrioTimeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000 };

export type CandleDir = "green" | "red" | "doji";

/** Full anatomy of a single candle inside the trio. */
export interface CandleAnatomy {
  candle: Candle;
  index: number;
  dir: CandleDir;
  /** Close vs open, %. */
  returnPct: number;
  range: number;
  /** Body as a fraction of the full range, 0..1. */
  bodyRatio: number;
  upperWickRatio: number;
  lowerWickRatio: number;
  /** Where the close sits inside the range, 0 (low) .. 1 (high). */
  closePosition: number;
  /** Range vs 14-bar ATR at that moment. */
  rangeVsAtr: number;
  /** Volume vs 20-bar average. */
  volumeRel: number;
  /** Narrative role, e.g. "Impulse", "Stall". */
  role: string;
}

/** Relationship between two candles of the trio. */
export interface PairLink {
  from: number;
  to: number;
  /** Shape correlation, -100 (mirror opposites) .. +100 (identical shape). */
  correlation: number;
  label: string;
  direction: Direction;
  /** Range overlap between the two candles, % of the smaller range. */
  overlapPct: number;
  /** Body size of the later candle vs the earlier one (ratio). */
  bodyDelta: number;
  notes: string[];
}

export interface TrioPattern {
  name: string;
  direction: Direction;
  description: string;
}

/** Historical follow-through of this 3-candle shape. */
export interface TrioEcho {
  matches: number;
  strict: boolean;
  nextUpPct: number;
  nextDownPct: number;
  avgNextMovePct: number;
  bias: Direction;
}

export interface TrioAnalysis {
  timeframe: TrioTimeframe;
  candles: [CandleAnatomy, CandleAnatomy, CandleAnatomy];
  links: PairLink[];
  patterns: TrioPattern[];
  echo: TrioEcho | null;
  /** -100 (max bearish) .. +100 (max bullish). */
  biasScore: number;
  bias: Direction;
  verdict: string;
}

/** Buckets 1m candles into a larger clock-aligned timeframe. */
export function aggregateTrioCandles(candles: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

function trueRange(c: Candle, prev: Candle | undefined): number {
  if (!prev) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

/** ATR ending at (and excluding) index `endIdx`. */
function atrBefore(candles: Candle[], endIdx: number, period = 14): number {
  const from = Math.max(1, endIdx - period);
  let sum = 0;
  let n = 0;
  for (let i = from; i < endIdx; i++) {
    sum += trueRange(candles[i], candles[i - 1]);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function avgVolumeBefore(candles: Candle[], endIdx: number, period = 20): number {
  const from = Math.max(0, endIdx - period);
  let sum = 0;
  let n = 0;
  for (let i = from; i < endIdx; i++) {
    sum += candles[i].volume;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function candleDir(c: Candle): CandleDir {
  const range = c.high - c.low;
  const body = Math.abs(c.close - c.open);
  if (range <= 0 || body <= range * 0.08) return "doji";
  return c.close > c.open ? "green" : "red";
}

function buildAnatomy(c: Candle, index: number, atr: number, avgVol: number): CandleAnatomy {
  const range = c.high - c.low;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const dir = candleDir(c);
  const bodyRatio = range > 0 ? body / range : 0;
  const rangeVsAtr = atr > 0 ? range / atr : 1;
  const closePosition = range > 0 ? (c.close - c.low) / range : 0.5;
  const upperWickRatio = range > 0 ? upperWick / range : 0;
  const lowerWickRatio = range > 0 ? lowerWick / range : 0;

  let role = "Drift";
  if (dir === "doji") role = "Indecision";
  else if (rangeVsAtr >= 1.4 && bodyRatio >= 0.65) role = "Impulse";
  else if (rangeVsAtr >= 1.2 && bodyRatio < 0.4) role = "Fight";
  else if (bodyRatio >= 0.6) role = "Conviction";
  else if (dir === "green" && lowerWickRatio >= 0.45) role = "Dip Bought";
  else if (dir === "red" && upperWickRatio >= 0.45) role = "Rally Sold";
  else if (rangeVsAtr <= 0.6) role = "Stall";

  return {
    candle: c,
    index,
    dir,
    returnPct: c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0,
    range,
    bodyRatio,
    upperWickRatio,
    lowerWickRatio,
    closePosition,
    rangeVsAtr,
    volumeRel: avgVol > 0 ? c.volume / avgVol : 1,
    role,
  };
}

/** Signed shape vector used for cosine correlation between candles. */
function shapeVector(a: CandleAnatomy): number[] {
  const sign = a.dir === "red" ? -1 : a.dir === "green" ? 1 : 0;
  return [
    sign * a.bodyRatio,
    Math.max(-2, Math.min(2, a.rangeVsAtr > 0 ? (a.returnPct >= 0 ? 1 : -1) * Math.min(Math.abs(a.returnPct), 2) : 0)),
    a.closePosition * 2 - 1,
    a.lowerWickRatio - a.upperWickRatio,
    Math.min(2, a.rangeVsAtr) - 1,
  ];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function overlapPct(a: Candle, b: Candle): number {
  const overlap = Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
  const smaller = Math.min(a.high - a.low, b.high - b.low);
  return smaller > 0 ? Math.min(100, (overlap / smaller) * 100) : 0;
}

function buildLink(a: CandleAnatomy, b: CandleAnatomy): PairLink {
  const correlation = Math.round(cosine(shapeVector(a), shapeVector(b)) * 100);
  const ov = overlapPct(a.candle, b.candle);
  const bodyA = Math.abs(a.candle.close - a.candle.open);
  const bodyB = Math.abs(b.candle.close - b.candle.open);
  const bodyDelta = bodyA > 0 ? bodyB / bodyA : bodyB > 0 ? 2 : 1;
  const notes: string[] = [];

  let label = "Neutral Drift";
  let direction: Direction = "neutral";

  const inside = b.candle.high <= a.candle.high && b.candle.low >= a.candle.low;
  const engulfBody =
    bodyB > bodyA &&
    Math.max(b.candle.open, b.candle.close) >= Math.max(a.candle.open, a.candle.close) &&
    Math.min(b.candle.open, b.candle.close) <= Math.min(a.candle.open, a.candle.close);

  if (b.dir === "doji") {
    label = "Indecision Stall";
    notes.push("Second candle is a doji — momentum paused");
  } else if (a.dir !== "doji" && b.dir === a.dir) {
    direction = b.dir === "green" ? "bull" : "bear";
    if (bodyDelta >= 1.15) {
      label = "Acceleration";
      notes.push(`Body grew ${bodyDelta.toFixed(1)}x — momentum building`);
    } else if (bodyDelta <= 0.6) {
      label = "Fading Continuation";
      notes.push(`Body shrank to ${(bodyDelta * 100).toFixed(0)}% — momentum fading`);
    } else {
      label = "Continuation";
      notes.push("Same direction, similar force");
    }
  } else if (a.dir !== "doji") {
    direction = b.dir === "green" ? "bull" : "bear";
    if (engulfBody) {
      label = "Engulfing Reversal";
      notes.push("Later candle's body engulfs the prior — strong flip");
    } else if (inside || bodyDelta <= 0.45) {
      label = "Weak Pullback";
      direction = a.dir === "green" ? "bull" : "bear";
      notes.push("Counter-move too small to threaten the prior candle");
    } else {
      label = "Reversal Pressure";
      notes.push("Direction flipped with meaningful force");
    }
  } else if (a.dir === "doji") {
    direction = b.dir === "green" ? "bull" : "bear";
    label = "Resolution";
    notes.push("Indecision resolved into a directional candle");
  }

  if (inside && label !== "Weak Pullback") notes.push("Inside bar — range compressing");
  if (ov < 25) notes.push("Barely overlapping ranges — fast directional tape");

  return { from: a.index, to: b.index, correlation, label, direction, overlapPct: Math.round(ov), bodyDelta, notes };
}

function detectTrioPatterns(t: [CandleAnatomy, CandleAnatomy, CandleAnatomy]): TrioPattern[] {
  const [c1, c2, c3] = t;
  const hits: TrioPattern[] = [];
  const closes = [c1.candle.close, c2.candle.close, c3.candle.close];

  const allGreen = t.every((c) => c.dir === "green");
  const allRed = t.every((c) => c.dir === "red");
  const risingCloses = closes[1] > closes[0] && closes[2] > closes[1];
  const fallingCloses = closes[1] < closes[0] && closes[2] < closes[1];
  const bodies = t.map((c) => Math.abs(c.candle.close - c.candle.open));

  if (allGreen && risingCloses && t.every((c) => c.bodyRatio >= 0.45)) {
    hits.push({
      name: "Three White Soldiers",
      direction: "bull",
      description: "Three solid green candles with rising closes — classic bullish march.",
    });
  }
  if (allRed && fallingCloses && t.every((c) => c.bodyRatio >= 0.45)) {
    hits.push({
      name: "Three Black Crows",
      direction: "bear",
      description: "Three solid red candles with falling closes — sustained selling.",
    });
  }
  const mid1 = (c1.candle.open + c1.candle.close) / 2;
  if (c1.dir === "red" && c2.bodyRatio <= 0.35 && c3.dir === "green" && c3.candle.close > mid1) {
    hits.push({
      name: "Morning Star",
      direction: "bull",
      description: "Sell-off, stall, then a green candle reclaiming the first candle's midpoint.",
    });
  }
  if (c1.dir === "green" && c2.bodyRatio <= 0.35 && c3.dir === "red" && c3.candle.close < mid1) {
    hits.push({
      name: "Evening Star",
      direction: "bear",
      description: "Rally, stall, then a red candle breaking the first candle's midpoint.",
    });
  }
  const c2Inside = c2.candle.high <= c1.candle.high && c2.candle.low >= c1.candle.low;
  if (c2Inside && c3.candle.close > c1.candle.high) {
    hits.push({
      name: "Inside Bar Breakout (Up)",
      direction: "bull",
      description: "Compression inside candle 1, then candle 3 broke above its high.",
    });
  }
  if (c2Inside && c3.candle.close < c1.candle.low) {
    hits.push({
      name: "Inside Bar Breakout (Down)",
      direction: "bear",
      description: "Compression inside candle 1, then candle 3 broke below its low.",
    });
  }
  if ((allGreen || allRed) && bodies[0] > 0 && bodies[1] < bodies[0] && bodies[2] < bodies[1]) {
    hits.push({
      name: "Momentum Exhaustion",
      direction: allGreen ? "bear" : "bull",
      description: "Bodies shrinking each candle — the move is running out of fuel.",
    });
  }
  if ((allGreen || allRed) && bodies[2] > bodies[1] && bodies[1] > bodies[0] && bodies[0] > 0) {
    hits.push({
      name: "Momentum Ignition",
      direction: allGreen ? "bull" : "bear",
      description: "Bodies growing each candle — force is compounding.",
    });
  }
  if (
    c3.candle.high >= Math.max(c1.candle.high, c2.candle.high) &&
    c3.candle.low <= Math.min(c1.candle.low, c2.candle.low) &&
    c3.dir !== "doji"
  ) {
    hits.push({
      name: `Outside Engulfment (${c3.dir === "green" ? "Up" : "Down"})`,
      direction: c3.dir === "green" ? "bull" : "bear",
      description: "Candle 3 swallowed the entire range of the prior two candles.",
    });
  }
  const alternating =
    c1.dir !== "doji" && c2.dir !== "doji" && c3.dir !== "doji" && c1.dir !== c2.dir && c2.dir !== c3.dir;
  if (hits.length === 0 && alternating) {
    hits.push({
      name: "Choppy Alternation",
      direction: "neutral",
      description: "Green-red flip-flopping with no follow-through — coin-flip tape.",
    });
  }
  if (hits.length === 0 && t.every((c) => c.rangeVsAtr <= 0.65)) {
    hits.push({
      name: "Volatility Squeeze",
      direction: "neutral",
      description: "All three candles well below normal range — energy is coiling.",
    });
  }
  return hits;
}

type SizeBucket = "S" | "M" | "L";

function sizeBucket(range: number, atr: number): SizeBucket {
  if (atr <= 0) return "M";
  const r = range / atr;
  return r < 0.7 ? "S" : r < 1.4 ? "M" : "L";
}

/**
 * Scans full candle history for prior occurrences of the same 3-candle
 * signature and measures what the NEXT candle did — the shape's historical
 * follow-through ("echo").
 */
function findEcho(history: Candle[], trio: [CandleAnatomy, CandleAnatomy, CandleAnatomy]): TrioEcho | null {
  const n = history.length;
  if (n < 40) return null;

  const dirs = trio.map((c) => c.dir);
  const targetBuckets = trio.map((c) => sizeBucket(c.range, c.range / Math.max(c.rangeVsAtr, 0.01)));

  const collect = (strict: boolean): { ups: number; downs: number; total: number; sumMove: number } => {
    let ups = 0;
    let downs = 0;
    let total = 0;
    let sumMove = 0;
    for (let i = 18; i < n - 1; i++) {
      const a = history[i - 2];
      const b = history[i - 1];
      const c = history[i];
      if (candleDir(a) !== dirs[0] || candleDir(b) !== dirs[1] || candleDir(c) !== dirs[2]) continue;
      if (strict) {
        const atr = atrBefore(history, i - 2);
        if (
          sizeBucket(a.high - a.low, atr) !== targetBuckets[0] ||
          sizeBucket(b.high - b.low, atr) !== targetBuckets[1] ||
          sizeBucket(c.high - c.low, atr) !== targetBuckets[2]
        )
          continue;
      }
      const next = history[i + 1];
      if (next.close > next.open) ups++;
      else if (next.close < next.open) downs++;
      total++;
      if (next.open > 0) sumMove += ((next.close - next.open) / next.open) * 100;
    }
    return { ups, downs, total, sumMove };
  };

  let strict = true;
  let r = collect(true);
  if (r.total < 10) {
    strict = false;
    r = collect(false);
  }
  if (r.total < 4) return null;

  const nextUpPct = (r.ups / r.total) * 100;
  const nextDownPct = (r.downs / r.total) * 100;
  const bias: Direction = nextUpPct >= 56 ? "bull" : nextDownPct >= 56 ? "bear" : "neutral";
  return {
    matches: r.total,
    strict,
    nextUpPct,
    nextDownPct,
    avgNextMovePct: r.sumMove / r.total,
    bias,
  };
}

/**
 * Analyzes the last 3 candles on the given timeframe: per-candle anatomy,
 * pairwise shape correlation, trio patterns, and the historical echo of the
 * same signature.
 */
export function analyzeTrio(
  oneMinCandles: Candle[],
  timeframe: TrioTimeframe,
  includeForming: boolean,
): TrioAnalysis | null {
  const bars =
    timeframe === "1m" ? oneMinCandles : aggregateTrioCandles(oneMinCandles, TRIO_TF_MS[timeframe]);
  const usable = includeForming ? bars : bars.slice(0, -1);
  if (usable.length < 22) return null;

  const endIdx = usable.length - 1;
  const atr = atrBefore(usable, endIdx - 2);
  const avgVol = avgVolumeBefore(usable, endIdx - 2);

  const trio: [CandleAnatomy, CandleAnatomy, CandleAnatomy] = [
    buildAnatomy(usable[endIdx - 2], 0, atr, avgVol),
    buildAnatomy(usable[endIdx - 1], 1, atr, avgVol),
    buildAnatomy(usable[endIdx], 2, atr, avgVol),
  ];

  const links = [buildLink(trio[0], trio[1]), buildLink(trio[1], trio[2]), buildLink(trio[0], trio[2])];
  const patterns = detectTrioPatterns(trio);
  const echo = findEcho(usable.slice(0, -1), trio);

  // Momentum: recency-weighted signed returns normalized by ATR.
  const atrPct = atr > 0 && trio[2].candle.close > 0 ? (atr / trio[2].candle.close) * 100 : 0.1;
  let momentum = 0;
  const weights = [1, 2, 3];
  for (let i = 0; i < 3; i++) {
    momentum += weights[i] * Math.max(-1.5, Math.min(1.5, trio[i].returnPct / Math.max(atrPct, 0.001)));
  }
  const momentumScore = Math.max(-40, Math.min(40, (momentum / 9) * 40));

  let patternScore = 0;
  for (const p of patterns) {
    if (p.direction === "bull") patternScore += 20;
    else if (p.direction === "bear") patternScore -= 20;
  }
  patternScore = Math.max(-35, Math.min(35, patternScore));

  const echoScore = echo && echo.matches >= 8 ? Math.max(-25, Math.min(25, (echo.nextUpPct - 50) * 0.9)) : 0;

  const biasScore = Math.round(Math.max(-100, Math.min(100, momentumScore + patternScore + echoScore)));
  const bias: Direction = biasScore > 15 ? "bull" : biasScore < -15 ? "bear" : "neutral";

  const lead = patterns[0];
  const parts: string[] = [];
  if (lead && lead.direction !== "neutral") parts.push(`${lead.name} detected`);
  if (echo && echo.matches >= 8) {
    const side = echo.nextUpPct >= 50 ? "green" : "red";
    const pct = Math.max(echo.nextUpPct, echo.nextDownPct).toFixed(0);
    parts.push(`this shape resolved ${side} ${pct}% of the time (${echo.matches} precedents)`);
  }
  if (parts.length === 0) {
    parts.push(
      bias === "neutral"
        ? "no dominant sequence — treat the next candle as a coin flip"
        : `sequence momentum leans ${bias === "bull" ? "up" : "down"}`,
    );
  }
  const verdict =
    bias === "bull"
      ? `Leaning UP — ${parts.join("; ")}.`
      : bias === "bear"
        ? `Leaning DOWN — ${parts.join("; ")}.`
        : `No edge — ${parts.join("; ")}.`;

  return { timeframe, candles: trio, links, patterns, echo, biasScore, bias, verdict };
}
