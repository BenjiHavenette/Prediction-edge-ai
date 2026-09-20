import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from "lightweight-charts";
import type { IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { CandlestickChart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMarket } from "@/hooks/useMarket";
import { emaSeries, vwapSeries, bollingerSeries } from "@/lib/indicators";
import type { Candle } from "@/lib/types";
import { cn } from "@/lib/utils";

const UP_COLOR = "#14d98a";
const DOWN_COLOR = "#ff4d5e";

type Timeframe = "1m" | "5m" | "15m";

const TF_MS: Record<Timeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000 };
const TF_BARS: Record<Timeframe, number> = { "1m": 360, "5m": 288, "15m": 192 };

interface OverlayState {
  ema: boolean;
  vwap: boolean;
  bb: boolean;
  sr: boolean;
}

function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
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

function findLevels(candles: Candle[], price: number): { supports: number[]; resistances: number[] } {
  const supports: number[] = [];
  const resistances: number[] = [];
  const n = candles.length;
  const from = Math.max(3, n - 120);
  for (let i = from; i < n - 3; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh && c.high > price) resistances.push(c.high);
    if (isLow && c.low < price) supports.push(c.low);
  }
  resistances.sort((a, b) => a - b);
  supports.sort((a, b) => b - a);
  return { supports: supports.slice(0, 2), resistances: resistances.slice(0, 2) };
}

interface PriceChartProps {
  candles: Candle[];
  lockPrice: number | null;
}

