/**
 * Regime Clock — survival analysis of BTC's behavioral regimes.
 *
 * Classifies every historical 1-minute bar into trend / chop / storm using the
 * same BTC Mind engine that gates entries, then builds a database of how long
 * each regime historically survives. From that it estimates:
 *  - how much longer the CURRENT regime may last (conditional on its age),
 *  - a countdown to the next trending tape when the market is trend-free,
 *  - a "trend warming" score from efficiency/SNR building toward the
 *    trend thresholds (efficiency ≥ 0.32, SNR ≥ 0.40).
 *
 * All estimates are conditional medians: given a chop stretch has already
 * lasted N minutes, how much longer did similar stretches historically run?
 */

import { computeRegime } from "./regime";
import type { RegimeKind } from "./regime";
import type { Candle } from "./types";

export type RegimeGroup = "trend" | "chop" | "storm";

export const groupOf = (k: RegimeKind): RegimeGroup =>
  k === "chop" ? "chop" : k === "storm" ? "storm" : "trend";

/** One classified 1-minute bar. */
export interface RegimePoint {
  time: number;
  kind: RegimeKind;
  group: RegimeGroup;
  efficiency: number;
  snr: number;
  /** Close price of the bar — lets the timeline show per-segment price moves. */
  close: number;
}

/** A contiguous run of one regime group. */
export interface RegimeSegment {
  group: RegimeGroup;
  /** Dominant kind inside the segment (trend segments resolve to up/down). */
  kind: RegimeKind;
  start: number;
  end: number;
  minutes: number;
  ongoing: boolean;
  /** Mean path efficiency across the segment's bars (0..1). */
  avgEfficiency: number;
  /** Mean signal-to-noise across the segment's bars. */
  avgSnr: number;
  /** BTC close at the segment's first bar. */
  openPrice: number;
  /** BTC close at the segment's last bar. */
  closePrice: number;
}

/** Conditional time estimate in minutes (median with interquartile range). */
export interface EtaEstimate {
  medianMin: number;
  p25Min: number;
  p75Min: number;
  /** True when the current run has outlasted every recorded precedent. */
  overdue: boolean;
  sample: number;
}

export interface WarmingSignal {
  label: string;
  good: boolean;
  detail: string;
}

export interface DurationStat {
  group: RegimeGroup;
  count: number;
  medianMin: number;
  avgMin: number;
  maxMin: number;
  sharePct: number;
}

