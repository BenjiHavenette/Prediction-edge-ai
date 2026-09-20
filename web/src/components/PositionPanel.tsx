import { ArrowDownRight, ArrowUpRight, CheckCircle2, Flag, Lock, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { StatRow } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { fmtClock, fmtUsd } from "@/lib/format";
import { computePositionStats } from "@/lib/positions";
import type { UserPosition } from "@/lib/positions";
import { cn } from "@/lib/utils";

const isSettled = (p: UserPosition): boolean => p.status === "won" || p.status === "lost" || p.status === "flat";

function ModelAgreementChip({ p }: { p: UserPosition }) {
  if (p.agreesWithModel === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-up/40 bg-up/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-up">
        <CheckCircle2 className="h-3 w-3" /> with the engine
      </span>
    );
  }
  if (p.agreesWithModel === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-down/40 bg-down/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-down">
        <XCircle className="h-3 w-3" /> against the engine
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-warn">
      engine had no side
    </span>
  );
}

/**
 * My Position — where the user tells the engine which side they actually
 * locked in on PancakeSwap. The engine then tracks it live, warns when the
 * model turns against it, grades it at settlement, and keeps the record.
 */
export default function PositionPanel() {
  const { positions, logPosition, cancelPosition, nextRound, secondsLeft, livePrice } = useMarket();
  const [amount, setAmount] = useState<string>("");

  const open = useMemo(
    () => positions.find((p) => p.status === "pending" || p.status === "live") ?? null,
    [positions],
  );
  const stats = useMemo(() => computePositionStats(positions), [positions]);
  const recent = useMemo(() => positions.filter(isSettled).slice(-4).reverse(), [positions]);

  const handleLog = (side: "UP" | "DOWN") => {
    const parsed = Number.parseFloat(amount);
    logPosition(side, Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    setAmount("");
  };

  const tone = open === null ? "muted" : open.side === "UP" ? "up" : "down";
  const diff = open !== null && open.status === "live" && open.lockPrice !== null ? livePrice - open.lockPrice : null;
  const leading = diff !== null && open !== null ? (open.side === "UP" ? diff > 0 : diff < 0) : null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border backdrop-blur-sm",
        tone === "up" && "border-up/50 bg-up/[0.04]",
        tone === "down" && "border-down/50 bg-down/[0.04]",
        tone === "muted" && "border-border bg-card/80",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Flag className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            My Position — Lock-In Tracker
          </h3>
        </div>
        {stats.settled > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground tnum">
            record {stats.wins}W-{stats.losses}L{stats.flats > 0 ? `-${stats.flats}F` : ""} ·{" "}
            {Math.round(stats.hitRate * 100)}%
            {stats.streak !== 0 && (
              <span className={cn("ml-1.5 font-bold", stats.streak > 0 ? "text-up" : "text-down")}>
                {stats.streak > 0 ? `${stats.streak}W streak` : `${-stats.streak}L streak`}
              </span>
            )}
          </span>
        )}
      </header>

      <div className="space-y-3 p-4">
        {open === null ? (
          <>
            <p className="text-xs leading-relaxed text-foreground/85">
              Locked in a bet on PancakeSwap? Tell the engine which side — it will track the round live, warn you if
              the model flips against you, and grade the result into your record.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Stake (BNB, optional)"
                className="h-10 w-40 rounded-lg border border-border bg-secondary/50 px-3 font-mono text-xs tnum outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
              />
              <button
                onClick={() => handleLog("UP")}
                className="flex h-10 flex-1 min-w-[8rem] items-center justify-center gap-1.5 rounded-lg border border-up/50 bg-up/10 font-display text-xs font-bold tracking-[0.14em] text-up transition-colors hover:bg-up/20"
              >
                <ArrowUpRight className="h-4 w-4" /> I ENTERED UP
              </button>
              <button
                onClick={() => handleLog("DOWN")}
                className="flex h-10 flex-1 min-w-[8rem] items-center justify-center gap-1.5 rounded-lg border border-down/50 bg-down/10 font-display text-xs font-bold tracking-[0.14em] text-down transition-colors hover:bg-down/20"
              >
                <ArrowDownRight className="h-4 w-4" /> I ENTERED DOWN
              </button>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground tnum">
              logs against next round{nextRound?.epoch !== null && nextRound !== null ? ` #${nextRound.epoch}` : ""} ·
              betting closes in {fmtClock(secondsLeft)}
            </p>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div
              className={cn(
                "flex min-w-[10.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-4 py-4 text-center",
                open.side === "UP" ? "border-up/40 bg-up/10" : "border-down/40 bg-down/10",
              )}
            >
              {open.side === "UP" ? (
                <ArrowUpRight className="h-5 w-5 text-up" />
              ) : (
                <ArrowDownRight className="h-5 w-5 text-down" />
              )}
              <div
                className={cn(
                  "font-display text-lg font-bold tracking-[0.15em]",
                  open.side === "UP" ? "text-up glow-up" : "text-down glow-down",
                )}
              >
                {open.side} LOCKED
              </div>
              <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground tnum">
                <Lock className="h-3 w-3" />
                {open.status === "pending" ? `locks in ${fmtClock(secondsLeft)}` : `settles in ${fmtClock(secondsLeft)}`}
              </div>
            </div>

            <div className="min-w-0 space-y-1">
              {open.status === "live" && diff !== null && (
                <div
                  className={cn(
                    "mb-1.5 flex items-center justify-between rounded-lg border px-3 py-2",
                    leading === true ? "border-up/40 bg-up/10" : "border-down/40 bg-down/10",
                  )}
                >
                  <span
                    className={cn(
                      "font-display text-sm font-bold tracking-[0.12em]",
                      leading === true ? "text-up" : "text-down",
                    )}
                  >
                    {diff === 0 ? "DEAD EVEN" : leading === true ? "WINNING" : "LOSING"}
                  </span>
                  <span className={cn("font-mono text-xs font-bold tnum", leading === true ? "text-up" : "text-down")}>
                    {diff >= 0 ? "+" : "-"}${fmtUsd(Math.abs(diff))} vs lock
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4">
                <StatRow label="Round" value={`#${open.epoch}`} />
                <StatRow label="Stake" value={open.amountBnb !== null ? `${open.amountBnb} BNB` : "—"} />
                <StatRow
                  label="Payout at entry"
                  value={open.payoutAtEntry !== null ? `${open.payoutAtEntry.toFixed(2)}x` : "~1.95x"}
                />
                {open.status === "live" && open.lockPrice !== null ? (
                  <StatRow label="Lock price" value={`$${fmtUsd(open.lockPrice)}`} />
                ) : (
                  <StatRow
                    label="Model at entry"
                    value={open.modelUpProb !== null ? `${open.modelUpProb}% UP` : "—"}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <ModelAgreementChip p={open} />
                {open.regimeLabel !== null && (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {open.regimeLabel} at entry
                  </span>
                )}
                {open.status === "pending" && (
                  <button
                    onClick={() => cancelPosition(open.id)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-down/40 hover:text-down"
                  >
                    <Trash2 className="h-3 w-3" /> undo
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {(recent.length > 0 || stats.withModel.total > 0 || stats.againstModel.total > 0) && (
          <div className="space-y-1.5 border-t border-border/60 pt-2.5">
            {(stats.withModel.total > 0 || stats.againstModel.total > 0) && (
              <p className="font-mono text-[10px] uppercase leading-relaxed tracking-wide text-muted-foreground tnum">
                with engine {stats.withModel.wins}/{stats.withModel.total} · against engine {stats.againstModel.wins}/
                {stats.againstModel.total}
                {stats.netPnlBnb !== null && (
                  <span className={cn("ml-2 font-bold", stats.netPnlBnb >= 0 ? "text-up" : "text-down")}>
                    net {stats.netPnlBnb >= 0 ? "+" : ""}
                    {stats.netPnlBnb.toFixed(4)} BNB
                  </span>
                )}
              </p>
            )}
            {recent.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 font-mono text-[11px] tnum">
                <span className="text-muted-foreground">#{p.epoch}</span>
                <span className={cn("font-bold", p.side === "UP" ? "text-up" : "text-down")}>{p.side}</span>
                <span
                  className={cn(
                    "font-bold uppercase",
                    p.status === "won" ? "text-up" : p.status === "lost" ? "text-down" : "text-warn",
                  )}
                >
                  {p.status}
                </span>
                <span className="text-muted-foreground">
                  {p.lockPrice !== null && p.closePrice !== null
                    ? `${p.closePrice - p.lockPrice >= 0 ? "+" : "-"}$${fmtUsd(Math.abs(p.closePrice - p.lockPrice))}`
                    : "—"}
                </span>
                <span className={cn(p.pnlBnb !== null && p.pnlBnb >= 0 ? "text-up" : "text-down")}>
                  {p.pnlBnb !== null ? `${p.pnlBnb >= 0 ? "+" : ""}${p.pnlBnb.toFixed(4)} BNB` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
