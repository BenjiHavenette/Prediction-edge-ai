/**
 * BTC Mind — thinks like Bitcoin itself instead of trusting indicators.
 *
 * At the 5-minute scale BTC is mostly noise. Direction only "carries" when:
 *  1. The path is efficient — price travels more than it backtracks
 *     (Kaufman efficiency ratio).
 *  2. Drift clears the noise — the expected 5-minute move is large relative
 *     to the realized 5-minute volatility (signal-to-noise ratio).
 *  3. Moves have memory — 1-minute returns are not mean-reverting
 *     (lag-1 autocorrelation).
 *  4. The 15-MINUTE FRAME AGREES — a micro trend that fights the 15-minute
 *     structure is usually a pullback inside the bigger move and gets faded.
 *     Only micro trends confirmed by the 15m frame historically clear 60%.
 *
 * When these fail, the market is a coin flip no matter what RSI/MACD/EMAs say,
 * so this module produces a probability "shrink" that pulls every
 * indicator-based forecast toward 50% — and classifies the regime so the
 * Entry Advisor can refuse to bet against the tape's own physics.
 */

import type { Candle } from "./types";

export type RegimeKind = "trend-up" | "trend-down" | "chop" | "storm";

export type HtfBias = "up" | "down" | "neutral";

/** How the live micro trend relates to the 15-minute frame (null when not trending). */
export type HtfAlignment = "aligned" | "unconfirmed" | "conflict";

/** 15-minute higher-timeframe structure, built from aggregated 1m candles. */
export interface Htf15State {
  /** Completed-ish 15m bars available in the window. */
  bars: number;
  /** Kaufman efficiency ratio on 15m closes (0 = noise, 1 = straight line). */
  efficiency: number;
  /** Least-squares drift of the last 15m closes, $ per 15m bar. */
  driftPerBar: number;
  /** Realized bar-to-bar 15m dollar volatility. */
  sigmaBar: number;
  /** |drift| / sigma on the 15m frame. */
  snr: number;
  bias: HtfBias;
  label: string;
}

export interface RegimeState {
  kind: RegimeKind;
  /** Kaufman efficiency ratio over the last 30 bars (0 = pure noise, 1 = straight line). */
  efficiency: number;
  /** Least-squares drift of the last 15 closes, $ per minute. */
  driftPerMin: number;
  /** Realized 1-minute dollar volatility. */
  sigma1m: number;
  /** Signal-to-noise: |expected 5-min drift| / 5-min noise. */
  snr: number;
  /** Lag-1 autocorrelation of 1-minute moves (negative = mean-reverting). */
  autocorr: number;
  /** True when moves actively snap back — continuation bets are punished. */
  meanReverting: boolean;
  /** How predictable the next 5 minutes are, 0..100. */
  predictability: number;
  /** Factor applied to (probability − 50): 1 = trust indicators, →0 = coin flip. */
  shrink: number;
  /** 15-minute frame structure. */
  htf: Htf15State;
  /** Micro-trend vs 15m frame relationship (null when the micro tape isn't trending). */
  alignment: HtfAlignment | null;
  label: string;
  detail: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const HTF_BAR_MS = 15 * 60 * 1000;

/**
 * Aggregates 1m candles into 15-minute bars (clock-aligned) and measures the
 * higher-timeframe structure: efficiency, drift, noise and directional bias.
 * The forming 15m bar is included so the frame reacts to fresh breaks.
 */
export function computeHtf15(candles: Candle[], index: number): Htf15State {
  const i = Math.max(0, Math.min(index, candles.length - 1));
  // ~7 hours of 1m bars → up to ~28 fifteen-minute bars.
  const start = Math.max(0, i - 419);
  const closes: number[] = [];
  let bucket = -1;
  for (let j = start; j <= i; j++) {
    const b = Math.floor(candles[j].time / HTF_BAR_MS);
    if (b !== bucket) {
      bucket = b;
      closes.push(candles[j].close);
    } else {
      closes[closes.length - 1] = candles[j].close;
    }
  }
  const bars = closes.length;
  if (bars < 6) {
    return {
      bars,
      efficiency: 0,
      driftPerBar: 0,
      sigmaBar: 0,
      snr: 0,
      bias: "neutral",
      label: "15m frame warming up",
    };
  }

  // Kaufman efficiency over up to the last 16 fifteen-minute bars (~4 hours).
  const effN = Math.min(16, bars - 1);
  let path = 0;
  for (let k = bars - effN; k < bars; k++) path += Math.abs(closes[k] - closes[k - 1]);
  const net = closes[bars - 1] - closes[bars - 1 - effN];
  const efficiency = path > 0 ? clamp(Math.abs(net) / path, 0, 1) : 0;

  // Least-squares drift of the last 8 fifteen-minute closes ($ per bar).
  const dN = Math.min(8, bars);
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < dN; k++) {
    const y = closes[bars - dN + k];
    sx += k;
    sy += y;
    sxy += k * y;
    sxx += k * k;
  }
  const denom = dN * sxx - sx * sx;
  const driftPerBar = denom !== 0 ? (dN * sxy - sx * sy) / denom : 0;

