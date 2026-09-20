import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Direction, Signal } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Section wrapper with a terminal-style header. */
export function Panel({
  title,
  icon: Icon,
  right,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/80 backdrop-blur-sm", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
          <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </h3>
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const dirTextClass = (d: Direction): string =>
  d === "bull" ? "text-up" : d === "bear" ? "text-down" : "text-warn";

export const dirDotClass = (d: Direction): string =>
  d === "bull" ? "bg-up" : d === "bear" ? "bg-down" : "bg-warn";

/** Small direction pill. */
export function DirBadge({ direction, label }: { direction: Direction; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
        direction === "bull" && "border-up/40 bg-up/10 text-up",
        direction === "bear" && "border-down/40 bg-down/10 text-down",
        direction === "neutral" && "border-warn/40 bg-warn/10 text-warn",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dirDotClass(direction))} />
      {label}
    </span>
  );
}

/** Centered bipolar score bar for -100..100 values. */
export function ScoreBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.abs(value));
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div className="absolute inset-y-0 left-1/2 z-10 w-px bg-border" />
      {value >= 0 ? (
        <div
          className="absolute inset-y-0 left-1/2 rounded-r-full bg-up transition-all duration-500"
          style={{ width: `${pct / 2}%` }}
        />
      ) : (
        <div
          className="absolute inset-y-0 right-1/2 rounded-l-full bg-down transition-all duration-500"
          style={{ width: `${pct / 2}%` }}
        />
      )}
    </div>
  );
}

/** Single signal line with a colored status dot. */
export function SignalRow({ signal }: { signal: Signal }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dirDotClass(signal.direction))} />
        <span className="text-xs text-foreground/90">{signal.label}</span>
      </div>
      {signal.detail && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{signal.detail}</span>}
    </div>
  );
}

/** Label/value row in mono. */
export function StatRow({ label, value, valueClass }: { label: string; value: ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-xs font-semibold tnum", valueClass)}>{value}</span>
    </div>
  );
}

/** 0..100 progress micro-bar. */
export function MiniBar({ value, tone }: { value: number; tone: "up" | "down" | "warn" | "primary" }) {
  const toneClass =
    tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : tone === "warn" ? "bg-warn" : "bg-primary";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full transition-all duration-500", toneClass)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
