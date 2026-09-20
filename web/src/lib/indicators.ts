import type { Candle } from "./types";

/** Simple moving average series. NaN during warmup. */
export function smaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average series seeded with SMA. NaN during warmup. */
export function emaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/** Wilder RSI series. NaN during warmup. */
export function rsiSeries(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdBundle {
  macd: number[];
  signal: number[];
  hist: number[];
}

/** MACD (12/26/9) series. */
export function macdSeries(values: number[]): MacdBundle {
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macd: number[] = values.map((_, i) =>
    Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : NaN,
  );
  const signal: number[] = new Array(values.length).fill(NaN);
  const k = 2 / 10;
  let ema = 0;
  let seeded = false;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const m = macd[i];
    if (!Number.isFinite(m)) continue;
    if (!seeded) {
      seedSum += m;
      seedCount++;
      if (seedCount === 9) {
        ema = seedSum / 9;
        signal[i] = ema;
        seeded = true;
      }
      continue;
    }
    ema = m * k + ema * (1 - k);
    signal[i] = ema;
  }
  const hist = macd.map((m, i) => (Number.isFinite(m) && Number.isFinite(signal[i]) ? m - signal[i] : NaN));
  return { macd, signal, hist };
}

/** Stochastic RSI %K (smoothed) series, 0..100. */
export function stochRsiSeries(values: number[], rsiPeriod = 14, stochPeriod = 14, smoothK = 3): number[] {
  const rsi = rsiSeries(values, rsiPeriod);
  const raw: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(rsi[i]) || i < rsiPeriod + stochPeriod) continue;
    let mn = Infinity;
    let mx = -Infinity;
    let ok = true;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      const r = rsi[j];
      if (!Number.isFinite(r)) {
        ok = false;
        break;
      }
      if (r < mn) mn = r;
      if (r > mx) mx = r;
    }
    if (!ok) continue;
    raw[i] = mx === mn ? 50 : ((rsi[i] - mn) / (mx - mn)) * 100;
  }
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - smoothK + 1); j <= i; j++) {
      if (Number.isFinite(raw[j])) {
        s += raw[j];
        n++;
      }
    }
    if (n === smoothK) out[i] = s / n;
  }
  return out;
}

export interface BollingerSeries {
  upper: number[];
  middle: number[];
  lower: number[];
  widthPct: number[];
}

/** Bollinger Bands (20, 2) series. */
export function bollingerSeries(values: number[], period = 20, mult = 2): BollingerSeries {
  const middle = smaSeries(values, period);
  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);
  const widthPct: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
    widthPct[i] = m !== 0 ? ((upper[i] - lower[i]) / m) * 100 : NaN;
  }
  return { upper, middle, lower, widthPct };
}

/** Session VWAP series, anchored to the UTC day. */
export function vwapSeries(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  let day = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const d = Math.floor(c.time / 86400000);
    if (d !== day) {
      day = d;
      cumPV = 0;
      cumV = 0;
    }
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumV += c.volume;
    out[i] = cumV > 0 ? cumPV / cumV : c.close;
  }
  return out;
}

/** Wilder ATR series. */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  let atr = 0;
  for (let i = 0; i < period; i++) atr += tr[i];
  atr /= period;
  out[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

/** Percentage returns of a close series. */
export function returnsOf(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(closes[i - 1] !== 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  }
  return out;
}

/** Pearson correlation coefficient of two equal-length series, -1..1. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}
