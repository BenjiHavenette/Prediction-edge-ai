import { ArrowDownRight, ArrowUpRight, Brain, Clock3, Crosshair, Gavel, Hourglass, Layers, ShieldAlert, Snowflake, Sparkles } from "lucide-react";

import { StatRow } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { fmtClock } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Entry Advisor — decision panel for the NEXT round, the only round a user can
 * actually enter on PancakeSwap. Betting closes when the current round ends.
 */
export default function NextRoundPanel() {
  const { nextRound, secondsLeft } = useMarket();
  if (!nextRound) return null;

  const n = nextRound;
  const tone =
    n.action === "ENTER UP" ? "up" : n.action === "ENTER DOWN" ? "down" : n.action === "WAIT" ? "warn" : "muted";
  const downProb = 100 - n.upProb;
  const regimeTone =
    n.regime.kind === "trend-up"
      ? "border-up/40 bg-up/10 text-up"
      : n.regime.kind === "trend-down"
        ? "border-down/40 bg-down/10 text-down"
        : "border-warn/40 bg-warn/10 text-warn";
  const discount = Math.round((1 - n.regime.shrink) * 100);
  const htfTone =
    n.regime.alignment === "aligned"
      ? "border-up/40 bg-up/10 text-up"
      : n.regime.alignment === "conflict"
        ? "border-down/40 bg-down/10 text-down"
        : n.regime.htf.bias === "up"
          ? "border-up/40 bg-up/10 text-up"
          : n.regime.htf.bias === "down"
            ? "border-down/40 bg-down/10 text-down"
            : "border-border bg-secondary/50 text-muted-foreground";
  const htfText =
    n.regime.alignment === "aligned"
      ? "15m confirms"
      : n.regime.alignment === "conflict"
        ? "15m conflict"
        : n.regime.alignment === "unconfirmed"
          ? "15m flat"
          : n.regime.htf.bias === "up"
            ? "15m up"
            : n.regime.htf.bias === "down"
              ? "15m down"
              : "15m flat";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border backdrop-blur-sm",
        tone === "up" && "border-up/50 bg-up/[0.04] shadow-[0_0_50px_hsl(var(--up)/0.10)]",
        tone === "down" && "border-down/50 bg-down/[0.04] shadow-[0_0_50px_hsl(var(--down)/0.10)]",
        tone === "warn" && "border-warn/40 bg-card/80",
        tone === "muted" && "border-border bg-card/80",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Entry Advisor — Next Round{n.epoch !== null ? ` #${n.epoch}` : ""}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] tnum">
          <Clock3 className={cn("h-3.5 w-3.5", n.entryWindow ? "text-warn" : "text-muted-foreground")} />
          <span className={cn(n.entryWindow ? "font-bold text-warn" : "text-muted-foreground")}>
            betting closes in {fmtClock(Math.max(0, secondsLeft))}
          </span>
        </div>
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr]">
        {/* Action badge */}
        <div
          className={cn(
            "flex min-w-[10.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-4 py-4 text-center",
            tone === "up" && "border-up/40 bg-up/10",
            tone === "down" && "border-down/40 bg-down/10",
            tone === "warn" && "border-warn/40 bg-warn/10",
            tone === "muted" && "border-border bg-secondary/50",
          )}
        >
          {n.action === "ENTER UP" && <ArrowUpRight className="h-5 w-5 text-up" />}
          {n.action === "ENTER DOWN" && <ArrowDownRight className="h-5 w-5 text-down" />}
          {n.action === "WAIT" && <Hourglass className="h-5 w-5 text-warn" />}
          {n.action === "STAND DOWN" && <ShieldAlert className="h-5 w-5 text-muted-foreground" />}
          <div
            className={cn(
              "font-display text-lg font-bold tracking-[0.15em]",
              tone === "up" && "text-up glow-up",
              tone === "down" && "text-down glow-down",
              tone === "warn" && "text-warn glow-warn",
              tone === "muted" && "text-muted-foreground",
            )}
          >
            {n.action}
          </div>
          {n.side !== null && (
            <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground tnum">
              signal stable {n.stableFor}s
            </div>
          )}
        </div>

        {/* Forecast + payouts */}
        <div className="min-w-0 space-y-2.5">
          <div>
            <div className="mb-1 flex items-center justify-between font-mono text-[11px] tnum">
              <span className="font-bold text-up">{n.upProb}% UP</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">next 5-min forecast</span>
              <span className="font-bold text-down">{downProb}% DOWN</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
              <div className="bg-up transition-all duration-700" style={{ width: `${n.upProb}%` }} />
              <div className="w-0.5 shrink-0 bg-background" />
              <div className="flex-1 bg-down" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tnum">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold uppercase tracking-wide", regimeTone)}>
              <Brain className="h-3 w-3" />
              {n.regime.label}
            </span>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold uppercase tracking-wide", htfTone)}>
              <Layers className="h-3 w-3" />
              {htfText}
            </span>
            <span className="text-muted-foreground">predictability {n.regime.predictability}%</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              raw {n.rawUpProb}% → {n.upProb}% after {discount}% noise discount
            </span>
            {n.neuroDelta !== 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold uppercase tracking-wide",
                  n.neuroDelta > 0 ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down",
                )}
              >
                <Sparkles className="h-3 w-3" />
                neuro {n.neuroDelta > 0 ? "+" : ""}{n.neuroDelta}pt
              </span>
            )}
            {n.playbook.veto !== null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-down/40 bg-down/10 px-2 py-0.5 font-bold uppercase tracking-wide text-down">
                <Gavel className="h-3 w-3" />
                {n.playbook.veto.legend} veto
              </span>
            )}
            {n.playbook.veto === null && n.playbook.conviction && (
              <span className="inline-flex items-center gap-1 rounded-full border border-up/40 bg-up/10 px-2 py-0.5 font-bold uppercase tracking-wide text-up">
                <Gavel className="h-3 w-3" />
                conviction setup
              </span>
            )}
            {n.cold && (
              <span className="inline-flex items-center gap-1 rounded-full border border-down/40 bg-down/10 px-2 py-0.5 font-bold uppercase tracking-wide text-down">
                <Snowflake className="h-3 w-3" />
                model cold {Math.round(n.coldHitRate * 100)}% / {n.coldSample}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <StatRow
              label="UP payout / EV"
              value={
                <>
                  {n.payoutUp !== null ? `${n.payoutUp.toFixed(2)}x` : "~1.95x"}
                  <span className={cn("ml-1.5", n.evUp >= 0 ? "text-up" : "text-down")}>
                    {n.evUp >= 0 ? "+" : ""}
                    {(n.evUp * 100).toFixed(1)}%
                  </span>
                </>
              }
            />
            <StatRow
              label="DOWN payout / EV"
              value={
                <>
                  {n.payoutDown !== null ? `${n.payoutDown.toFixed(2)}x` : "~1.95x"}
                  <span className={cn("ml-1.5", n.evDown >= 0 ? "text-up" : "text-down")}>
                    {n.evDown >= 0 ? "+" : ""}
                    {(n.evDown * 100).toFixed(1)}%
                  </span>
                </>
              }
            />
            <StatRow label="Model confidence" value={`${n.confidence}%`} />
            <StatRow
              label="Next pool"
              value={n.totalBnb !== null ? `${n.totalBnb.toFixed(4)} BNB` : "—"}
              valueClass="text-muted-foreground"
            />
          </div>
          <p className="text-xs leading-relaxed text-foreground/85">{n.reason}</p>
          <p className="font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
            Entries only fire WITH a trending tape that the 15-minute frame confirms — the one condition that audits
            above 60% accuracy. Chop, storm, and counter-15m setups are blocked, no matter what the indicators say.
          </p>
        </div>
      </div>
    </section>
  );
}
