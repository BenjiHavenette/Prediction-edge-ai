import type { Candle, PatternHit } from "./types";

/** Counts consecutive same-color closed candles ending at `endIdx` (walking backwards). */
export function consecutiveRun(candles: Candle[], endIdx: number): { green: number; red: number } {
  let green = 0;
  let red = 0;
  for (let i = endIdx; i >= 0; i--) {
    const c = candles[i];
    if (c.close > c.open) {
      if (red > 0) break;
      green++;
    } else if (c.close < c.open) {
      if (green > 0) break;
      red++;
    } else {
      break;
    }
  }
  return { green, red };
}

/** Detects candlestick patterns on the candle at index `i` (last closed bar). */
export function detectPatterns(candles: Candle[], i: number, atr: number): PatternHit[] {
  const hits: PatternHit[] = [];
  if (i < 12) return hits;
  const c = candles[i];
  const p = candles[i - 1];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const green = c.close > c.open;
  const red = c.close < c.open;
  const pBody = Math.abs(p.close - p.open);

  if (range > 0 && body <= range * 0.1) {
    hits.push({ name: "Doji", direction: "neutral" });
  }
  if (body > 0 && lowerWick >= body * 2 && upperWick <= body && c.close >= c.low + range * 0.6) {
    hits.push({ name: "Hammer", direction: "bull" });
  }
  if (body > 0 && upperWick >= body * 2 && lowerWick <= body && c.close <= c.high - range * 0.6) {
    hits.push({ name: "Shooting Star", direction: "bear" });
  }
  if (green && p.close < p.open && c.close > p.open && c.open <= p.close && body > pBody) {
    hits.push({ name: "Bullish Engulfing", direction: "bull" });
  }
  if (red && p.close > p.open && c.close < p.open && c.open >= p.close && body > pBody) {
    hits.push({ name: "Bearish Engulfing", direction: "bear" });
  }
  if (atr > 0 && body > atr * 1.4 && range > 0 && body / range > 0.7) {
    hits.push({ name: "Momentum Candle", direction: green ? "bull" : "bear" });
  }

  let hh = -Infinity;
  let ll = Infinity;
  for (let j = i - 10; j < i; j++) {
    if (candles[j].high > hh) hh = candles[j].high;
    if (candles[j].low < ll) ll = candles[j].low;
  }
  if (c.close > hh) hits.push({ name: "Breakout Candle (Up)", direction: "bull" });
  if (c.close < ll) hits.push({ name: "Breakout Candle (Down)", direction: "bear" });

  return hits;
}