  // Bar-to-bar volatility on the 15m frame.
  const diffs: number[] = [];
  for (let k = 1; k < bars; k++) diffs.push(closes[k] - closes[k - 1]);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const variance = diffs.reduce((s, d) => s + (d - mean) * (d - mean), 0) / diffs.length;
  const sigmaBar = Math.max(Math.sqrt(variance), closes[bars - 1] * 0.0001);

  const snr = sigmaBar > 0 ? Math.abs(driftPerBar) / sigmaBar : 0;
  const bias: HtfBias = efficiency >= 0.28 && snr >= 0.35 ? (driftPerBar >= 0 ? "up" : "down") : "neutral";

  const label =
    bias === "up"
      ? `15m uptrend (eff ${(efficiency * 100).toFixed(0)}%, +$${driftPerBar.toFixed(0)}/bar)`
      : bias === "down"
        ? `15m downtrend (eff ${(efficiency * 100).toFixed(0)}%, −$${Math.abs(driftPerBar).toFixed(0)}/bar)`
        : `15m frame flat (eff ${(efficiency * 100).toFixed(0)}%)`;

  return { bars, efficiency, driftPerBar, sigmaBar, snr, bias, label };
}

/**
 * Classifies BTC's live behavioral regime from the last closed candles.
 * `index` is the index of the last closed candle.
 */