export interface RegimeForecast {
  currentKind: RegimeKind;
  currentGroup: RegimeGroup;
  currentLabel: string;
  /** When the current regime segment began (ms epoch). */
  sinceMs: number;
  /** Live age of the current regime segment, minutes. */
  ageMin: number;
  /** How much longer the current regime may last. */
  remaining: EtaEstimate;
  /** Countdown to the next trending tape (null when already trending). */
  nextTrendEta: EtaEstimate | null;
  /** Age of the current trend-free (chop+storm) stretch, minutes. */
  stretchAgeMin: number | null;
  /** 0..100 — how close conditions are to igniting a trend. */
  warming: number;
  warmingSignals: WarmingSignal[];
  stats: DurationStat[];
  /** Full classified history segments (oldest → newest, last one ongoing). */
  timeline: RegimeSegment[];
  trendSharePct: number;
  narrative: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const toPoint = (
  time: number,
  close: number,
  r: { kind: RegimeKind; efficiency: number; snr: number },
): RegimePoint => ({
  time,
  kind: r.kind,
  group: groupOf(r.kind),
  efficiency: r.efficiency,
  snr: r.snr,
  close,
});

/**
 * Maintains the classified regime series incrementally: appends one point when
 * a new candle closes, rebuilds from scratch only on init or history reload.
 * `closedIdx` is the index of the last closed candle.
 */
export function buildRegimeSeries(candles: Candle[], closedIdx: number, prev: RegimePoint[]): RegimePoint[] {
  if (closedIdx < 60) return prev;
  const lastClosedTime = candles[closedIdx].time;
  // Points from an older build may lack price data — force a full rebuild then.
  const prevValid = prev.length > 0 && typeof prev[prev.length - 1].close === "number";
  const prevLast = prevValid ? prev[prev.length - 1].time : 0;
  if (prevValid && prevLast === lastClosedTime) return prev;
  if (prevValid && candles[closedIdx - 1]?.time === prevLast) {
    const next = [...prev, toPoint(lastClosedTime, candles[closedIdx].close, computeRegime(candles, closedIdx))];
    return next.length > 3000 ? next.slice(next.length - 3000) : next;
  }
  const out: RegimePoint[] = [];
  for (let i = 60; i <= closedIdx; i++) {
    out.push(toPoint(candles[i].time, candles[i].close, computeRegime(candles, i)));
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Median remaining lifetime given the run has already survived `ageMin`. */
function conditionalEta(durations: number[], ageMin: number): EtaEstimate {
  const rem = durations
    .filter((d) => d > ageMin)
    .map((d) => d - ageMin)
    .sort((a, b) => a - b);
  if (rem.length === 0) return { medianMin: 0, p25Min: 0, p75Min: 0, overdue: true, sample: 0 };
  return {
    medianMin: quantile(rem, 0.5),
    p25Min: quantile(rem, 0.25),
    p75Min: quantile(rem, 0.75),
    overdue: false,
    sample: rem.length,
  };
}

function slopeOf(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < n; k++) {
    sx += k;
    sy += values[k];
    sxy += k * values[k];
    sxx += k * k;
  }
  const den = n * sxx - sx * sx;
  return den !== 0 ? (n * sxy - sx * sy) / den : 0;
}

interface RawSegment {
  group: RegimeGroup;
  start: number;
  end: number;
  minutes: number;
  upCount: number;
  downCount: number;
  effSum: number;
  snrSum: number;
  openPrice: number;
  closePrice: number;
}

function segmentize(points: RegimePoint[]): RawSegment[] {
  const segs: RawSegment[] = [];
  for (const p of points) {
    const last = segs[segs.length - 1];
    if (last && last.group === p.group) {
      last.end = p.time + 60_000;
      last.minutes += 1;
      last.effSum += p.efficiency;
      last.snrSum += p.snr;
      last.closePrice = p.close;
      if (p.kind === "trend-up") last.upCount += 1;
      if (p.kind === "trend-down") last.downCount += 1;
    } else {
      segs.push({
        group: p.group,
        start: p.time,
        end: p.time + 60_000,
        minutes: 1,
        upCount: p.kind === "trend-up" ? 1 : 0,
        downCount: p.kind === "trend-down" ? 1 : 0,
        effSum: p.efficiency,
        snrSum: p.snr,
        openPrice: p.close,
        closePrice: p.close,
      });
    }
  }
  return segs;
}

const dominantKind = (s: RawSegment): RegimeKind =>
  s.group === "chop" ? "chop" : s.group === "storm" ? "storm" : s.upCount >= s.downCount ? "trend-up" : "trend-down";

const groupLabel = (g: RegimeGroup, k: RegimeKind): string =>
  g === "chop" ? "Chop regime" : g === "storm" ? "Storm regime" : k === "trend-up" ? "Uptrend tape" : "Downtrend tape";

const fmtMin = (m: number): string => (m >= 90 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

/**
 * Full Regime Clock forecast. `nowMs` should be blockchain-corrected time so
 * the live age/countdowns match the round clock.
 */
export function computeRegimeForecast(points: RegimePoint[], nowMs: number): RegimeForecast | null {
  if (points.length < 120) return null;
  const segs = segmentize(points);
  if (segs.length === 0) return null;

  const cur = segs[segs.length - 1];
  const curKind = dominantKind(cur);
  const curGroup = cur.group;
  const ageMin = Math.max(cur.minutes, (nowMs - cur.start) / 60_000);

  // Closed (fully observed) segments only — the ongoing one is censored.
  const closed = segs.slice(0, -1);
  const durationsByGroup: Record<RegimeGroup, number[]> = { trend: [], chop: [], storm: [] };
  for (const s of closed) durationsByGroup[s.group].push(s.minutes);

  const remaining = conditionalEta(durationsByGroup[curGroup], ageMin);

  // Trend-free stretches: contiguous chop+storm runs between trends.
  const stretchDurations: number[] = [];
  let run = 0;
  for (const s of closed) {
    if (s.group === "trend") {
      if (run > 0) stretchDurations.push(run);
      run = 0;
    } else {
      run += s.minutes;
    }
  }
  // `run` now holds minutes of the trailing closed non-trend segments; the
  // ongoing segment extends it — that whole stretch is censored, not counted.

  let nextTrendEta: EtaEstimate | null = null;
  let stretchAgeMin: number | null = null;
  if (curGroup !== "trend") {
    // Walk back to the start of the current trend-free stretch.
    let stretchStart = cur.start;
    for (let i = segs.length - 2; i >= 0; i--) {
      if (segs[i].group === "trend") break;
      stretchStart = segs[i].start;
    }
    stretchAgeMin = Math.max(0, (nowMs - stretchStart) / 60_000);
    nextTrendEta = conditionalEta(stretchDurations, stretchAgeMin);
  }

  // Trend warming — how close the tape is to clearing the trend thresholds.
  const lastPt = points[points.length - 1];
  const recent = points.slice(-12);
  const effSlope = slopeOf(recent.map((p) => p.efficiency));
  const snrSlope = slopeOf(recent.map((p) => p.snr));
  const effScore = clamp(lastPt.efficiency / 0.32, 0, 1);
  const snrScore = clamp(lastPt.snr / 0.4, 0, 1);
  const warming = Math.round(
    clamp(
      effScore * 40 +
        snrScore * 30 +
        (effSlope > 0 ? clamp(effSlope / 0.012, 0, 1) * 15 : 0) +
        (snrSlope > 0 ? clamp(snrSlope / 0.025, 0, 1) * 15 : 0),
      0,
      100,
    ),
  );
  const warmingSignals: WarmingSignal[] = [
    {
      label: "Path efficiency",
      good: lastPt.efficiency >= 0.32,
      detail: `${(lastPt.efficiency * 100).toFixed(0)}% / needs ≥32%`,
    },
    {
      label: "Signal-to-noise",
      good: lastPt.snr >= 0.4,
      detail: `${lastPt.snr.toFixed(2)} / needs ≥0.40`,
    },
    {
      label: "Efficiency building",
      good: effSlope > 0.001,
      detail: `${effSlope >= 0 ? "+" : ""}${(effSlope * 100).toFixed(1)}pp/min`,
    },
    {
      label: "Drift strengthening",
      good: snrSlope > 0.002,
      detail: `${snrSlope >= 0 ? "+" : ""}${snrSlope.toFixed(3)}/min`,
    },
  ];

  // Duration statistics per group.
  const totalMin = closed.reduce((s, x) => s + x.minutes, 0) || 1;
  const stats: DurationStat[] = (["trend", "chop", "storm"] as RegimeGroup[]).map((g) => {
    const ds = durationsByGroup[g].slice().sort((a, b) => a - b);
    const sum = ds.reduce((s, d) => s + d, 0);
    return {
      group: g,
      count: ds.length,
      medianMin: quantile(ds, 0.5),
      avgMin: ds.length > 0 ? sum / ds.length : 0,
      maxMin: ds.length > 0 ? ds[ds.length - 1] : 0,
      sharePct: (sum / totalMin) * 100,
    };
  });
  const trendSharePct = stats[0].sharePct;

  // Timeline: the FULL classified history (up to ~50h) — the UI scrolls it.
  const timeline: RegimeSegment[] = segs.map((s, i) => {
    const ongoing = i === segs.length - 1;
    return {
      group: s.group,
      kind: dominantKind(s),
      start: s.start,
      end: ongoing ? nowMs : s.end,
      minutes: ongoing ? ageMin : s.minutes,
      ongoing,
      avgEfficiency: s.minutes > 0 ? s.effSum / s.minutes : 0,
      avgSnr: s.minutes > 0 ? s.snrSum / s.minutes : 0,
      openPrice: s.openPrice,
      closePrice: s.closePrice,
    };
  });

  // Narrative.
  const label = groupLabel(curGroup, curKind);
  let narrative: string;
  if (curGroup === "trend") {
    narrative = remaining.overdue
      ? `This ${curKind === "trend-up" ? "up" : "down"}trend has run ${fmtMin(ageMin)} — longer than every recorded trend in the database. Late-stage tape: expect exhaustion, tighten up.`
      : `Trending tape live for ${fmtMin(ageMin)}. Similar trends historically held ~${fmtMin(remaining.medianMin)} more (typical ${fmtMin(remaining.p25Min)}–${fmtMin(remaining.p75Min)}). This is the window the Entry Advisor bets in.`;
  } else if (nextTrendEta && nextTrendEta.overdue) {
    narrative = `${label} — this trend-free stretch has run ${fmtMin(stretchAgeMin ?? ageMin)}, outlasting every recorded stretch. Statistically overdue: a trending tape can ignite any minute. Warming ${warming}%.`;
  } else if (nextTrendEta) {
    narrative = `${label} for ${fmtMin(ageMin)} (trend-free for ${fmtMin(stretchAgeMin ?? ageMin)}). Based on ${nextTrendEta.sample} similar stretches, the next trending tape typically arrives in ~${fmtMin(nextTrendEta.medianMin)} (range ${fmtMin(nextTrendEta.p25Min)}–${fmtMin(nextTrendEta.p75Min)}). Warming ${warming}% — ${warming >= 60 ? "conditions building fast, watch closely" : warming >= 35 ? "energy coiling but thresholds not cleared" : "no ignition signs yet, stand down and wait"}.`;
  } else {
    narrative = `${label} for ${fmtMin(ageMin)}.`;
  }

  return {
    currentKind: curKind,
    currentGroup: curGroup,
    currentLabel: label,
    sinceMs: cur.start,
    ageMin,
    remaining,
    nextTrendEta,
    stretchAgeMin,
    warming,
    warmingSignals,
    stats,
    timeline,
    trendSharePct,
    narrative,
  };
}
