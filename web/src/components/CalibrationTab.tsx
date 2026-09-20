import { CheckCircle2, CircleDashed, Gauge, MinusCircle, Ruler, Timer, XCircle } from "lucide-react";

import { Panel, StatRow } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import type { ConditionProof } from "@/lib/conditionSearch";
import type { CalibrationBucketStat, CalibrationReport } from "@/lib/calibration";
import type { TimeStructureModel } from "@/lib/timeStructure";
import { cn } from "@/lib/utils";

/**
 * Reliability row: predicted confidence as a filled bar, realized win rate as a
 * vertical marker. When the marker sits right of the bar's end, the model was
 * underconfident in that bucket — left of it, overconfident.
 */
export function ReliabilityRow({ b }: { b: CalibrationBucketStat }) {
  return (
    <div className={cn("py-1.5", b.n === 0 && "opacity-40")}>
      <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] tnum">
        <span className="text-muted-foreground">
          {b.label} <span className="text-muted-foreground/60">· {b.n} rounds</span>
        </span>
        {b.n > 0 && (
          <span>
            <span className="text-primary">{(b.avgPredicted * 100).toFixed(1)}%</span>
            <span className="text-muted-foreground"> → </span>
            <span className="font-bold text-foreground">{(b.realized * 100).toFixed(1)}%</span>
            <span className={cn("ml-1.5 font-bold", Math.abs(b.gapPp) <= 3 ? "text-muted-foreground" : b.gapPp > 0 ? "text-up" : "text-down")}>
              {b.gapPp >= 0 ? "+" : ""}
              {b.gapPp.toFixed(1)}pp
            </span>
          </span>
        )}
      </div>
      <div className="relative h-2 rounded-full bg-secondary">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30 transition-all duration-500" style={{ width: `${b.avgPredicted * 100}%` }} />
        {b.n > 0 && (
          <div className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground shadow-[0_0_6px_hsl(var(--foreground)/0.6)]" style={{ left: `calc(${Math.min(100, Math.max(0, b.realized * 100))}% - 1px)` }} />
        )}
      </div>
    </div>
  );
}

export function CalibrationRows({ calibration }: { calibration: CalibrationReport | null }) {
  if (!calibration || calibration.samples === 0) {
    return <p className="py-4 text-center font-mono text-[11px] text-muted-foreground">No graded rounds yet — calibration appears as rounds settle.</p>;
  }
  return (
    <>
      {calibration.buckets.map((b) => (
        <ReliabilityRow key={b.label} b={b} />
      ))}
    </>
  );
}

const STATUS_META: Record<ConditionProof["status"], { label: string; icon: typeof CheckCircle2; cls: string }> = {
  proven: { label: "PROVEN", icon: CheckCircle2, cls: "border-up/40 bg-up/10 text-up" },
  failed: { label: "FAILED FORWARD", icon: XCircle, cls: "border-down/40 bg-down/10 text-down" },
  observation: { label: "WATCHING", icon: CircleDashed, cls: "border-border bg-secondary/50 text-muted-foreground" },
};

