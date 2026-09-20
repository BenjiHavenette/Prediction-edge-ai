import {
  atrSeries,
  bollingerSeries,
  emaSeries,
  macdSeries,
  rsiSeries,
  smaSeries,
  stochRsiSeries,
  vwapSeries,
} from "./indicators";
import { computeFifthDimension } from "./dimension";
import { BASE_WEIGHTS } from "./learning";
import type { CategoryWeights } from "./learning";
import { consecutiveRun, detectPatterns } from "./patterns";
import { detectSmc } from "./smc";
import type { Analysis, Candle, CategoryScores, Direction, PoolInfo, Recommendation, Signal } from "./types";

export interface SeriesBundle {
  ema9: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  macd: { macd: number[]; signal: number[]; hist: number[] };
  stochRsi: number[];
  vwap: number[];
  atr: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  bbWidth: number[];
  volSma: number[];
}

/** Computes every indicator series once. All series are causal (no lookahead). */
export function computeBundle(candles: Candle[]): SeriesBundle {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const bb = bollingerSeries(closes, 20, 2);
  return {
    ema9: emaSeries(closes, 9),
    ema20: emaSeries(closes, 20),
    ema50: emaSeries(closes, 50),
    ema200: emaSeries(closes, 200),
    rsi: rsiSeries(closes, 14),
    macd: macdSeries(closes),
    stochRsi: stochRsiSeries(closes),
    vwap: vwapSeries(candles),
    atr: atrSeries(candles, 14),
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbWidth: bb.widthPct,
    volSma: smaSeries(volumes, 20),
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const dirSign = (v: number, dead = 5): number => (v > dead ? 1 : v < -dead ? -1 : 0);

export interface AnalyzeOptions {
  /** Current live/mark price. */
  price: number;
  /** Lock price of the active round, if any. */
  lockPrice: number | null;
  /** The forming (not yet closed) candle, if live. */
  forming?: Candle | null;
  /** Fraction of the forming candle elapsed (0..1). */
  elapsedFraction?: number;
  /** Seconds remaining in the active round (null/undefined = full round). */
  secondsLeft?: number | null;
  /** Live PancakeSwap prize pool for the round, if known. */
  pool?: PoolInfo | null;
  /** Adaptive category weights from the learning engine (defaults to baseline). */
  weights?: CategoryWeights;
  /**
   * Regime noise discount from the BTC Mind engine (0..1). Pulls the
   * indicator probability toward 50% when the tape is unpredictable.
   */
  probShrink?: number;
}

/**
 * Runs the full weighted prediction engine at closed-candle index `i`.
 * Weights: Trend 25%, Momentum 20%, Volume 20%, Market Structure 15%, Confluence 20%.
 */
export function analyzeAt(candles: Candle[], b: SeriesBundle, i: number, opts: AnalyzeOptions): Analysis {
  const price = opts.price;
  const nz = (v: number, fb: number): number => (Number.isFinite(v) ? v : fb);

  const ema9 = nz(b.ema9[i], price);
  const ema20 = nz(b.ema20[i], price);
  const ema50 = nz(b.ema50[i], price);
  const ema200 = nz(b.ema200[i], price);
  const rsi = nz(b.rsi[i], 50);
  const prevRsi = nz(b.rsi[i - 1], rsi);
  const macdLine = nz(b.macd.macd[i], 0);
  const macdSignal = nz(b.macd.signal[i], 0);
  const macdHist = nz(b.macd.hist[i], 0);
  const prevHist = nz(b.macd.hist[i - 1], macdHist);
  const stochRsi = nz(b.stochRsi[i], 50);
  const vwap = nz(b.vwap[i], price);
  const atr = nz(b.atr[i], price * 0.0006);
  const bbUpper = nz(b.bbUpper[i], price * 1.001);
  const bbMiddle = nz(b.bbMiddle[i], price);
  const bbLower = nz(b.bbLower[i], price * 0.999);
  const bbWidth = nz(b.bbWidth[i], 0.2);
  const volSma = Math.max(nz(b.volSma[i], 1), 1e-9);

  const forming = opts.forming ?? null;
  const lastRef = forming ?? candles[i];
  const candleDirection: "green" | "red" | "flat" =
    lastRef.close > lastRef.open ? "green" : lastRef.close < lastRef.open ? "red" : "flat";

  // ---------- Price action ----------
  const run = consecutiveRun(candles, i);
  const patterns = detectPatterns(candles, i, atr);
  const paSignals: Signal[] = [];
  let bullPA = 0;
  let bearPA = 0;
  const runCount = Math.max(run.green, run.red);
  const runIsGreen = run.green >= run.red;
  if (runCount >= 2) {
    const pts = runCount === 2 ? 15 : runCount === 3 ? 25 : runCount === 4 ? 12 : 0;
    const exhaustion = runCount >= 5;
    if (runIsGreen) {
      bullPA += pts;
      if (exhaustion) bearPA += 18;
    } else {
      bearPA += pts;
      if (exhaustion) bullPA += 18;
    }
    paSignals.push({
      label: `${runCount} consecutive ${runIsGreen ? "green" : "red"} candles`,
      direction: exhaustion ? (runIsGreen ? "bear" : "bull") : runIsGreen ? "bull" : "bear",
      detail: exhaustion ? "Exhaustion risk — reversal watch" : "Momentum continuation",
    });
  }
  for (const p of patterns) {
    const w = p.name.includes("Engulfing") || p.name.includes("Breakout") ? 25 : p.name === "Doji" ? 0 : 20;
    if (p.direction === "bull") bullPA += w;
    else if (p.direction === "bear") bearPA += w;
    paSignals.push({ label: p.name, direction: p.direction });
  }
  bullPA = clamp(bullPA, 0, 100);
  bearPA = clamp(bearPA, 0, 100);
  const paScore = clamp(bullPA - bearPA, -100, 100);

  // ---------- Volume ----------
  const closedVol = candles[i].volume;
  const formingVol = forming ? forming.volume / Math.max(opts.elapsedFraction ?? 1, 0.2) : closedVol;
  const currentVol = forming ? formingVol : closedVol;
  const relative = currentVol / volSma;
  const relClosed = closedVol / volSma;
  const spike = Math.max(relative, relClosed) >= 1.8;
  const expansion = candles[i].volume > candles[i - 1].volume && candles[i - 1].volume > candles[i - 2].volume;
  let bullVol = 0;
  let bearVol = 0;
  for (let j = i - 9; j <= i; j++) {
    const cc = candles[j];
    if (cc.close >= cc.open) bullVol += cc.volume;
    else bearVol += cc.volume;
  }
  const totVol = bullVol + bearVol || 1;
  const bullPressure = (bullVol / totVol) * 100;
  const bearPressure = (bearVol / totVol) * 100;
  const priceNet5 = candles[i].close - candles[i - 5].close;
  const volNet5 =
    candles[i].volume + candles[i - 1].volume - (candles[i - 4].volume + candles[i - 5].volume);
  let divergence: Direction = "neutral";
  if (priceNet5 > 0 && volNet5 < 0) divergence = "bear";
  else if (priceNet5 < 0 && volNet5 < 0) divergence = "bull";

  const volSignals: Signal[] = [];
  if (spike) {
    volSignals.push({
      label: "Volume spike",
      direction: candleDirection === "green" ? "bull" : candleDirection === "red" ? "bear" : "neutral",
      detail: `${Math.max(relative, relClosed).toFixed(1)}x average`,
    });
  }
  if (expansion) volSignals.push({ label: "Volume expansion", direction: priceNet5 >= 0 ? "bull" : "bear", detail: "3 rising bars" });
  if (divergence !== "neutral") {
    volSignals.push({
      label: divergence === "bear" ? "Bearish volume divergence" : "Bullish volume divergence",
      direction: divergence,
      detail: "Price/volume disagreement",
    });
  }
  volSignals.push({
    label: bullPressure >= bearPressure ? "Buyers control tape" : "Sellers control tape",
    direction: bullPressure >= bearPressure ? "bull" : "bear",
    detail: `${Math.max(bullPressure, bearPressure).toFixed(0)}% of last 10 bars`,
  });
  let volScore = (bullPressure - bearPressure) * 0.8;
  if (spike) volScore += candleDirection === "green" ? 25 : candleDirection === "red" ? -25 : 0;
  if (expansion) volScore += priceNet5 > 0 ? 10 : -10;
  if (divergence === "bear") volScore -= 15;
  else if (divergence === "bull") volScore += 15;
  volScore = clamp(volScore, -100, 100);

  // ---------- Trend ----------
  const emas = [ema9, ema20, ema50, ema200];
  const aboveCount = emas.filter((e) => price > e).length;
  let cross: "golden" | "death" | null = null;
  for (let j = Math.max(1, i - 2); j <= i; j++) {
    const a9 = b.ema9[j];
    const a20 = b.ema20[j];
    const p9 = b.ema9[j - 1];
    const p20 = b.ema20[j - 1];
    if ([a9, a20, p9, p20].every((v) => Number.isFinite(v))) {
      if (p9 <= p20 && a9 > a20) cross = "golden";
      else if (p9 >= p20 && a9 < a20) cross = "death";
    }
  }
  const stackedBull = ema9 > ema20 && ema20 > ema50;
  const stackedBear = ema9 < ema20 && ema20 < ema50;
  let trendScore = (aboveCount - 2) * 30;
  if (stackedBull) trendScore += 20;
  if (stackedBear) trendScore -= 20;
  if (cross === "golden") trendScore += 20;
  if (cross === "death") trendScore -= 20;
  trendScore = clamp(trendScore, -100, 100);
  const trendSignals: Signal[] = [
    { label: `Price ${aboveCount >= 2 ? "above" : "below"} ${aboveCount}/4 EMAs`, direction: aboveCount >= 3 ? "bull" : aboveCount <= 1 ? "bear" : "neutral" },
  ];
  if (stackedBull) trendSignals.push({ label: "Bullish EMA stack (9 > 20 > 50)", direction: "bull" });
  if (stackedBear) trendSignals.push({ label: "Bearish EMA stack (9 < 20 < 50)", direction: "bear" });
  if (cross === "golden") trendSignals.push({ label: "EMA 9/20 golden cross", direction: "bull", detail: "Fresh crossover" });
  if (cross === "death") trendSignals.push({ label: "EMA 9/20 death cross", direction: "bear", detail: "Fresh crossover" });

  // ---------- Momentum ----------
  const momSignals: Signal[] = [];
  let momScore = 0;
  if (rsi >= 75) {
    momScore -= 8;
    momSignals.push({ label: `RSI overbought (${rsi.toFixed(0)})`, direction: "bear", detail: "Mean reversion risk" });
  } else if (rsi >= 60) {
    momScore += 25;
    momSignals.push({ label: `RSI bullish (${rsi.toFixed(0)})`, direction: "bull" });
  } else if (rsi >= 50) {
    momScore += 10;
    momSignals.push({ label: `RSI mildly bullish (${rsi.toFixed(0)})`, direction: "bull" });
  } else if (rsi >= 40) {
    momScore -= 10;
    momSignals.push({ label: `RSI mildly bearish (${rsi.toFixed(0)})`, direction: "bear" });
  } else if (rsi > 25) {
    momScore -= 25;
    momSignals.push({ label: `RSI bearish (${rsi.toFixed(0)})`, direction: "bear" });
  } else {
    momScore += 8;
    momSignals.push({ label: `RSI oversold (${rsi.toFixed(0)})`, direction: "bull", detail: "Bounce risk" });
  }
  if (macdHist > 0) {
    momScore += 18;
    momSignals.push({ label: "MACD histogram positive", direction: "bull" });
  } else if (macdHist < 0) {
    momScore -= 18;
    momSignals.push({ label: "MACD histogram negative", direction: "bear" });
  } else {
    momSignals.push({ label: "MACD flat", direction: "neutral" });
  }
  if (macdHist > prevHist) {
    momScore += 10;
    momSignals.push({ label: "MACD momentum rising", direction: "bull" });
  } else if (macdHist < prevHist) {
    momScore -= 10;
    momSignals.push({ label: "MACD momentum falling", direction: "bear" });
  }
  if (stochRsi >= 85) {
    momScore -= 8;
    momSignals.push({ label: `Stoch RSI overbought (${stochRsi.toFixed(0)})`, direction: "bear" });
  } else if (stochRsi <= 15) {
    momScore += 8;
    momSignals.push({ label: `Stoch RSI oversold (${stochRsi.toFixed(0)})`, direction: "bull" });
  } else if (stochRsi >= 50) {
    momScore += 8;
    momSignals.push({ label: `Stoch RSI rising zone (${stochRsi.toFixed(0)})`, direction: "bull" });
  } else {
    momScore -= 8;
    momSignals.push({ label: `Stoch RSI falling zone (${stochRsi.toFixed(0)})`, direction: "bear" });
  }
  momScore = clamp(momScore, -100, 100);
  const bullCount = momSignals.filter((s) => s.direction === "bull").length;
  const bearCount = momSignals.filter((s) => s.direction === "bear").length;
  const neutralCount = momSignals.filter((s) => s.direction === "neutral").length;

  // ---------- VWAP ----------
  const distancePct = vwap !== 0 ? ((price - vwap) / vwap) * 100 : 0;
  const vwapBias: Direction = distancePct > 0.04 ? "bull" : distancePct < -0.04 ? "bear" : "neutral";
  const vwapSignals: Signal[] = [
    {
      label: vwapBias === "neutral" ? "Price pinned to VWAP" : `Price ${distancePct > 0 ? "above" : "below"} VWAP`,
      direction: vwapBias,
      detail: `${distancePct >= 0 ? "+" : ""}${distancePct.toFixed(3)}%`,
    },
  ];

  // ---------- Bollinger ----------
  let wSum = 0;
  let wN = 0;
  for (let j = Math.max(0, i - 49); j <= i; j++) {
    const w = b.bbWidth[j];
    if (Number.isFinite(w)) {
      wSum += w;
      wN++;
    }
  }
  const avgW = wN > 0 ? wSum / wN : bbWidth;
  const bbState: "expansion" | "compression" | "normal" =
    bbWidth > avgW * 1.3 ? "expansion" : bbWidth < avgW * 0.7 ? "compression" : "normal";
  const cClose = candles[i].close;
  let bbEvent: Analysis["bollinger"]["event"] = null;
  if (cClose > bbUpper) bbEvent = "breakout-up";
  else if (cClose < bbLower) bbEvent = "breakout-down";
  else if (candles[i].high > bbUpper && cClose < bbUpper) bbEvent = "rejection-upper";
  else if (candles[i].low < bbLower && cClose > bbLower) bbEvent = "rejection-lower";
  let bbScore = 0;
  const bbSignals: Signal[] = [];
  if (bbEvent === "breakout-up") {
    bbScore = 25;
    bbSignals.push({ label: "Breakout above upper band", direction: "bull" });
  } else if (bbEvent === "breakout-down") {
    bbScore = -25;
    bbSignals.push({ label: "Breakdown below lower band", direction: "bear" });
  } else if (bbEvent === "rejection-upper") {
    bbScore = -18;
    bbSignals.push({ label: "Rejection at upper band", direction: "bear" });
  } else if (bbEvent === "rejection-lower") {
    bbScore = 18;
    bbSignals.push({ label: "Rejection at lower band", direction: "bull" });
  }
  bbSignals.push({
    label: bbState === "expansion" ? "Bands expanding — volatility rising" : bbState === "compression" ? "Bands compressed — squeeze building" : "Bands in normal regime",
    direction: "neutral",
    detail: `Width ${bbWidth.toFixed(3)}%`,
  });

  // ---------- Smart Money ----------
  const smc = detectSmc(candles, i, atr);
  let smcScore = 0;
  for (const e of smc) smcScore += e.direction === "bull" ? 25 : e.direction === "bear" ? -25 : 0;
  smcScore = clamp(smcScore, -60, 60);

  const structureScore = clamp(smcScore + bbScore * 0.8 + paScore * 0.35, -100, 100);

  // ---------- Confluence ----------
  const vwapSign = vwapBias === "bull" ? 1 : vwapBias === "bear" ? -1 : 0;
  const signs = [dirSign(trendScore), dirSign(momScore), dirSign(volScore), dirSign(structureScore), dirSign(paScore), vwapSign];
  const bulls = signs.filter((s) => s > 0).length;
  const bears = signs.filter((s) => s < 0).length;
  const confluenceScore = clamp(((bulls - bears) / signs.length) * 100, -100, 100);

  // ---------- Weighted probability ----------
  const categories: CategoryScores = {
    trend: Math.round(trendScore),
    momentum: Math.round(momScore),
    volume: Math.round(volScore),
    structure: Math.round(structureScore),
    confluence: Math.round(confluenceScore),
  };
  const w = opts.weights ?? BASE_WEIGHTS;
  const totalScore =
    w.trend * trendScore +
    w.momentum * momScore +
    w.volume * volScore +
    w.structure * structureScore +
    w.confluence * confluenceScore;
  const probShrink = clamp(opts.probShrink ?? 1, 0.1, 1);
  const indicatorUpProb = clamp(50 + totalScore * 0.45 * probShrink, 5, 95);

  // ---------- Fifth Dimension: gap physics, time decay, noise floor, payout EV ----------
  const secondsLeft = opts.secondsLeft ?? null;
  const { fifth, blendedUpProb } = computeFifthDimension({
    candles,
    index: i,
    price,
    lockPrice: opts.lockPrice,
    secondsLeft,
    atr,
    indicatorUpProb,
    pool: opts.pool ?? null,
  });
  const upProbability = Math.round(clamp(blendedUpProb, 3, 97));
  const downProbability = 100 - upProbability;
  const agreement = Math.abs(bulls - bears) / signs.length;
  let confidence = Math.round(clamp(28 + Math.abs(totalScore) * 0.55 + agreement * 32, 12, 96));
  if (fifth.coinFlip) {
    // A coin-flip round can never be a confident round.
    confidence = Math.min(confidence, 40);
  } else if (secondsLeft !== null && secondsLeft <= 120 && Math.abs(fifth.zScore) >= 1.2) {
    // Late round with the gap well clear of noise — the close model is near-certain.
    confidence = Math.max(confidence, Math.min(93, Math.round(50 + Math.abs(fifth.zScore) * 18)));
  }
  const expectedMovePct = (atr / price) * 100 * 2.24;
  const expectedDirection: "up" | "down" | "flat" = totalScore > 8 ? "up" : totalScore < -8 ? "down" : "flat";
  // Recommendation gates: never bet a coin flip, never bet a negative-EV side.
  let recommendation: Recommendation = "WAIT";
  if (!fifth.coinFlip) {
    if (upProbability >= 58 && confidence >= 55 && fifth.evUp >= 0.03) recommendation = "UP";
    else if (upProbability <= 42 && confidence >= 55 && fifth.evDown >= 0.03) recommendation = "DOWN";
  }

  const rsiReversal: Direction =
    prevRsi < 30 && rsi >= 30 ? "bull" : prevRsi > 70 && rsi <= 70 ? "bear" : "neutral";

  let narrative = buildNarrative({
    totalScore,
    upProbability,
    confidence,
    recommendation,
    aboveCount,
    rsi,
    spike,
    runCount,
    runIsGreen,
    smcLabels: smc.map((e) => e.label),
    cross,
    vwapBias,
    bbState,
    divergence,
    rsiReversal,
  });
  if (fifth.coinFlip) {
    narrative += ` Price is only $${Math.abs(fifth.gap).toFixed(2)} from lock with a ±$${fifth.noiseFloor.toFixed(2)} noise floor — this round is statistically a coin flip, no side has an edge.`;
  } else if (fifth.payoutUp !== null && fifth.payoutDown !== null && fifth.evUp <= 0 && fifth.evDown <= 0) {
    narrative += ` Crowd-skewed payouts (UP ${fifth.payoutUp.toFixed(2)}x / DOWN ${fifth.payoutDown.toFixed(2)}x) leave no positive expected value on either side.`;
  } else if (recommendation !== "WAIT") {
    const ev = recommendation === "UP" ? fifth.evUp : fifth.evDown;
    narrative += ` ${recommendation} carries ${(ev * 100).toFixed(1)}% expected value${fifth.evEstimated ? " (assuming a 1.95x payout)" : " at live pool payouts"}.`;
  }

  return {
    time: forming ? forming.time : candles[i].time,
    price,
    candleDirection,
    consecGreen: run.green,
    consecRed: run.red,
    patterns,
    priceAction: { bullScore: bullPA, bearScore: bearPA, signals: paSignals },
    volume: {
      current: currentVol,
      average: volSma,
      relative,
      spike,
      expansion,
      divergence,
      bullPressure,
      bearPressure,
      signals: volSignals,
    },
    trend: { ema9, ema20, ema50, ema200, aboveCount, cross, strength: Math.abs(trendScore), signals: trendSignals },
    momentum: {
      rsi,
      macd: macdLine,
      macdSignal,
      macdHist,
      stochRsi,
      strength: Math.abs(momScore),
      bullCount,
      bearCount,
      neutralCount,
      signals: momSignals,
    },
    vwap: { value: vwap, distancePct, bias: vwapBias, signals: vwapSignals },
    bollinger: { upper: bbUpper, middle: bbMiddle, lower: bbLower, widthPct: bbWidth, state: bbState, event: bbEvent, signals: bbSignals },
    smc,
    categories,
    totalScore,
    upProbability,
    downProbability,
    confidence,
    expectedMovePct,
    expectedDirection,
    recommendation,
    narrative,
    fifth,
  };
}

interface NarrativeInput {
  totalScore: number;
  upProbability: number;
  confidence: number;
  recommendation: Recommendation;
  aboveCount: number;
  rsi: number;
  spike: boolean;
  runCount: number;
  runIsGreen: boolean;
  smcLabels: string[];
  cross: "golden" | "death" | null;
  vwapBias: Direction;
  bbState: "expansion" | "compression" | "normal";
  divergence: Direction;
  rsiReversal: Direction;
}

function buildNarrative(n: NarrativeInput): string {
  const parts: string[] = [];
  if (n.totalScore >= 35) parts.push("Bitcoin is showing strong bullish momentum");
  else if (n.totalScore >= 12) parts.push("Bitcoin is leaning bullish");
  else if (n.totalScore <= -35) parts.push("Bitcoin is under strong bearish pressure");
  else if (n.totalScore <= -12) parts.push("Bitcoin is leaning bearish");
  else parts.push("Market conditions are mixed");

  const drivers: string[] = [];
  if (n.aboveCount >= 3) drivers.push("price holding above the major EMAs");
  else if (n.aboveCount <= 1) drivers.push("price trapped below the major EMAs");
  if (n.cross === "golden") drivers.push("a fresh EMA golden cross");
  if (n.cross === "death") drivers.push("a fresh EMA death cross");
  if (n.spike) drivers.push("a volume spike on the tape");
  if (n.runCount >= 3) drivers.push(`${n.runCount} consecutive ${n.runIsGreen ? "green" : "red"} candles`);
  if (n.rsi >= 60) drivers.push(`RSI at ${n.rsi.toFixed(0)}`);
  else if (n.rsi <= 40) drivers.push(`RSI down at ${n.rsi.toFixed(0)}`);
  if (n.vwapBias === "bull") drivers.push("trade above session VWAP");
  else if (n.vwapBias === "bear") drivers.push("trade below session VWAP");
  if (n.divergence === "bear") drivers.push("fading volume behind the move");
  if (n.rsiReversal === "bull") drivers.push("an RSI reversal out of oversold");
  if (n.rsiReversal === "bear") drivers.push("an RSI reversal out of overbought");
  if (n.smcLabels.length > 0) drivers.push(n.smcLabels[0].toLowerCase());
  if (n.bbState === "compression") drivers.push("a Bollinger squeeze building energy");

  if (drivers.length > 0) {
    parts[0] += ` with ${drivers.slice(0, 3).join(", ")}`;
  }
  parts[0] += ".";

  parts.push(
    `Estimated probability of closing above the lock price is ${n.upProbability}% (${100 - n.upProbability}% below).`,
  );

  if (n.recommendation === "WAIT") {
    parts.push(`Confidence is ${n.confidence < 45 ? "low" : "moderate"} at ${n.confidence}% — waiting for a cleaner setup is recommended.`);
  } else {
    parts.push(
      `Confidence is ${n.confidence >= 75 ? "high" : "moderate"} at ${n.confidence}% — model favors the ${n.recommendation === "UP" ? "UP" : "DOWN"} side this round.`,
    );
  }
  return parts.join(" ");
}
