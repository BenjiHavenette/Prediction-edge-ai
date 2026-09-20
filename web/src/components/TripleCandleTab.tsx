import { Activity, Brain, CandlestickChart, GitCompareArrows, History, ListChecks, Radar, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DirBadge, Panel, ScoreBar, StatRow, dirTextClass } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { fmtPct, fmtTime, fmtUsd } from "@/lib/format";
import { stepPredictor } from "@/lib/candlePredictor";
import type { C4Prediction, PredictorSnapshot } from "@/lib/candlePredictor";
import { analyzeTrio } from "@/lib/tripleCandle";
import type { CandleAnatomy, PairLink, TrioAnalysis, TrioTimeframe } from "@/lib/tripleCandle";
import type { Candle } from "@/lib/types";
import { cn } from "@/lib/utils";

const UP_COLOR = "#14d98a";
const DOWN_COLOR = "#ff4d5e";
const DOJI_COLOR = "#fbbf24";

const candleColor = (dir: CandleAnatomy["dir"]): string =>
  dir === "green" ? UP_COLOR : dir === "red" ? DOWN_COLOR : DOJI_COLOR;

const corrTone = (v: number): string => (v >= 25 ? "text-up" : v <= -25 ? "text-down" : "text-warn");

/** Ghost candle drawn for the ML forecast of the 4th bar. */
interface GhostForecast {
  candle: Candle;
  dir: "up" | "down";
  probUp: number;
}