/** Condition ledger — discovered conditions with their prove-forward status. */
export function ConditionLedger({ conditions }: { conditions: ConditionProof[] }) {
  if (conditions.length === 0) {
    return <p className="py-4 text-center font-mono text-[11px] text-muted-foreground">No history to search yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-border/60 pb-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground sm:grid-cols-[1fr_9rem_9rem_6.5rem]">
        <span>Condition</span>
        <span className="hidden text-right sm:block">In-sample</span>
        <span className="hidden text-right sm:block">Out-of-sample</span>
        <span className="text-right">Verdict</span>
      </div>
      {conditions.map((c) => {
        const meta = STATUS_META[c.status];
        const Icon = meta.icon;
        return (
          <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1 py-1.5 hover:bg-secondary/40 sm:grid-cols-[1fr_9rem_9rem_6.5rem]">
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-foreground/90">{c.label}</div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {c.group} · {Math.round(c.roiIS)}% ROI in / {Math.round(c.roiOOS)}% out
              </div>
            </div>
            <div className="hidden text-right font-mono text-[10px] tnum text-muted-foreground sm:block">
              {(c.accIS * 100).toFixed(1)}% <span className="text-muted-foreground/60">· {c.nIS}</span>
            </div>
            <div className="hidden text-right font-mono text-[10px] tnum sm:block">
              <span className={c.accOOS >= c.accIS - 0.07 ? "text-up" : "text-down"}>{(c.accOOS * 100).toFixed(1)}%</span>
              <span className="text-muted-foreground/60"> · {c.nOOS}</span>
            </div>
            <div className="flex justify-end">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-wide", meta.cls)}>
                <Icon className="h-3 w-3" />
                {meta.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Time-structure bucket grid: 4 quarters × 3 five-minute positions. */
function TimeBucketGrid({ model }: { model: TimeStructureModel }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {model.buckets.map((b) => (
        <div
          key={`${b.quarter}-${b.slot}`}
          className={cn(
            "rounded-lg border p-2",
            b.active ? "border-primary/40 bg-primary/5" : "border-border/60 bg-secondary/40",
            !model.valid && "opacity-50",
          )}
        >
          <div className="flex items-center justify-between font-mono text-[10px] font-bold text-foreground/90">
            {b.label}
            {b.active ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <MinusCircle className="h-3 w-3 text-muted-foreground" />}
          </div>
          <div className="mt-1 space-y-0.5 font-mono text-[9px] text-muted-foreground tnum">
            <div className="flex justify-between">
              <span>n</span>
              <span className="text-foreground/80">{b.n}</span>
            </div>
            <div className="flex justify-between">
              <span>realized</span>
              <span className={cn(b.realized >= b.avgPredicted ? "text-up" : "text-down")}>{(b.realized * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span>predicted</span>
              <span className="text-foreground/80">{(b.avgPredicted * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span>adjustment</span>
              <span className={cn(Math.abs(b.zAdj) < 0.005 ? "text-muted-foreground" : b.zAdj > 0 ? "text-up" : "text-down")}>
                {b.zAdj >= 0 ? "+" : ""}
                {b.zAdj.toFixed(3)}σ
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Accuracy dashboard — calibration by probability bucket, time structure, condition ledger. */
export default function CalibrationTab() {
  const { calibration, timeModel, conditions } = useMarket();

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-7">
        <Panel
          title="Calibration — predicted vs realized"
          icon={Gauge}
          right={
            calibration && calibration.samples > 0 ? (
              <span className="font-mono text-[10px] tnum text-muted-foreground">{calibration.samples} graded rounds</span>
            ) : undefined
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <StatRow
              label="Brier score"
              value={calibration && calibration.samples > 0 ? calibration.brier.toFixed(4) : "—"}
              valueClass={cn(calibration && calibration.samples > 0 && (calibration.brier < 0.24 ? "text-up" : calibration.brier > 0.26 ? "text-down" : "text-warn"))}
            />
            <StatRow
              label="Mean gap"
              value={calibration && calibration.samples > 0 ? `${calibration.meanGap.toFixed(1)}pp` : "—"}
            />
            <StatRow
              label="UP bias"
              value={calibration && calibration.samples > 0 ? `${calibration.biasUp >= 0 ? "+" : ""}${calibration.biasUp.toFixed(1)}pp` : "—"}
              valueClass={cn(calibration && calibration.samples > 0 && (calibration.biasUp > 2 ? "text-down" : calibration.biasUp < -2 ? "text-up" : undefined))}
            />
            <StatRow
              label="Live EV gate"
              value={calibration && calibration.meanGap > 6 ? "raised" : "base"}
              valueClass={calibration && calibration.meanGap > 6 ? "text-warn" : undefined}
            />
          </div>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Bar = predicted confidence · marker = realized win rate · pp = calibration error
          </p>
          <CalibrationRows calibration={calibration} />
        </Panel>

        <Panel
          title="Condition ledger — searched, then proven forward"
          icon={Ruler}
          right={
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold",
                conditions.some((c) => c.status === "proven") ? "border-up/40 bg-up/10 text-up" : "border-border bg-secondary/50 text-muted-foreground",
              )}
            >
              {conditions.filter((c) => c.status === "proven").length} PROVEN
            </span>
          }
        >
          <p className="mb-3 font-mono text-[9px] leading-relaxed uppercase tracking-wide text-muted-foreground">
            Every condition is discovered on the first 60% of history and must survive the untouched last 40% to be
            proven. Proven conditions gate live entries — setups matching none are waits.
          </p>
          <ConditionLedger conditions={conditions} />
        </Panel>
      </div>

      <div className="space-y-3 lg:col-span-5">
        <Panel
          title="Time-structure engine"
          icon={Timer}
          right={
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold",
                timeModel.valid ? "border-up/40 bg-up/10 text-up" : "border-border bg-secondary/50 text-muted-foreground",
              )}
            >
              {timeModel.valid ? "VALIDATED" : "INERT"}
            </span>
          }
        >
          <TimeBucketGrid model={timeModel} />
          <p className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs leading-relaxed text-foreground/85">{timeModel.note}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-6">
            <StatRow label="Samples" value={String(timeModel.samples)} />
            <StatRow label="Folds passed" value={`${timeModel.foldsPassed}/2`} />
            <StatRow label="Brier base" value={timeModel.samples >= 120 ? timeModel.brierBase.toFixed(4) : "—"} />
            <StatRow
              label="Brier adjusted"
              value={timeModel.samples >= 120 ? timeModel.brierAdj.toFixed(4) : "—"}
              valueClass={timeModel.valid ? "text-up" : undefined}
            />
          </div>
          <p className="mt-3 font-mono text-[9px] leading-relaxed uppercase tracking-wide text-muted-foreground">
            Learns whether 15-minute quarters or 5-minute positions calibrate better under similar conditions. Offsets
            apply only with n ≥ 15 per bucket, ≥ 120 rounds total, and a walk-forward Brier improvement on both holdout
            folds — otherwise every bucket contributes exactly zero.
          </p>
        </Panel>
      </div>
    </div>
  );
}
