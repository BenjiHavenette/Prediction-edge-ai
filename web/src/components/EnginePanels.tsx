import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  Bot,
  CandlestickChart,
  Crosshair,
  Gauge,
  Layers,
  LineChart,
  Orbit,
  Radar,
  Waves,
} from "lucide-react";

import { DirBadge, MiniBar, Panel, ScoreBar, SignalRow, StatRow, dirTextClass } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { fetchGlobalMarket } from "@/lib/binance";
import { fmtCompact, fmtPct, fmtSign, fmtTime, fmtUsd } from "@/lib/format";
import type { Analysis } from "@/lib/types";
import { cn } from "@/lib/utils";

function useAnalysis(): Analysis | null {
  return useMarket().analysis;
}

export function PriceActionPanel() {
  const a = useAnalysis();
  if (!a) return null;
  const run = a.consecGreen >= a.consecRed ? a.consecGreen : a.consecRed;
  const runColor = a.consecGreen >= a.consecRed ? "green" : "red";
  return (
    <Panel title="Price Action Engine" icon={CandlestickChart}>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex gap-1">
          {Array.from({ length: Math.min(run, 6) }).map((_, i) => (
            <span
              key={i}
              className={cn("h-4 w-2 rounded-sm", runColor === "green" ? "bg-up" : "bg-down")}
            />
          ))}
          {run === 0 && <span className="h-4 w-2 rounded-sm bg-warn" />}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {run > 0 ? `${run} consecutive ${runColor}` : "No streak"}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between font-mono text-[10px]">
            <span className="text-up">BULLISH SCORE {a.priceAction.bullScore}</span>
          </div>
          <MiniBar value={a.priceAction.bullScore} tone="up" />
        </div>
        <div>
          <div className="mb-1 flex justify-between font-mono text-[10px]">
            <span className="text-down">BEARISH SCORE {a.priceAction.bearScore}</span>
          </div>
          <MiniBar value={a.priceAction.bearScore} tone="down" />
        </div>
      </div>
      <div className="mt-3 border-t border-border/60 pt-2">
        {a.priceAction.signals.length > 0 ? (
          a.priceAction.signals.map((s, i) => <SignalRow key={`${s.label}-${i}`} signal={s} />)
        ) : (
          <p className="py-1 text-xs text-muted-foreground">No candlestick patterns on the last closed bar.</p>
        )}
      </div>
    </Panel>
  );
}

export function VolumePanel() {
  const { coin } = useMarket();
  const a = useAnalysis();
  if (!a) return null;
  const v = a.volume;
  return (
    <Panel
      title="Volume Analysis"
      icon={BarChart3}
      right={v.spike ? <DirBadge direction={a.candleDirection === "green" ? "bull" : "bear"} label="Spike" /> : undefined}
    >
      <StatRow label="Current Volume" value={`${v.current.toFixed(1)} ${coin.id}`} />
      <StatRow label="Average (20)" value={`${v.average.toFixed(1)} ${coin.id}`} />
      <StatRow
        label="Relative Volume"
        value={`${v.relative.toFixed(2)}x`}
        valueClass={v.relative >= 1.5 ? "text-warn" : undefined}
      />
      <div className="my-3">
        <div className="mb-1 flex justify-between font-mono text-[10px]">
          <span className="text-up tnum">BUY {v.bullPressure.toFixed(0)}%</span>
          <span className="text-down tnum">SELL {v.bearPressure.toFixed(0)}%</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
          <div className="bg-up transition-all duration-500" style={{ width: `${v.bullPressure}%` }} />
          <div className="flex-1 bg-down transition-all duration-500" />
        </div>
      </div>
      <div className="border-t border-border/60 pt-2">
        {v.signals.map((s, i) => (
          <SignalRow key={`${s.label}-${i}`} signal={s} />
        ))}
      </div>
    </Panel>
  );
}

