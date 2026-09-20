import { FlaskConical, History, LineChart } from "lucide-react";
import { useMemo } from "react";

import { Panel, StatRow } from "@/components/bits";
import { CalibrationRows, ConditionLedger } from "@/components/CalibrationTab";
import { useMarket } from "@/hooks/useMarket";
import { fmtDateTime } from "@/lib/format";
import type { WalkForwardPoint } from "@/lib/backtest";
import { runWalkForward } from "@/lib/backtest";
import { cn } from "@/lib/utils";

/** Bank equity curve — 1-unit flat stake per decided bet, walk-forward only. */
function EquityCurve({ curve }: { curve: WalkForwardPoint[] }) {
  if (curve.length < 2) {
    return <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">Not enough history for a walk-forward curve yet.</p>;
  }
  const W = 600;
  const H = 130;
  let min = 1;
  let max = 1;
  for (const p of curve) {
    min = Math.min(min, p.bank);
    max = Math.max(max, p.bank);
  }
  const pad = Math.max((max - min) * 0.08, 0.01);
  min -= pad;
  max += pad;
  const x = (i: number): number => (i / (curve.length - 1)) * W;
  const y = (v: number): number => H - ((v - min) / (max - min || 1)) * H;
  const pts = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.bank).toFixed(1)}`).join(" ");
  const last = curve[curve.length - 1].bank;
  const up = last >= 1;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="none">
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="4 4" />
        <polyline
          points={pts}
          fill="none"
          stroke={up ? "hsl(var(--up))" : "hsl(var(--down))"}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        <span>{fmtDateTime(curve[0].time)}</span>
        <span className={up ? "text-up" : "text-down"}>
          bank {last.toFixed(2)}x · {up ? "profitable" : "below water"}
        </span>
        <span>{fmtDateTime(curve[curve.length - 1].time)}</span>
      </div>
    </div>
  );
}

/** Walk-forward backtest — strict no-look-ahead replay of every stored round. */
export default function BacktestTab() {
  const { records, conditions } = useMarket();
  const result = useMemo(() => runWalkForward(records), [records]);

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <div>
              <span className="font-display text-xs font-bold uppercase tracking-widest text-foreground/90">Walk-Forward Backtest</span>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                parameters refit every 25 rounds — trained on the past only, graded on the future
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className={cn("font-display text-2xl font-bold tnum", result.roi > 0 ? "text-up" : result.roi < 0 ? "text-down" : "text-muted-foreground")}>
              {result.decided > 0 ? `${result.roi >= 0 ? "+" : ""}${result.roi.toFixed(1)}%` : "—"}
            </span>
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground tnum">
              net ROI over {result.decided} decided bets
            </div>
          </div>
        </div>

        <Panel title="Equity curve" icon={LineChart}>
          <EquityCurve curve={result.curve} />
          <div className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <StatRow label="Rounds replayed" value={String(result.rounds)} />
            <StatRow label="Decided" value={`${result.decided} (${(result.selectivity * 100).toFixed(0)}%)`} />
            <StatRow label="Hit rate" value={result.decided > 0 ? `${(result.hitRate * 100).toFixed(1)}%` : "—"} valueClass={result.hitRate >= 0.55 ? "text-up" : undefined} />
            <StatRow label="Final bank" value={`${result.finalBank.toFixed(2)}x`} valueClass={result.finalBank >= 1 ? "text-up" : "text-down"} />
            <StatRow label="Max drawdown" value={`${(result.maxDrawdown * 100).toFixed(1)}%`} valueClass="text-warn" />
            <StatRow label="Brier" value={result.rounds > 0 ? result.brier.toFixed(4) : "—"} />
            <StatRow label="Parameter refits" value={String(result.refreshes)} />
            <StatRow label="Recomputes" value="every settled round" valueClass="text-muted-foreground" />
          </div>
          <p className="mt-3 font-mono text-[9px] leading-relaxed uppercase tracking-wide text-muted-foreground">
            Strict no-look-ahead: each round is scored with the round's own pre-lock snapshot and parameters fitted
            exclusively on rounds settled before it. The gate mirrors the live advisor — EV above a dynamic threshold,
            riding with the trend regime, never into a 15m conflict. Payout assumed 1.95x.
          </p>
        </Panel>

        <Panel title="Walk-forward calibration" icon={LineChart}>
          <CalibrationRows calibration={result.rounds > 0 ? result.calibration : null} />
        </Panel>
      </div>

      <div className="space-y-3 lg:col-span-4">
        <Panel title="Condition proof" icon={FlaskConical}>
          <ConditionLedger conditions={conditions.length > 0 ? conditions : result.conditions} />
        </Panel>

        <Panel
          title="Recent walk-forward decisions"
          icon={History}
          right={<span className="font-mono text-[10px] tnum text-muted-foreground">{result.decided} bets total</span>}
        >
          <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {result.curve
              .filter((p) => p.bet !== null)
              .slice(-30)
              .reverse()
              .map((p) => (
                <div key={p.time} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-muted-foreground">{fmtDateTime(p.time)}</div>
                    <div className="font-mono text-[10px] tnum text-foreground/80">p {p.pUp.toFixed(1)}%</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold", p.bet === "UP" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
                      {p.bet}
                    </span>
                    <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold", p.win ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
                      {p.win ? "WIN" : "LOSS"}
                    </span>
                  </div>
                </div>
              ))}
            {result.decided === 0 && (
              <p className="py-4 text-center font-mono text-[11px] text-muted-foreground">
                No walk-forward bets fired — the gate never found edge above the EV bar on this history.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
