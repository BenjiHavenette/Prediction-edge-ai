import { Activity, Crosshair, Locate, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "@/components/bits";
import { fmtPct, fmtSign, fmtTime, fmtUsd } from "@/lib/format";
import type { DurationStat, RegimeGroup, RegimeSegment } from "@/lib/regimeForecast";
import { cn } from "@/lib/utils";

/** Pixels per minute of tape at each zoom level. */
const ZOOM_LEVELS: number[] = [0.7, 1.4, 2.8, 5.6, 11.2];

const GROUP_META: Record<RegimeGroup, { label: string; text: string; border: string; bg: string }> = {
  trend: { label: "Trend", text: "text-up", border: "border-up/40", bg: "bg-up/10" },
  chop: { label: "Chop", text: "text-warn", border: "border-warn/40", bg: "bg-warn/10" },
  storm: { label: "Storm", text: "text-fuchsia-400", border: "border-fuchsia-500/40", bg: "bg-fuchsia-500/10" },
};

const segBar = (s: RegimeSegment): string =>
  s.group === "chop" ? "bg-warn" : s.group === "storm" ? "bg-fuchsia-500" : s.kind === "trend-down" ? "bg-down" : "bg-up";

const segName = (s: RegimeSegment): string =>
  s.group === "chop" ? "Chop" : s.group === "storm" ? "Storm" : s.kind === "trend-up" ? "Uptrend" : "Downtrend";

const segText = (s: RegimeSegment): string =>
  s.group === "chop" ? "text-warn" : s.group === "storm" ? "text-fuchsia-400" : s.kind === "trend-down" ? "text-down" : "text-up";

const fmtDur = (min: number): string => {
  const totalSec = Math.max(0, Math.round(min * 60));
  if (totalSec >= 5400) return `${(totalSec / 3600).toFixed(1)}h`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

const fmtShort = (min: number): string => (min >= 90 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`);

const verdictOf = (s: RegimeSegment): string => {
  if (s.group === "trend") {
    return `Bettable tape — direction carried with ${(s.avgEfficiency * 100).toFixed(0)}% average path efficiency. Stretches like this are the only window the Entry Advisor bets in.`;
  }
  if (s.group === "storm") {
    return "Violent but directionless — big candles both ways with no follow-through. Betting inside a block like this is gambling, not edge.";
  }
  return "Coin-flip tape — price backtracked more than it traveled, so 5-minute closes inside this block were decided by noise.";
};

interface RegimeTimelineProps {
  timeline: RegimeSegment[];
  stats: DurationStat[];
}

/**
 * Scrollable, zoomable regime history strip. Every block is tappable and opens
 * an analysis card: duration vs historical norms, price move, efficiency, SNR.
 */
export default function RegimeTimeline({ timeline, stats }: RegimeTimelineProps) {
  const [zoomIdx, setZoomIdx] = useState<number>(2);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingCenterMin = useRef<number | null>(null);
  const didInitScroll = useRef<boolean>(false);

  const pxPerMin = ZOOM_LEVELS[zoomIdx];
  const startMs = timeline.length > 0 ? timeline[0].start : 0;
  const totalMin = useMemo(() => timeline.reduce((s, x) => s + x.minutes, 0), [timeline]);
  const stripWidth = Math.max(1, totalMin * pxPerMin);
  const selected = selectedStart !== null ? timeline.find((s) => s.start === selectedStart) ?? null : null;

  // Hour/half-hour ticks spaced at least ~72px apart at the current zoom.
  const ticks = useMemo(() => {
    if (timeline.length === 0) return [] as number[];
    const candidates = [15, 30, 60, 120, 240, 480];
    const intervalMin = candidates.find((c) => c * pxPerMin >= 72) ?? 480;
    const step = intervalMin * 60_000;
    const endMs = startMs + totalMin * 60_000;
    const out: number[] = [];
    for (let t = Math.ceil(startMs / step) * step; t < endMs; t += step) out.push(t);
    return out;
  }, [timeline.length, startMs, totalMin, pxPerMin]);

  const scrollToNow = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, []);

  // Start anchored at "now" (right edge) once data arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !didInitScroll.current && timeline.length > 0) {
      el.scrollLeft = el.scrollWidth;
      didInitScroll.current = true;
    }
  }, [timeline.length]);

  // Preserve the visible center of the tape when zoom changes.
  const changeZoom = useCallback(
    (next: number) => {
      const el = scrollRef.current;
      if (el) pendingCenterMin.current = (el.scrollLeft + el.clientWidth / 2) / pxPerMin;
      setZoomIdx(next);
    },
    [pxPerMin],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pendingCenterMin.current !== null) {
      el.scrollLeft = Math.max(0, pendingCenterMin.current * pxPerMin - el.clientWidth / 2);
      pendingCenterMin.current = null;
    }
  }, [pxPerMin]);

  if (timeline.length === 0) return null;

  const groupStat = selected ? stats.find((s) => s.group === selected.group) ?? null : null;
  const priceDelta = selected ? selected.closePrice - selected.openPrice : 0;
  const pricePct = selected && selected.openPrice > 0 ? (priceDelta / selected.openPrice) * 100 : 0;
  const medianRatio = selected && groupStat && groupStat.medianMin > 0 ? selected.minutes / groupStat.medianMin : null;

  return (
    <Panel
      title={`Regime timeline — ${fmtShort(totalMin)} of tape`}
      icon={Activity}
      right={
        <div className="flex items-center gap-1.5">
          <span className="hidden font-mono text-[10px] text-muted-foreground tnum sm:inline">
            {timeline.length} blocks
          </span>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoomIdx === 0}
            onClick={() => changeZoom(zoomIdx - 1)}
            className="rounded-md border border-border bg-secondary/60 p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            onClick={() => changeZoom(zoomIdx + 1)}
            className="rounded-md border border-border bg-secondary/60 p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={scrollToNow}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/60 px-1.5 py-1 font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:text-foreground"
          >
            <Locate className="h-3 w-3" /> Now
          </button>
        </div>
      }
    >
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain pb-1">
        <div className="relative w-max" style={{ width: `${stripWidth}px` }}>
          <div className="flex h-12 overflow-hidden rounded-md">
            {timeline.map((s) => {
              const isSel = s.start === selectedStart;
              return (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => setSelectedStart(isSel ? null : s.start)}
                  className={cn(
                    "h-full shrink-0 border-r border-background/60 transition-[filter,opacity]",
                    segBar(s),
                    s.ongoing && "animate-pulse",
                    isSel
                      ? "opacity-100 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.9)]"
                      : "opacity-80 hover:opacity-100 hover:brightness-110",
                  )}
                  style={{ width: `${Math.max(2, s.minutes * pxPerMin)}px` }}
                  title={`${segName(s)} · ${fmtShort(s.minutes)} · from ${fmtTime(s.start)}`}
                />
              );
            })}
          </div>
          {/* Time grid over the strip */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full w-px bg-background/50"
                style={{ left: `${((t - startMs) / 60_000) * pxPerMin}px` }}
              />
            ))}
          </div>
          {/* Time axis */}
          <div className="relative mt-1 h-4">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-muted-foreground tnum"
                style={{ left: `${((t - startMs) / 60_000) * pxPerMin}px` }}
              >
                {fmtTime(t)}
              </span>
            ))}
            <span className="absolute right-0 top-0 font-mono text-[9px] font-semibold text-primary">now</span>
          </div>
        </div>
      </div>

      {/* Analysis card for the selected block */}
      {selected ? (
        <div className={cn("mt-3 rounded-lg border p-3", GROUP_META[selected.group].border, GROUP_META[selected.group].bg)}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-sm", segBar(selected))} />
              <span className={cn("font-display text-xs font-bold uppercase tracking-wider", segText(selected))}>
                {segName(selected)}
                {selected.ongoing && <span className="ml-1.5 animate-pulse font-mono text-[9px] text-primary">● LIVE</span>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground tnum">
                {fmtTime(selected.start)} → {selected.ongoing ? "now" : fmtTime(selected.end)}
              </span>
              <button
                type="button"
                aria-label="Close analysis"
                onClick={() => setSelectedStart(null)}
                className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">duration</div>
              <div className="font-mono text-xs font-semibold tnum">{fmtDur(selected.minutes)}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">vs median {GROUP_META[selected.group].label.toLowerCase()}</div>
              <div className="font-mono text-xs font-semibold tnum">
                {medianRatio !== null ? `${medianRatio.toFixed(1)}× (${fmtShort(groupStat?.medianMin ?? 0)})` : "—"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">price move</div>
              <div className={cn("font-mono text-xs font-semibold tnum", priceDelta >= 0 ? "text-up" : "text-down")}>
                {fmtSign(priceDelta)} ({fmtPct(pricePct)})
              </div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">from → to</div>
              <div className="font-mono text-xs font-semibold tnum">
                {fmtUsd(selected.openPrice, 0)} → {fmtUsd(selected.closePrice, 0)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">avg efficiency</div>
              <div className="font-mono text-xs font-semibold tnum">{(selected.avgEfficiency * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">avg signal/noise</div>
              <div className="font-mono text-xs font-semibold tnum">{selected.avgSnr.toFixed(2)}</div>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-foreground/85">{verdictOf(selected)}</p>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <Crosshair className="h-3 w-3" /> Scroll the tape and tap any block to analyze it
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-up" /> Trend up</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-down" /> Trend down</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warn" /> Chop</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-fuchsia-500" /> Storm</span>
      </div>
    </Panel>
  );
}
