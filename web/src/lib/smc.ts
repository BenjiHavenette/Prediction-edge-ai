import type { Candle, SmcEvent } from "./types";

/**
 * Smart Money Concepts detection over the closed candle at index `i`.
 * Flags liquidity sweeps, stop hunts, fake breakouts (bull/bear traps) and sharp reversals.
 */
export function detectSmc(candles: Candle[], i: number, atr: number): SmcEvent[] {
  const events: SmcEvent[] = [];
  if (i < 16) return events;
  const c = candles[i];
  const prev = candles[i - 1];

  let hh = -Infinity;
  let ll = Infinity;
  for (let j = i - 10; j < i; j++) {
    if (candles[j].high > hh) hh = candles[j].high;
    if (candles[j].low < ll) ll = candles[j].low;
  }

  if (c.high > hh && c.close < hh && c.close < c.open) {
    events.push({ type: "sweep-high", direction: "bear", label: "Liquidity sweep above highs — stop hunt" });
  }
  if (c.low < ll && c.close > ll && c.close > c.open) {
    events.push({ type: "sweep-low", direction: "bull", label: "Liquidity sweep below lows — stop hunt" });
  }

  let hh2 = -Infinity;
  let ll2 = Infinity;
  for (let j = i - 11; j < i - 1; j++) {
    if (candles[j].high > hh2) hh2 = candles[j].high;
    if (candles[j].low < ll2) ll2 = candles[j].low;
  }
  if (prev.close > hh2 && c.close < hh2) {
    events.push({ type: "bull-trap", direction: "bear", label: "Bull trap — fake breakout above range" });
  }
  if (prev.close < ll2 && c.close > ll2) {
    events.push({ type: "bear-trap", direction: "bull", label: "Bear trap — fake breakdown below range" });
  }

  const range = c.high - c.low;
  if (atr > 0 && range > atr * 2.2 && i >= 4) {
    const net3 = candles[i - 1].close - candles[i - 4].close;
    if (net3 > 0 && c.close < c.open) {
      events.push({ type: "sharp-reversal", direction: "bear", label: "Sharp bearish reversal candle" });
    }
    if (net3 < 0 && c.close > c.open) {
      events.push({ type: "sharp-reversal", direction: "bull", label: "Sharp bullish reversal candle" });
    }
  }

  return events;
}
