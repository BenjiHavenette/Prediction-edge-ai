import { BrainCircuit } from "lucide-react";

import { Panel } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { cn } from "@/lib/utils";

/**
 * Learning Engine — shows how each scoring category is performing against real
 * outcomes and the adaptive weights currently steering the model, plus a
 * calibration table (predicted probability vs what actually happened).
 */
export default function LearningPanel() {
  const { learning } = useMarket();
  const l = learning;

  return (
    <Panel
      title="Learning Engine"
      icon={BrainCircuit}
      right={
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide",
            l.active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground",
          )}
        >
          {l.active ? "Adaptive weights live" : "Calibrating"}
        </span>
      }
    >
      <div className="space-y-1">
        {l.edges.map((e) => {
          const deltaPct = (e.weight - e.baseWeight) * 100;
          const hitPct = e.hitRate * 100;
          return (
            <div key={e.key} className="py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground/90">{e.label}</span>
                <span className="font-mono text-[10px] tnum">
                  <span
                    className={cn(
                      "font-semibold",
                      e.samples < 20 ? "text-muted-foreground" : hitPct >= 53 ? "text-up" : hitPct <= 47 ? "text-down" : "text-warn",
                    )}
                  >
                    {e.samples > 0 ? `${hitPct.toFixed(0)}% hit` : "no calls"}
                  </span>
                  <span className="ml-1.5 text-muted-foreground">({e.samples})</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", deltaPct >= 0 ? "bg-primary" : "bg-muted-foreground/60")}
                    style={{ width: `${Math.min(100, e.weight * 250)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground tnum">
                  {(e.weight * 100).toFixed(1)}%
                  <span className={cn("ml-1", deltaPct > 0.5 ? "text-up" : deltaPct < -0.5 ? "text-down" : "text-muted-foreground")}>
                    {deltaPct > 0.5 ? "▲" : deltaPct < -0.5 ? "▼" : "•"}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Calibration</span>
          <span className="font-mono text-[10px] text-muted-foreground tnum">{l.graded} rounds graded</span>
        </div>
        <div className="space-y-1">
          {l.calibration.map((b) => {
            const actual = b.actualUpRate * 100;
            const gap = b.rounds > 0 ? actual - b.predictedMid * 100 : 0;
            return (
              <div key={b.label} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[10px] tnum">
                <span className="w-20 shrink-0 text-muted-foreground">{b.label}</span>
                <span className="text-foreground/80">{b.rounds > 0 ? `${actual.toFixed(0)}% closed UP` : "—"}</span>
                <span
                  className={cn(
                    "w-16 shrink-0 text-right",
                    b.rounds === 0 ? "text-muted-foreground" : Math.abs(gap) <= 8 ? "text-up" : "text-warn",
                  )}
                >
                  {b.rounds > 0 ? `${gap >= 0 ? "+" : ""}${gap.toFixed(0)}% off` : ""}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
          Every finished round re-trains the weights — categories that call outcomes correctly gain influence,
          categories that miss lose it.
        </p>
      </div>
    </Panel>
  );
}