export function TrendPanel() {
  const a = useAnalysis();
  if (!a) return null;
  const t = a.trend;
  const rows: [string, number][] = [
    ["EMA 9", t.ema9],
    ["EMA 20", t.ema20],
    ["EMA 50", t.ema50],
    ["EMA 200", t.ema200],
  ];
  return (
    <Panel
      title="Trend Analysis"
      icon={LineChart}
      right={
        t.cross ? (
          <DirBadge direction={t.cross === "golden" ? "bull" : "bear"} label={t.cross === "golden" ? "Golden Cross" : "Death Cross"} />
        ) : undefined
      }
    >
      {rows.map(([label, value]) => {
        const above = a.price > value;
        return (
          <StatRow
            key={label}
            label={label}
            value={
              <span className="flex items-center gap-2">
                <span>${fmtUsd(value)}</span>
                <span className={cn("text-[9px] font-bold", above ? "text-up" : "text-down")}>
                  {above ? "ABOVE" : "BELOW"}
                </span>
              </span>
            }
          />
        );
      })}
      <div className="mt-2 border-t border-border/60 pt-3">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>TREND SCORE</span>
          <span className={cn("tnum", a.categories.trend >= 0 ? "text-up" : "text-down")}>{a.categories.trend}</span>
        </div>
        <ScoreBar value={a.categories.trend} />
        <div className="mt-2">
          {t.signals.map((s, i) => (
            <SignalRow key={`${s.label}-${i}`} signal={s} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function MomentumPanel() {
  const a = useAnalysis();
  if (!a) return null;
  const m = a.momentum;
  return (
    <Panel
      title="Momentum Analysis"
      icon={Gauge}
      right={
        <span className="font-mono text-[10px] text-muted-foreground">
          <span className="text-up tnum">{m.bullCount}▲</span> <span className="text-down tnum">{m.bearCount}▼</span>{" "}
          <span className="text-warn tnum">{m.neutralCount}◆</span>
        </span>
      }
    >
      <div className="mb-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>RSI (14)</span>
        <span className={cn("tnum", m.rsi >= 60 ? "text-up" : m.rsi <= 40 ? "text-down" : "text-foreground")}>
          {m.rsi.toFixed(1)}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-gradient-to-r from-down/50 via-secondary to-up/50">
        <div
          className="absolute top-0 h-full w-1 rounded-full bg-foreground transition-all duration-500"
          style={{ left: `calc(${Math.min(100, Math.max(0, m.rsi))}% - 2px)` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        <StatRow
          label="MACD Hist"
          value={m.macdHist.toFixed(2)}
          valueClass={m.macdHist >= 0 ? "text-up" : "text-down"}
        />
        <StatRow
          label="Stoch RSI"
          value={m.stochRsi.toFixed(0)}
          valueClass={m.stochRsi >= 80 ? "text-down" : m.stochRsi <= 20 ? "text-up" : undefined}
        />
      </div>
      <div className="mt-1 border-t border-border/60 pt-2">
        {m.signals.slice(0, 5).map((s, i) => (
          <SignalRow key={`${s.label}-${i}`} signal={s} />
        ))}
      </div>
    </Panel>
  );
}

export function VwapPanel() {
  const a = useAnalysis();
  if (!a) return null;
  const v = a.vwap;
  return (
    <Panel
      title="VWAP Analysis"
      icon={Crosshair}
      right={<DirBadge direction={v.bias} label={v.bias === "bull" ? "Bullish" : v.bias === "bear" ? "Bearish" : "Neutral"} />}
    >
      <StatRow label="Session VWAP" value={`$${fmtUsd(v.value)}`} />
      <StatRow
        label="Price Position"
        value={v.distancePct >= 0 ? "Above VWAP" : "Below VWAP"}
        valueClass={v.distancePct >= 0 ? "text-up" : "text-down"}
      />
      <StatRow
        label="Distance"
        value={fmtPct(v.distancePct, 3)}
        valueClass={v.distancePct >= 0 ? "text-up" : "text-down"}
      />
      <div className="mt-2 border-t border-border/60 pt-2">
        {v.signals.map((s, i) => (
          <SignalRow key={`${s.label}-${i}`} signal={s} />
        ))}
      </div>
    </Panel>
  );
}

export function BollingerPanel() {
  const a = useAnalysis();
  if (!a) return null;
  const bb = a.bollinger;
  const stateDir = bb.state === "expansion" ? "bull" : bb.state === "compression" ? "neutral" : "neutral";
  return (
    <Panel
      title="Bollinger Bands"
      icon={Waves}
      right={<DirBadge direction={stateDir} label={bb.state} />}
    >
      <StatRow label="Upper Band" value={`$${fmtUsd(bb.upper)}`} />
      <StatRow label="Middle Band" value={`$${fmtUsd(bb.middle)}`} />
      <StatRow label="Lower Band" value={`$${fmtUsd(bb.lower)}`} />
      <StatRow label="Band Width" value={`${bb.widthPct.toFixed(3)}%`} />
      <div className="mt-2 border-t border-border/60 pt-2">
        {bb.signals.map((s, i) => (
          <SignalRow key={`${s.label}-${i}`} signal={s} />
        ))}
      </div>
    </Panel>
  );
}

export function FifthDimensionPanel() {
  const a = useAnalysis();
  if (!a) return null;
  const f = a.fifth;
  const zPct = Math.min(100, Math.max(0, ((f.zScore + 3) / 6) * 100));
  const insideNoise = Math.abs(f.gap) < f.noiseFloor;
  return (
    <Panel
      title="Fifth Dimension Engine"
      icon={Orbit}
      right={
        f.coinFlip ? (
          <DirBadge direction="neutral" label="Coin-Flip Zone" />
        ) : (
          <DirBadge
            direction={f.gapProbUp >= 55 ? "bull" : f.gapProbUp <= 45 ? "bear" : "neutral"}
            label={`Close model ${f.gapProbUp.toFixed(0)}% UP`}
          />
        )
      }
    >
      <div className="mb-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>LOCK GAP Z-SCORE</span>
        <span className={cn("tnum", f.zScore >= 0.5 ? "text-up" : f.zScore <= -0.5 ? "text-down" : "text-warn")}>
          {f.zScore >= 0 ? "+" : ""}
          {f.zScore.toFixed(2)}σ
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-gradient-to-r from-down/50 via-secondary to-up/50">
        <div className="absolute inset-y-0 left-1/2 z-10 w-px bg-border" />
        <div
          className="absolute top-0 h-full w-1 rounded-full bg-foreground transition-all duration-500"
          style={{ left: `calc(${zPct}% - 2px)` }}
        />
      </div>
      <div className="mt-3">
        <StatRow label="Gap vs Lock" value={`$${fmtSign(f.gap)}`} valueClass={f.gap >= 0 ? "text-up" : "text-down"} />
        <StatRow
          label="Noise Floor"
          value={`±$${f.noiseFloor.toFixed(2)}`}
          valueClass={insideNoise ? "text-warn" : undefined}
        />
        <StatRow label="Remaining Volatility (1σ)" value={`±$${f.sigmaRemaining.toFixed(2)}`} />
        <StatRow label="Gap share of signal" value={`${Math.round(f.blendWeight * 100)}%`} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">UP Side</div>
          <div className="font-mono text-sm font-bold text-up tnum">
            {f.payoutUp !== null ? `${f.payoutUp.toFixed(2)}x` : "~1.95x"}
          </div>
          <div className={cn("font-mono text-[10px] tnum", f.evUp > 0 ? "text-up" : "text-down")}>
            EV {fmtPct(f.evUp * 100, 1)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">DOWN Side</div>
          <div className="font-mono text-sm font-bold text-down tnum">
            {f.payoutDown !== null ? `${f.payoutDown.toFixed(2)}x` : "~1.95x"}
          </div>
          <div className={cn("font-mono text-[10px] tnum", f.evDown > 0 ? "text-up" : "text-down")}>
            EV {fmtPct(f.evDown * 100, 1)}
          </div>
        </div>
      </div>
      {f.crowd && (
        <div className="mt-2">
          <DirBadge
            direction="neutral"
            label={
              f.crowd === "balanced"
                ? "Pools balanced"
                : f.crowd === "down-heavy"
                  ? "Crowd heavy on DOWN"
                  : "Crowd heavy on UP"
            }
          />
        </div>
      )}
      <div className="mt-2 border-t border-border/60 pt-2">
        {f.signals.map((s, i) => (
          <SignalRow key={`${s.label}-${i}`} signal={s} />
        ))}
        <p className={cn("mt-1.5 text-xs font-medium leading-relaxed", f.coinFlip ? "text-warn" : "text-foreground/90")}>
          <span className="mr-1 text-primary">◍</span>
          {f.verdict}
        </p>
      </div>
    </Panel>
  );
}

export function SmcPanel() {
  const a = useAnalysis();
  if (!a) return null;
  return (
    <Panel title="Smart Money Concepts" icon={Radar}>
      {a.smc.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No liquidity sweeps, traps or manipulation candles detected on recent bars.
        </p>
      ) : (
        <div className="space-y-2">
          {a.smc.map((e, i) => (
            <div
              key={`${e.type}-${i}`}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium",
                e.direction === "bull" ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down",
              )}
            >
              {e.label}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const corrLabel = (v: number): string => {
  const strength = Math.abs(v) >= 0.7 ? "Strong" : Math.abs(v) >= 0.4 ? "Moderate" : Math.abs(v) >= 0.15 ? "Weak" : "No";
  return `${strength} ${v >= 0.15 ? "Positive" : v <= -0.15 ? "Negative" : "Correlation"}`.replace("No Correlation", "No correlation");
};

export function CorrelationPanel() {
  const { correlation } = useMarket();
  const { data: global } = useQuery({
    queryKey: ["global-market"],
    queryFn: fetchGlobalMarket,
    refetchInterval: 60000,
    staleTime: 55000,
    retry: 1,
  });
  const rows: [string, number][] = correlation.pairs.map((p) => [p.label, p.value]);
  return (
    <Panel title="Correlation Dashboard" icon={Layers}>
      <div className="space-y-3">
        {rows.map(([label, v]) => (
          <div key={label}>
            <div className="mb-1 flex justify-between font-mono text-[10px]">
              <span className="text-muted-foreground">{label} · 60m returns</span>
              <span className={cn("tnum", v >= 0.15 ? "text-up" : v <= -0.15 ? "text-down" : "text-warn")}>
                {v.toFixed(2)} · {corrLabel(v)}
              </span>
            </div>
            <ScoreBar value={v * 100} />
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Market Cap</div>
          <div className="font-mono text-sm font-bold tnum">
            {global ? `$${fmtCompact(global.totalMarketCap)}` : "—"}
          </div>
          {global && (
            <div className={cn("font-mono text-[10px] tnum", global.marketCapChange24h >= 0 ? "text-up" : "text-down")}>
              {fmtPct(global.marketCapChange24h)} 24h · tracks BTC
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">USDT Dominance</div>
          <div className="font-mono text-sm font-bold tnum">{global ? `${global.usdtDominance.toFixed(2)}%` : "—"}</div>
          <div className="font-mono text-[10px] text-down/80">inverse to BTC</div>
        </div>
      </div>
    </Panel>
  );
}

export function AssistantPanel() {
  const a = useAnalysis();
  if (!a) return null;
  return (
    <Panel title="AI Trade Assistant" icon={Bot}>
      <p className="text-sm leading-relaxed text-foreground/90">
        <span className="mr-1 text-primary">▍</span>
        {a.narrative}
      </p>
      <p className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Statistical analysis only — outcomes are never guaranteed and no trades are placed automatically.
      </p>
    </Panel>
  );
}

export function AlertsPanel() {
  const { alerts } = useMarket();
  return (
    <Panel
      title="Signal Alerts"
      icon={Bell}
      right={<span className="font-mono text-[10px] text-muted-foreground tnum">{alerts.length}</span>}
    >
      {alerts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Waiting for signals — alerts fire on confidence spikes, streaks, crossovers and volume events.</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {alerts.map((al) => (
            <div key={al.id} className="flex items-start gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5">
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  al.direction === "bull" ? "bg-up" : al.direction === "bear" ? "bg-down" : "bg-warn",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className={cn("text-xs", dirTextClass(al.direction))}>{al.message}</div>
                <div className="font-mono text-[9px] text-muted-foreground">
                  {fmtTime(al.time)}
                  {al.severity !== "info" && (
                    <span className={cn("ml-2 uppercase", al.severity === "critical" ? "text-primary" : "text-warn")}>
                      {al.severity}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