/** TradingView Lightweight Charts panel with EMA/VWAP/Bollinger overlays and S/R levels. */
export default function PriceChart({ candles, lockPrice }: PriceChartProps) {
  const { coin } = useMarket();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLoRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lockLineRef = useRef<IPriceLine | null>(null);
  const srLinesRef = useRef<IPriceLine[]>([]);
  const dataKeyRef = useRef<string>("");

  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [overlays, setOverlays] = useState<OverlayState>({ ema: true, vwap: true, bb: false, sr: true });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#77809a",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(120, 132, 160, 0.07)" },
        horzLines: { color: "rgba(120, 132, 160, 0.07)" },
      },
      rightPriceScale: { borderColor: "rgba(120, 132, 160, 0.15)" },
      timeScale: {
        borderColor: "rgba(120, 132, 160, 0.15)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        vertLine: { color: "rgba(34, 211, 238, 0.35)", labelBackgroundColor: "#164e63" },
        horzLine: { color: "rgba(34, 211, 238, 0.35)", labelBackgroundColor: "#164e63" },
      },
    });
    chartRef.current = chart;

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderVisible: false,
    });
    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const lineDefaults = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false } as const;
    ema9Ref.current = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 1, ...lineDefaults });
    ema20Ref.current = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, ...lineDefaults });
    ema50Ref.current = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, ...lineDefaults });
    vwapRef.current = chart.addSeries(LineSeries, {
      color: "#e2e8f0",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      ...lineDefaults,
    });
    bbUpRef.current = chart.addSeries(LineSeries, {
      color: "rgba(148, 163, 184, 0.55)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      ...lineDefaults,
    });
    bbLoRef.current = chart.addSeries(LineSeries, {
      color: "rgba(148, 163, 184, 0.55)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      ...lineDefaults,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lockLineRef.current = null;
      srLinesRef.current = [];
      dataKeyRef.current = "";
    };
  }, []);

  const display = useMemo(() => {
    const full = timeframe === "1m" ? candles : aggregateCandles(candles, TF_MS[timeframe]);
    const bars = full.slice(-TF_BARS[timeframe]);
    const closes = full.map((c) => c.close);
    const offset = full.length - bars.length;
    const ema9 = emaSeries(closes, 9).slice(offset);
    const ema20 = emaSeries(closes, 20).slice(offset);
    const ema50 = emaSeries(closes, 50).slice(offset);
    const vwap = vwapSeries(full).slice(offset);
    const bb = bollingerSeries(closes, 20, 2);
    const bbUp = bb.upper.slice(offset);
    const bbLo = bb.lower.slice(offset);
    return { bars, ema9, ema20, ema50, vwap, bbUp, bbLo };
  }, [candles, timeframe]);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs || display.bars.length === 0) return;

    const toTime = (ms: number): UTCTimestamp => (ms / 1000) as UTCTimestamp;
    const lineData = (values: number[]) =>
      display.bars
        .map((b, idx) => ({ time: toTime(b.time), value: values[idx] }))
        .filter((p) => Number.isFinite(p.value));

    const last = display.bars[display.bars.length - 1];
    const key = `${timeframe}:${display.bars[0].time}:${display.bars.length}`;

    if (key === dataKeyRef.current) {
      // Same window — only refresh the forming bar for smooth 1s updates.
      cs.update({ time: toTime(last.time), open: last.open, high: last.high, low: last.low, close: last.close });
      vs.update({
        time: toTime(last.time),
        value: last.volume,
        color: last.close >= last.open ? "rgba(20, 217, 138, 0.35)" : "rgba(255, 77, 94, 0.35)",
      });
      const updateLast = (ref: ISeriesApi<"Line"> | null, values: number[]) => {
        const v = values[values.length - 1];
        if (ref && Number.isFinite(v)) ref.update({ time: toTime(last.time), value: v });
      };
      updateLast(ema9Ref.current, display.ema9);
      updateLast(ema20Ref.current, display.ema20);
      updateLast(ema50Ref.current, display.ema50);
      updateLast(vwapRef.current, display.vwap);
      updateLast(bbUpRef.current, display.bbUp);
      updateLast(bbLoRef.current, display.bbLo);
      return;
    }

    dataKeyRef.current = key;
    cs.setData(
      display.bars.map((b) => ({ time: toTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close })),
    );
    vs.setData(
      display.bars.map((b) => ({
        time: toTime(b.time),
        value: b.volume,
        color: b.close >= b.open ? "rgba(20, 217, 138, 0.35)" : "rgba(255, 77, 94, 0.35)",
      })),
    );
    ema9Ref.current?.setData(lineData(display.ema9));
    ema20Ref.current?.setData(lineData(display.ema20));
    ema50Ref.current?.setData(lineData(display.ema50));
    vwapRef.current?.setData(lineData(display.vwap));
    bbUpRef.current?.setData(lineData(display.bbUp));
    bbLoRef.current?.setData(lineData(display.bbLo));
  }, [display, timeframe]);

  useEffect(() => {
    ema9Ref.current?.applyOptions({ visible: overlays.ema });
    ema20Ref.current?.applyOptions({ visible: overlays.ema });
    ema50Ref.current?.applyOptions({ visible: overlays.ema });
    vwapRef.current?.applyOptions({ visible: overlays.vwap });
    bbUpRef.current?.applyOptions({ visible: overlays.bb });
    bbLoRef.current?.applyOptions({ visible: overlays.bb });
  }, [overlays]);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs) return;
    if (lockLineRef.current) {
      cs.removePriceLine(lockLineRef.current);
      lockLineRef.current = null;
    }
    if (lockPrice !== null && lockPrice > 0) {
      lockLineRef.current = cs.createPriceLine({
        price: lockPrice,
        color: "#fbbf24",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "LOCK",
      });
    }
  }, [lockPrice]);

  const srKey = Math.floor((display.bars[display.bars.length - 1]?.time ?? 0) / 60000);
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs || display.bars.length < 30) return;
    for (const line of srLinesRef.current) cs.removePriceLine(line);
    srLinesRef.current = [];
    if (!overlays.sr) return;
    const price = display.bars[display.bars.length - 1].close;
    const { supports, resistances } = findLevels(display.bars, price);
    for (const r of resistances) {
      srLinesRef.current.push(
        cs.createPriceLine({
          price: r,
          color: "rgba(255, 77, 94, 0.5)",
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: false,
          title: "R",
        }),
      );
    }
    for (const s of supports) {
      srLinesRef.current.push(
        cs.createPriceLine({
          price: s,
          color: "rgba(20, 217, 138, 0.5)",
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: false,
          title: "S",
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srKey, timeframe, overlays.sr]);

  const toggle = (k: keyof OverlayState) => setOverlays((o) => ({ ...o, [k]: !o[k] }));

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <CandlestickChart className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {coin.pair} Chart
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["1m", "5m", "15m"] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors",
                  timeframe === tf ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
          {(
            [
              ["ema", "EMA"],
              ["vwap", "VWAP"],
              ["bb", "BB"],
              ["sr", "S/R"],
            ] as [keyof OverlayState, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-[10px] font-semibold transition-colors",
                overlays[k]
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div ref={containerRef} className="h-[320px] w-full sm:h-[380px]" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#22d3ee]" />EMA 9</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#a78bfa]" />EMA 20</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#f59e0b]" />EMA 50</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#e2e8f0]" />VWAP</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#fbbf24]" />Lock</span>
      </div>
    </section>
  );
}
