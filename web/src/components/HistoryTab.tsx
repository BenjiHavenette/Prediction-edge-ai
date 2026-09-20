import { Award, Database, History, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";

import { MiniBar, Panel } from "@/components/bits";
import ImportPanel from "@/components/ImportPanel";
import { useMarket } from "@/hooks/useMarket";
import { modelStats, patternStats } from "@/lib/rounds";
import type { PatternStat } from "@/lib/rounds";
import { cn } from "@/lib/utils";

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "up" | "down" | "primary" }) {
  return (
    <div className="rounded-xl border border-border bg-card/80 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-display text-2xl font-bold tnum",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "primary" && "text-primary",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function PatternRow({ stat }: { stat: PatternStat }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 sm:grid-cols-[1fr_90px_60px_120px]">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold",
            stat.side === "UP" ? "bg-up/15 text-up" : "bg-down/15 text-down",
          )}
        >
          {stat.side}
        </span>
        <span className="text-xs">{stat.label}</span>
      </div>
      <span className="hidden font-mono text-[10px] text-muted-foreground tnum sm:block">
        {stat.wins}/{stat.occurrences} rounds
      </span>
      <span
        className={cn(
          "font-mono text-xs font-bold tnum",
          stat.winRate >= 55 ? "text-up" : stat.winRate <= 45 ? "text-down" : "text-warn",
        )}
      >
        {stat.winRate.toFixed(1)}%
      </span>
      <div className="hidden sm:block">
        <MiniBar value={stat.winRate} tone={stat.winRate >= 55 ? "up" : stat.winRate <= 45 ? "down" : "warn"} />
      </div>
    </div>
  );
}

/** Historical Edge Analyzer: model accuracy and per-pattern win rates over stored rounds. */
export default function HistoryTab() {
  const { records } = useMarket();

  const { m100, m500, stats, best, worst, liveCount, upShare } = useMemo(() => {
    const s = patternStats(records)
      .filter((p) => p.occurrences >= 5)
      .sort((a, b) => b.winRate - a.winRate);
    const decidedUp = records.filter((r) => r.result === "UP").length;
    const decided = records.filter((r) => r.result !== "FLAT").length;
    return {
      m100: modelStats(records, 100),
      m500: modelStats(records, 500),
      stats: s,
      best: s.slice(0, 3),
      worst: s.slice(-3).reverse(),
      liveCount: records.filter((r) => r.live).length,
      upShare: decided > 0 ? (decidedUp / decided) * 100 : 0,
    };
  }, [records]);

  return (
    <div className="space-y-3">
      <ImportPanel />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Model Win Rate · Last 100"
          value={m100.decided > 0 ? `${m100.winRate.toFixed(1)}%` : "—"}
          sub={`${m100.wins}/${m100.decided} called rounds`}
          tone={m100.winRate >= 50 ? "up" : "down"}
        />
        <StatCard
          label="Model Win Rate · Last 500"
          value={m500.decided > 0 ? `${m500.winRate.toFixed(1)}%` : "—"}
          sub={`${m500.wins}/${m500.decided} called rounds`}
          tone={m500.winRate >= 50 ? "up" : "down"}
        />
        <StatCard label="Rounds In Database" value={String(records.length)} sub={`${liveCount} tracked live`} tone="primary" />
        <StatCard label="UP Outcome Share" value={`${upShare.toFixed(1)}%`} sub="of all stored rounds" tone={upShare >= 50 ? "up" : "down"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Best-Performing Patterns" icon={Award}>
          {best.length === 0 ? (
            <p className="text-xs text-muted-foreground">Not enough samples yet.</p>
          ) : (
            best.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-up" />
                  <span className="text-xs">{s.label}</span>
                  <span className={cn("font-mono text-[9px] font-bold", s.side === "UP" ? "text-up" : "text-down")}>→ {s.side}</span>
                </div>
                <span className="font-mono text-sm font-bold text-up tnum">{s.winRate.toFixed(1)}%</span>
              </div>
            ))
          )}
        </Panel>
        <Panel title="Worst-Performing Patterns" icon={TrendingDown}>
          {worst.length === 0 ? (
            <p className="text-xs text-muted-foreground">Not enough samples yet.</p>
          ) : (
            worst.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-3.5 w-3.5 text-down" />
                  <span className="text-xs">{s.label}</span>
                  <span className={cn("font-mono text-[9px] font-bold", s.side === "UP" ? "text-up" : "text-down")}>→ {s.side}</span>
                </div>
                <span className="font-mono text-sm font-bold text-down tnum">{s.winRate.toFixed(1)}%</span>
              </div>
            ))
          )}
        </Panel>
      </div>

      <Panel
        title="Pattern Win Rates"
        icon={Database}
        right={
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <History className="h-3 w-3" /> {records.length} rounds analyzed
          </span>
        }
      >
        <div className="divide-y divide-border/40">
          {stats.map((s) => (
            <PatternRow key={s.id} stat={s} />
          ))}
        </div>
        <p className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          Win rate = how often the round closed in the pattern's expected direction. History is seeded from real
          Binance 1-minute data replayed through the engine with no lookahead, then grows with every live round.
        </p>
      </Panel>
    </div>
  );
}
