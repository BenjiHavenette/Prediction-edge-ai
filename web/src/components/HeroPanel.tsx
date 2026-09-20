import { Activity, AlertTriangle, Hash, Link2, Lock, Timer, Zap } from "lucide-react";

import { useMarket } from "@/hooks/useMarket";
import { fmtClock, fmtPct, fmtSign, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Current round hero: probabilities, confidence, recommendation and live countdown. */
export default function HeroPanel() {
  const { analysis, livePrice, round, secondsLeft, coin } = useMarket();
  if (!analysis || !round) return null;

  const diff = livePrice - round.lockPrice;
  const diffPct = round.lockPrice !== 0 ? (diff / round.lockPrice) * 100 : 0;
  const roundSeconds = Math.max(1, Math.round((round.closeTime - round.startTime) / 1000));
  const progress = Math.min(100, ((roundSeconds - secondsLeft) / roundSeconds) * 100);
  const calculating = secondsLeft <= 0;
  const finalMinute = !calculating && secondsLeft <= 60 && secondsLeft > 15;
  const volatilityZone = !calculating && secondsLeft <= 15;
  const rec = analysis.recommendation;
  const up = analysis.upProbability;
  const down = analysis.downProbability;
  const fifth = analysis.fifth;
  const coinFlip = fifth.coinFlip && !calculating;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
      {/* Top strip: round meta */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <Hash className="h-3.5 w-3.5 text-primary" />
          <span>
            ROUND <span className="font-semibold text-foreground tnum">#{round.roundNumber}</span>
          </span>
          <span className="text-border">|</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-blink rounded-full bg-up" />
            LIVE
          </span>
          <span className="text-border">|</span>
          <span
            className={cn(
              "flex items-center gap-1",
              round.synced ? "text-up" : "text-warn",
            )}
            title={round.synced ? "Round schedule read from the PancakeSwap contract on BNB Chain" : "On-chain sync unavailable — using clock-aligned rounds"}
          >
            <Link2 className="h-3 w-3" />
            {round.synced ? "PANCAKESWAP SYNC" : "CLOCK MODE"}
          </span>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase",
            analysis.candleDirection === "green" ? "text-up" : analysis.candleDirection === "red" ? "text-down" : "text-warn",
          )}
        >
          <Activity className="h-3.5 w-3.5" />
          Current candle: {analysis.candleDirection}
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{coin.id} Price</div>
              <div className="font-mono text-lg font-bold tnum sm:text-2xl">${fmtUsd(livePrice)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                <Lock className="h-3 w-3" /> Lock Price
              </div>
              <div className="font-mono text-lg font-bold text-warn tnum sm:text-2xl">${fmtUsd(round.lockPrice)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">vs Lock</div>
              <div
                className={cn(
                  "font-mono text-lg font-bold tnum sm:text-2xl",
                  diff >= 0 ? "text-up glow-up" : "text-down glow-down",
                )}
              >
                {fmtSign(diff)}
              </div>
              <div className={cn("font-mono text-[10px] tnum", diff >= 0 ? "text-up/80" : "text-down/80")}>
                {fmtPct(diffPct, 3)}
              </div>
            </div>
          </div>

          {/* Probability duel */}
          <div>
            <div className="flex items-end justify-between">
              <div>
                <div className="font-display text-4xl font-bold text-up glow-up tnum sm:text-5xl">{up}%</div>
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  UP Probability
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-4xl font-bold text-down glow-down tnum sm:text-5xl">{down}%</div>
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  DOWN Probability
                </div>
              </div>
            </div>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-secondary">
              <div
                className="bg-gradient-to-r from-up/60 to-up transition-all duration-700"
                style={{ width: `${up}%` }}
              />
              <div className="w-0.5 shrink-0 bg-background" />
              <div className="flex-1 bg-gradient-to-r from-down to-down/60 transition-all duration-700" />
            </div>
          </div>

          {/* Confidence + expected move */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Confidence</span>
                <span
                  className={cn(
                    "font-mono text-sm font-bold tnum",
                    analysis.confidence >= 75 ? "text-primary glow-primary" : analysis.confidence >= 55 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {analysis.confidence}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    analysis.confidence >= 75 ? "bg-primary" : analysis.confidence >= 55 ? "bg-primary/70" : "bg-muted-foreground/50",
                  )}
                  style={{ width: `${analysis.confidence}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Exp. Move</div>
              <div className="font-mono text-sm font-bold tnum">
                ±{analysis.expectedMovePct.toFixed(3)}%
                <span
                  className={cn(
                    "ml-1.5",
                    analysis.expectedDirection === "up" ? "text-up" : analysis.expectedDirection === "down" ? "text-down" : "text-warn",
                  )}
                >
                  {analysis.expectedDirection === "up" ? "▲" : analysis.expectedDirection === "down" ? "▼" : "◆"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recommendation */}
        <div className="flex items-stretch lg:w-52">
          <div
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1 rounded-xl border px-4 py-4 text-center",
              rec === "UP" && "border-up/40 bg-up/10 shadow-[0_0_40px_hsl(var(--up)/0.12)]",
              rec === "DOWN" && "border-down/40 bg-down/10 shadow-[0_0_40px_hsl(var(--down)/0.12)]",
              rec === "WAIT" && "border-warn/40 bg-warn/10 shadow-[0_0_40px_hsl(var(--warn)/0.10)]",
            )}
          >
            <Zap className={cn("h-4 w-4", rec === "UP" ? "text-up" : rec === "DOWN" ? "text-down" : "text-warn")} />
            <div
              className={cn(
                "font-display text-xl font-bold tracking-[0.2em]",
                rec === "UP" && "text-up glow-up",
                rec === "DOWN" && "text-down glow-down",
                rec === "WAIT" && "text-warn glow-warn",
              )}
            >
              {rec === "UP" ? "🟢 TAKE UP" : rec === "DOWN" ? "🔴 TAKE DOWN" : "🟡 WAIT"}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Model signal</div>
            {fifth.payoutUp !== null && fifth.payoutDown !== null && (
              <div className="mt-1 font-mono text-[10px] text-muted-foreground tnum">
                <span className="text-up">{fifth.payoutUp.toFixed(2)}x</span>
                <span className="mx-1">/</span>
                <span className="text-down">{fifth.payoutDown.toFixed(2)}x</span> payout
              </div>
            )}
            {rec === "WAIT" && coinFlip && (
              <div className="font-mono text-[9px] uppercase tracking-wide text-warn">Gap inside noise floor</div>
            )}
          </div>
        </div>
      </div>

      {/* Countdown */}
      <div className="border-t border-border/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Timer className={cn("h-4 w-4", volatilityZone ? "text-down" : finalMinute ? "text-warn" : "text-primary")} />
            <span
              className={cn(
                "font-mono text-2xl font-bold tnum",
                volatilityZone ? "text-down glow-down" : finalMinute ? "text-warn glow-warn" : "text-foreground",
              )}
            >
              {fmtClock(Math.max(0, secondsLeft))}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground tnum">
              {calculating ? "round ending…" : `${secondsLeft}s left`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {coinFlip && (
              <span className="flex items-center gap-1.5 rounded-full border border-warn/50 bg-warn/10 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-widest text-warn">
                <AlertTriangle className="h-3 w-3" /> Coin-Flip Zone — No Edge
              </span>
            )}
            {finalMinute && (
              <span className="flex animate-danger items-center gap-1.5 rounded-full border border-warn/50 bg-warn/10 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-widest text-warn">
                <AlertTriangle className="h-3 w-3" /> Final Minute Alert
              </span>
            )}
            {volatilityZone && (
              <span className="flex animate-danger items-center gap-1.5 rounded-full border border-down/50 bg-down/10 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-widest text-down">
                <AlertTriangle className="h-3 w-3" /> High Volatility Zone
              </span>
            )}
            {calculating && (
              <span className="flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-widest text-primary">
                Calculating next round…
              </span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground tnum">{progress.toFixed(0)}% complete</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000",
              volatilityZone ? "bg-down" : finalMinute ? "bg-warn" : "bg-primary",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </section>
  );
}