export function computeRegime(candles: Candle[], index: number): RegimeState {
  const i = Math.max(1, Math.min(index, candles.length - 1));
  const price = candles[i].close;

  // 1-minute move series over the last 60 bars.
  const lo = Math.max(1, i - 59);
  const diffs: number[] = [];
  for (let j = lo; j <= i; j++) diffs.push(candles[j].close - candles[j - 1].close);
  const n = Math.max(diffs.length, 1);
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) * (d - mean), 0) / n;
  const sigma1m = Math.max(Math.sqrt(variance), price * 0.00004);

  // Path efficiency over the last 30 bars.
  const erStart = Math.max(1, i - 29);
  let path = 0;
  for (let j = erStart; j <= i; j++) path += Math.abs(candles[j].close - candles[j - 1].close);
  const net = candles[i].close - candles[erStart - 1].close;
  const efficiency = path > 0 ? clamp(Math.abs(net) / path, 0, 1) : 0;

  // Drift: least-squares slope of the last 15 closes ($ per minute).
  const dN = Math.min(15, i + 1);
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < dN; k++) {
    const y = candles[i - dN + 1 + k].close;
    sx += k;
    sy += y;
    sxy += k * y;
    sxx += k * k;
  }
  const denom = dN * sxx - sx * sx;
  const driftPerMin = denom !== 0 ? (dN * sxy - sx * sy) / denom : 0;

  const sigma5m = sigma1m * Math.sqrt(5);
  const snr = sigma5m > 0 ? Math.abs(driftPerMin * 5) / sigma5m : 0;

  // Lag-1 autocorrelation of 1-minute moves.
  let acNum = 0;
  let acDen = 0;
  for (let k = 1; k < diffs.length; k++) acNum += (diffs[k] - mean) * (diffs[k - 1] - mean);
  for (const d of diffs) acDen += (d - mean) * (d - mean);
  const autocorr = acDen > 0 ? clamp(acNum / acDen, -1, 1) : 0;
  const meanReverting = autocorr < -0.12;

  const volPct = sigma1m / price;
  let kind: RegimeKind;
  if (volPct > 0.0018 && efficiency < 0.3) kind = "storm";
  else if (efficiency >= 0.32 && snr >= 0.4) kind = driftPerMin >= 0 ? "trend-up" : "trend-down";
  else kind = "chop";

  // ---- 15-minute frame confirmation ----
  const htf = computeHtf15(candles, i);
  let alignment: HtfAlignment | null = null;
  if (kind === "trend-up" || kind === "trend-down") {
    const microDir: HtfBias = kind === "trend-up" ? "up" : "down";
    alignment = htf.bias === microDir ? "aligned" : htf.bias === "neutral" ? "unconfirmed" : "conflict";
  }

  let predictability = Math.round(
    clamp(efficiency * 80 + snr * 45 + (autocorr > 0.1 ? 8 : 0) - (meanReverting ? 15 : 0), 0, 100),
  );
  if (kind === "chop") predictability = Math.min(predictability, 34);
  if (kind === "storm") predictability = Math.min(predictability, 25);
  // 15m frame reshapes trend predictability: confirmation adds, conflict guts it.
  if (alignment === "aligned") predictability = Math.round(clamp(predictability + 12, 0, 100));
  else if (alignment === "conflict") predictability = Math.min(predictability, 36);

  let shrink =
    kind === "trend-up" || kind === "trend-down"
      ? clamp(0.45 + (predictability / 100) * 0.55, 0.45, 1)
      : kind === "storm"
        ? 0.18
        : 0.28;
  if (alignment === "aligned") shrink = clamp(shrink + 0.1, 0.45, 1);
  else if (alignment === "unconfirmed") shrink = clamp(shrink * 0.85, 0.3, 1);
  else if (alignment === "conflict") shrink = clamp(shrink * 0.5, 0.2, 0.45);

  let label: string;
  let detail: string;
  if (kind === "trend-up" || kind === "trend-down") {
    const up = kind === "trend-up";
    label = up ? "Uptrend regime" : "Downtrend regime";
    detail = `Path efficiency ${(efficiency * 100).toFixed(0)}% with drift ${up ? "+" : "−"}$${Math.abs(driftPerMin * 5).toFixed(2)}/5min clearing the ±$${sigma5m.toFixed(2)} noise — ${up ? "upside" : "downside"} follow-through is statistically favored.`;
    if (alignment === "aligned") {
      label += " · 15m confirmed";
      detail += ` The 15-minute frame confirms (${htf.label}) — the highest-accuracy condition the engine knows.`;
    } else if (alignment === "conflict") {
      label += " · 15m conflict";
      detail += ` But the 15-minute frame points the OTHER way (${htf.label}) — this micro move is likely a pullback inside the bigger trend, historically a losing bet.`;
    } else {
      label += " · 15m flat";
      detail += ` The 15-minute frame has not confirmed yet (${htf.label}) — partial trust only.`;
    }
  } else if (kind === "storm") {
    label = "Storm regime";
    detail = `Violent but directionless — ±$${sigma1m.toFixed(2)}/min swings with only ${(efficiency * 100).toFixed(0)}% path efficiency. Big candles both ways, no follow-through. ${htf.label}.`;
  } else {
    label = "Chop regime";
    detail = `Price is backtracking more than it travels (${(efficiency * 100).toFixed(0)}% efficiency) and 1-minute moves ${meanReverting ? "actively snap back" : "carry no memory"} — 5-minute closes here are coin flips. ${htf.label}.`;
  }

  return {
    kind,
    efficiency,
    driftPerMin,
    sigma1m,
    snr,
    autocorr,
    meanReverting,
    predictability,
    shrink,
    htf,
    alignment,
    label,
    detail,
  };
}