/** Big SVG rendering of the 3 candles (plus ML ghost C4) with OHLC scale and annotations. */
function TrioChart({
  analysis,
  live,
  forecast,
}: {
  analysis: TrioAnalysis;
  live: boolean;
  forecast?: GhostForecast | null;
}) {
  const W = 640;
  const H = 320;
  const PAD_T = 30;
  const PAD_B = 40;
  const PAD_L = 16;
  const PAD_R = 74;

  const trio = analysis.candles;
  let hi = -Infinity;
  let lo = Infinity;
  for (const a of trio) {
    hi = Math.max(hi, a.candle.high);
    lo = Math.min(lo, a.candle.low);
  }
  if (forecast) {
    hi = Math.max(hi, forecast.candle.high);
    lo = Math.min(lo, forecast.candle.low);
  }
  const span = Math.max(hi - lo, 0.0001);
  hi += span * 0.06;
  lo -= span * 0.06;
  const y = (price: number): number => PAD_T + ((hi - price) / (hi - lo)) * (H - PAD_T - PAD_B);

  const slots = forecast ? 4 : 3;
  const slotW = (W - PAD_L - PAD_R) / slots;
  const cx = (i: number): number => PAD_L + slotW * (i + 0.5);
  const bodyW = Math.min(72, slotW * 0.44);

  const gridLevels = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Last 3 candles">
      {gridLevels.map((p) => (
        <g key={p}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(p)} y2={y(p)} stroke="rgba(120,132,160,0.12)" strokeDasharray="3 5" />
          <text x={W - PAD_R + 6} y={y(p) + 3} fill="#77809a" fontSize={9} fontFamily="'IBM Plex Mono', monospace">
            {fmtUsd(p, 0)}
          </text>
        </g>
      ))}

      {trio.map((a, i) => {
        const c = a.candle;
        const color = candleColor(a.dir);
        const x = cx(i);
        const bodyTop = y(Math.max(c.open, c.close));
        const bodyBot = y(Math.min(c.open, c.close));
        const isLast = i === 2;
        const forming = live && isLast;
        return (
          <g key={c.time} opacity={forming ? 0.92 : 1}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={2} />
            <rect
              x={x - bodyW / 2}
              y={bodyTop}
              width={bodyW}
              height={Math.max(2, bodyBot - bodyTop)}
              rx={3}
              fill={color}
              fillOpacity={forming ? 0.55 : 0.9}
              stroke={color}
              strokeDasharray={forming ? "4 3" : undefined}
            />
            <text
              x={x}
              y={y(c.high) - 8}
              textAnchor="middle"
              fill={color}
              fontSize={10}
              fontWeight={700}
              fontFamily="'IBM Plex Mono', monospace"
            >
              {fmtPct(a.returnPct, 2)}
            </text>
            <text
              x={x}
              y={H - PAD_B + 16}
              textAnchor="middle"
              fill="#e2e8f0"
              fontSize={10}
              fontWeight={700}
              fontFamily="'IBM Plex Mono', monospace"
            >
              C{i + 1}
              {forming ? " · LIVE" : ""}
            </text>
            <text
              x={x}
              y={H - PAD_B + 29}
              textAnchor="middle"
              fill="#77809a"
              fontSize={9}
              fontFamily="'IBM Plex Mono', monospace"
            >
              {fmtTime(c.time)}
            </text>
          </g>
        );
      })}

      {forecast &&
        (() => {
          const c = forecast.candle;
          const color = forecast.dir === "up" ? UP_COLOR : DOWN_COLOR;
          const x = cx(3);
          const bodyTop = y(Math.max(c.open, c.close));
          const bodyBot = y(Math.min(c.open, c.close));
          return (
            <g opacity={0.85}>
              <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={2} strokeDasharray="3 4" />
              <rect
                x={x - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={Math.max(2, bodyBot - bodyTop)}
                rx={3}
                fill={color}
                fillOpacity={0.18}
                stroke={color}
                strokeDasharray="5 3"
              />
              <text
                x={x}
                y={y(c.high) - 8}
                textAnchor="middle"
                fill={color}
                fontSize={10}
                fontWeight={700}
                fontFamily="'IBM Plex Mono', monospace"
              >
                {forecast.dir === "up" ? forecast.probUp.toFixed(0) : (100 - forecast.probUp).toFixed(0)}%{" "}
                {forecast.dir === "up" ? "▲" : "▼"}
              </text>
              <text
                x={x}
                y={H - PAD_B + 16}
                textAnchor="middle"
                fill={color}
                fontSize={10}
                fontWeight={700}
                fontFamily="'IBM Plex Mono', monospace"
              >
                C4 · AI
              </text>
              <text
                x={x}
                y={H - PAD_B + 29}
                textAnchor="middle"
                fill="#77809a"
                fontSize={9}
                fontFamily="'IBM Plex Mono', monospace"
              >
                {fmtTime(c.time)}
              </text>
            </g>
          );
        })()}

      {analysis.links.slice(0, 2).map((link) => {
        const x1 = cx(link.from);
        const x2 = cx(link.to);
        const mid = (x1 + x2) / 2;
        return (
          <g key={`${link.from}-${link.to}`}>
            <path
              d={`M ${x1} ${PAD_T - 10} Q ${mid} ${PAD_T - 26} ${x2} ${PAD_T - 10}`}
              fill="none"
              stroke={link.correlation >= 25 ? UP_COLOR : link.correlation <= -25 ? DOWN_COLOR : DOJI_COLOR}
              strokeOpacity={0.55}
              strokeWidth={1.5}
            />
            <text
              x={mid}
              y={PAD_T - 15}
              textAnchor="middle"
              fill={link.correlation >= 25 ? UP_COLOR : link.correlation <= -25 ? DOWN_COLOR : DOJI_COLOR}
              fontSize={9}
              fontWeight={700}
              fontFamily="'IBM Plex Mono', monospace"
            >
              {link.correlation > 0 ? "+" : ""}
              {link.correlation}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AnatomyCard({ a, live }: { a: CandleAnatomy; live: boolean }) {
  const color = candleColor(a.dir);
  return (
    <div className="rounded-xl border border-border bg-card/80 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-[11px] font-bold tracking-widest" style={{ color }}>
          C{a.index + 1} · {a.dir.toUpperCase()}
          {live && a.index === 2 ? " (LIVE)" : ""}
        </span>
        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
          {a.role}
        </span>
      </div>
      <StatRow label="Move" value={fmtPct(a.returnPct, 2)} valueClass={a.returnPct >= 0 ? "text-up" : "text-down"} />
      <StatRow label="Body" value={`${(a.bodyRatio * 100).toFixed(0)}% of range`} />
      <StatRow
        label="Wicks"
        value={`▲${(a.upperWickRatio * 100).toFixed(0)}% ▼${(a.lowerWickRatio * 100).toFixed(0)}%`}
      />
      <StatRow
        label="Range vs ATR"
        value={`${a.rangeVsAtr.toFixed(2)}x`}
        valueClass={a.rangeVsAtr >= 1.4 ? "text-warn" : undefined}
      />
      <StatRow
        label="Volume"
        value={`${a.volumeRel.toFixed(2)}x avg`}
        valueClass={a.volumeRel >= 1.5 ? "text-primary" : undefined}
      />
      <StatRow label="Close in range" value={`${(a.closePosition * 100).toFixed(0)}%`} />
    </div>
  );
}

function LinkRow({ link }: { link: PairLink }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-foreground">
            C{link.from + 1} ↔ C{link.to + 1}
          </span>
          <span className={cn("text-[11px] font-semibold", dirTextClass(link.direction))}>{link.label}</span>
        </div>
        <span className={cn("font-mono text-xs font-bold tnum", corrTone(link.correlation))}>
          {link.correlation > 0 ? "+" : ""}
          {link.correlation}%
        </span>
      </div>
      <div className="mt-1.5">
        <ScoreBar value={link.correlation} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
        <span>overlap {link.overlapPct}%</span>
        <span>body {link.bodyDelta >= 1 ? `${link.bodyDelta.toFixed(1)}x` : `${(link.bodyDelta * 100).toFixed(0)}%`}</span>
      </div>
      {link.notes.length > 0 && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{link.notes.join(" · ")}</p>
      )}
    </div>
  );
}

const tierLabel = (t: C4Prediction["tier"]): string =>
  t === "high" ? "HIGH CONVICTION" : t === "medium" ? "MODERATE" : "LOW EDGE";

function LogRow({ rec }: { rec: C4Prediction }) {
  const dirColor = rec.dir === "up" ? "text-up" : "text-down";
  let result: { label: string; cls: string };
  if (!rec.actual) result = { label: "PENDING", cls: "text-warn" };
  else if (rec.actual.correct === null) result = { label: "FLAT", cls: "text-muted-foreground" };
  else if (rec.actual.correct) result = { label: "✓ HIT", cls: "text-up" };
  else result = { label: "✗ MISS", cls: "text-down" };

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground">{fmtTime(rec.barTime)}</span>
        <span className={cn("font-mono text-[10px] font-bold", dirColor)}>
          {rec.dir === "up" ? "▲ UP" : "▼ DOWN"}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {(rec.dir === "up" ? rec.probUp : 100 - rec.probUp).toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        {rec.actual && rec.actual.correct !== null && (
          <span className={cn("font-mono text-[9px]", rec.actual.returnPct >= 0 ? "text-up" : "text-down")}>
            {fmtPct(rec.actual.returnPct, 2)}
          </span>
        )}
        <span className={cn("font-mono text-[10px] font-bold", result.cls)}>{result.label}</span>
      </div>
    </div>
  );
}

/** 3-Candle Analyzer tab: the last 3 candles, their shape correlation, and the pattern's historical echo. */
export default function TripleCandleTab() {
  const { candles, coin } = useMarket();
  const [timeframe, setTimeframe] = useState<TrioTimeframe>("5m");
  const [includeForming, setIncludeForming] = useState<boolean>(true);

  const analysis = useMemo(
    () => analyzeTrio(candles, timeframe, includeForming),
    [candles, timeframe, includeForming],
  );

  const [ml, setMl] = useState<PredictorSnapshot | null>(null);
  useEffect(() => {
    setMl(stepPredictor(coin.storageSuffix, timeframe, candles));
  }, [candles, coin.storageSuffix, timeframe]);

  const ghost = useMemo<GhostForecast | null>(() => {
    const p = ml?.prediction;
    if (!p || includeForming || !analysis) return null;
    const lastClose = analysis.candles[2].candle.close;
    if (lastClose <= 0) return null;
    const open = lastClose;
    const close = open * (1 + p.expectedMovePct / 100);
    const rangeAbs = open * (p.expectedRangePct / 100);
    const body = Math.abs(close - open);
    const extra = Math.max(0, rangeAbs - body) / 2;
    return {
      candle: {
        time: p.barTime,
        open,
        high: Math.max(open, close) + extra,
        low: Math.min(open, close) - extra,
        close,
        volume: 0,
      },
      dir: p.dir,
      probUp: p.probUp,
    };
  }, [ml, includeForming, analysis]);

  if (!analysis) {
    return (
      <Panel title="3-Candle Analyzer" icon={CandlestickChart}>
        <p className="text-xs text-muted-foreground">Not enough candle history on this timeframe yet — hold on.</p>
      </Panel>
    );
  }

  const biasLabel = analysis.bias === "bull" ? "LEANING UP" : analysis.bias === "bear" ? "LEANING DOWN" : "NO EDGE";

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-7">
        <section className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <CandlestickChart className="h-3.5 w-3.5 text-primary" />
              <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Last 3 Candles · {coin.pair}
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex overflow-hidden rounded-md border border-border">
                {(["1m", "5m", "15m"] as TrioTimeframe[]).map((tf) => (
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
              <button
                onClick={() => setIncludeForming((v) => !v)}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[10px] font-semibold transition-colors",
                  includeForming
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {includeForming ? "LIVE BAR" : "CLOSED"}
              </button>
            </div>
          </header>
          <div className="px-2 pt-2">
            <TrioChart analysis={analysis} live={includeForming} forecast={ghost} />
          </div>
          <p className="border-t border-border/60 px-4 py-2 font-mono text-[10px] text-muted-foreground">
            Arcs show shape correlation between adjacent candles: +100% identical, −100% mirror opposites.
            {!includeForming && ghost ? " Dashed C4 is the machine-learning forecast of the next candle." : ""}
            {includeForming && ml?.prediction ? " Switch to CLOSED to see the AI's ghost forecast of the 4th candle." : ""}
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          {analysis.candles.map((a) => (
            <AnatomyCard key={a.candle.time} a={a} live={includeForming} />
          ))}
        </div>
      </div>

      <div className="space-y-3 lg:col-span-5">
        <Panel
          title="4th Candle Forecast · ML"
          icon={Brain}
          right={
            ml?.prediction ? (
              <DirBadge
                direction={ml.prediction.dir === "up" ? "bull" : "bear"}
                label={ml.prediction.dir === "up" ? "PREDICT UP" : "PREDICT DOWN"}
              />
            ) : undefined
          }
        >
          {!ml || !ml.prediction ? (
            <p className="text-xs text-muted-foreground">Warming up — the model needs a little more candle history.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  P(green) · {tierLabel(ml.prediction.tier)}
                </span>
                <span
                  className={cn(
                    "font-mono text-sm font-bold tnum",
                    ml.prediction.probUp >= 50 ? "text-up" : "text-down",
                  )}
                >
                  {ml.prediction.probUp.toFixed(1)}%
                </span>
              </div>
              <ScoreBar value={(ml.prediction.probUp - 50) * 2} />
              <div className="mt-3 space-y-0.5">
                <StatRow label="Predicting bar" value={`${fmtTime(ml.prediction.barTime)} · ${timeframe.toUpperCase()}`} />
                <StatRow
                  label="Expected move"
                  value={fmtPct(ml.prediction.expectedMovePct, 3)}
                  valueClass={ml.prediction.expectedMovePct >= 0 ? "text-up" : "text-down"}
                />
                <StatRow label="Samples learned" value={`${ml.trained.toLocaleString()}`} />
                <StatRow
                  label="Model accuracy (all)"
                  value={ml.wfAccuracy === null ? "—" : `${ml.wfAccuracy.toFixed(1)}%`}
                  valueClass={ml.wfAccuracy !== null && ml.wfAccuracy >= 55 ? "text-up" : undefined}
                />
                <StatRow
                  label="Last 30 bars"
                  value={ml.recentAccuracy === null ? "—" : `${ml.recentAccuracy.toFixed(0)}%`}
                  valueClass={
                    ml.recentAccuracy === null ? undefined : ml.recentAccuracy >= 55 ? "text-up" : ml.recentAccuracy < 45 ? "text-down" : undefined
                  }
                />
              </div>
              {ml.topSignals.length > 0 && (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Strongest synapses</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ml.topSignals.map((s) => (
                      <span
                        key={s.name}
                        className={cn(
                          "rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px]",
                          s.weight >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {s.name} {s.weight >= 0 ? "+" : ""}
                        {s.weight.toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Panel>

        <Panel title="Sequence Verdict" icon={Sparkles} right={<DirBadge direction={analysis.bias} label={biasLabel} />}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Bias Score</span>
            <span className={cn("font-mono text-sm font-bold tnum", dirTextClass(analysis.bias))}>
              {analysis.biasScore > 0 ? "+" : ""}
              {analysis.biasScore}
            </span>
          </div>
          <ScoreBar value={analysis.biasScore} />
          <p className="mt-3 text-xs leading-relaxed text-foreground/90">{analysis.verdict}</p>
        </Panel>

        <Panel title="Candle Correlation" icon={GitCompareArrows}>
          <div className="space-y-2">
            {analysis.links.map((link) => (
              <LinkRow key={`${link.from}-${link.to}`} link={link} />
            ))}
          </div>
        </Panel>

        <Panel title="Trio Patterns" icon={Radar}>
          {analysis.patterns.length === 0 ? (
            <p className="text-xs text-muted-foreground">No named 3-candle pattern in this sequence.</p>
          ) : (
            <div className="space-y-2.5">
              {analysis.patterns.map((p) => (
                <div key={p.name}>
                  <DirBadge direction={p.direction} label={p.name} />
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.description}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Historical Echo" icon={History}>
          {analysis.echo === null ? (
            <p className="text-xs text-muted-foreground">
              Not enough prior occurrences of this exact 3-candle signature in the loaded history.
            </p>
          ) : (
            <>
              <StatRow
                label="Precedents"
                value={`${analysis.echo.matches} (${analysis.echo.strict ? "strict" : "loose"} match)`}
              />
              <StatRow
                label="Next candle green"
                value={`${analysis.echo.nextUpPct.toFixed(0)}%`}
                valueClass={analysis.echo.nextUpPct >= 56 ? "text-up" : undefined}
              />
              <StatRow
                label="Next candle red"
                value={`${analysis.echo.nextDownPct.toFixed(0)}%`}
                valueClass={analysis.echo.nextDownPct >= 56 ? "text-down" : undefined}
              />
              <StatRow
                label="Avg next move"
                value={fmtPct(analysis.echo.avgNextMovePct, 3)}
                valueClass={analysis.echo.avgNextMovePct >= 0 ? "text-up" : "text-down"}
              />
              <div className="mt-2 border-t border-border/60 pt-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-3 w-3 text-primary" />
                  <span className="text-[10px] leading-relaxed text-muted-foreground">
                    Same direction sequence{analysis.echo.strict ? " + similar candle sizes" : ""} scanned across the
                    loaded {timeframe.toUpperCase()} history; measures what the 4th candle did.
                  </span>
                </div>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Forecast Log · Learning" icon={ListChecks}>
          {!ml || ml.log.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No forecasts logged yet — every predicted 4th candle will be recorded and graded here.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Live log hit rate</span>
                <span
                  className={cn(
                    "font-mono text-sm font-bold tnum",
                    ml.liveResolved >= 5 && ml.liveCorrect / ml.liveResolved >= 0.55
                      ? "text-up"
                      : ml.liveResolved >= 5 && ml.liveCorrect / ml.liveResolved < 0.45
                        ? "text-down"
                        : "text-foreground",
                  )}
                >
                  {ml.liveResolved === 0
                    ? "—"
                    : `${((ml.liveCorrect / ml.liveResolved) * 100).toFixed(0)}% (${ml.liveCorrect}/${ml.liveResolved})`}
                </span>
              </div>
              <div className="space-y-1.5">
                {ml.log.slice(0, 10).map((rec) => (
                  <LogRow key={rec.barTime} rec={rec} />
                ))}
              </div>
              <div className="mt-2.5 border-t border-border/60 pt-2">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Accuracy by conviction
                </span>
                <div className="mt-1 space-y-0.5">
                  {ml.buckets
                    .filter((b) => b.total > 0)
                    .map((b) => (
                      <StatRow
                        key={b.label}
                        label={b.label}
                        value={`${((b.correct / b.total) * 100).toFixed(0)}% of ${b.total}`}
                        valueClass={b.correct / b.total >= 0.55 ? "text-up" : b.correct / b.total < 0.45 ? "text-down" : undefined}
                      />
                    ))}
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                The model retrains itself on every closed {timeframe.toUpperCase()} candle — misses reshape its weights,
                so conviction tiers get sharper as the log grows.
              </p>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
