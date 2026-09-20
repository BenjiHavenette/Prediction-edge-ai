import { AlarmClock, Flame, Gauge, Hourglass, Layers, TimerReset, TrendingUp } from "lucide-react";

import { MiniBar, Panel, StatRow } from "@/components/bits";
import { ACCURACY_TARGET } from "@/lib/regimeAudit";
import RegimeTimeline from "@/components/RegimeTimeline";
import { useMarket } from "@/hooks/useMarket";
import { fmtTime } from "@/lib/format";
import type { EtaEstimate, RegimeGroup } from "@/lib/regimeForecast";
import { cn } from "@/lib/utils";

/** "7m 24s" under 90 min, "1.5h" above. */
const fmtDur = (min: number): string => {
  const totalSec = Math.max(0, Math.round(min * 60));
  if (totalSec >= 5400) return `${(totalSec / 3600).toFixed(1)}h`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

const fmtShort = (min: number): string => (min >= 90 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`);

const GROUP_META: Record<RegimeGroup, { label: string; bar: string; text: string; border: string; bg: string }> = {
  trend: { label: "Trend", bar: "bg-up", text: "text-up", border: "border-up/40", bg: "bg-up/10" },
  chop: { label: "Chop", bar: "bg-warn", text: "text-warn", border: "border-warn/40", bg: "bg-warn/10" },
  storm: { label: "Storm", bar: "bg-fuchsia-500", text: "text-fuchsia-400", border: "border-fuchsia-500/40", bg: "bg-fuchsia-500/10" },
};

function EtaRange({ eta }: { eta: EtaEstimate }) {
  if (eta.overdue) return null;
  return (
    <span className="font-mono text-[10px] text-muted-foreground tnum">
      typical {fmtShort(eta.p25Min)}–{fmtShort(eta.p75Min)} · {eta.sample} precedents
    </span>
  );
}

/**
 * Regime Clock — countdown to the next trending tape and survival estimates
 * for how long the current chop/storm/trend regime may keep running.
 */
export default function RegimeClockTab() {
  const { regimeForecast: f, regimeAudit } = useMarket();

  if (!f) {
    return (
      <Panel title="Regime Clock" icon={AlarmClock}>
        <p className="py-6 text-center text-sm text-muted-foreground">
          Classifying regime history — needs ~2 hours of candles. Give it a moment…
        </p>
      </Panel>
    );
  }

  const meta = GROUP_META[f.currentGroup];
  const trending = f.currentGroup === "trend";
  const eta = trending ? f.remaining : f.nextTrendEta;
  const stretchAge = f.stretchAgeMin ?? f.ageMin;
  // Progress of the current wait: age vs age + estimated remaining.
  const waitProgress =
    eta && !eta.overdue ? Math.min(100, (stretchAge / Math.max(1, stretchAge + eta.medianMin)) * 100) : 100;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-8">
        {/* Hero countdown */}
        <section
          className={cn(
            "overflow-hidden rounded-xl border backdrop-blur-sm",
            trending
              ? "border-up/50 bg-up/[0.04] shadow-[0_0_50px_hsl(var(--up)/0.10)]"
              : eta?.overdue
                ? "border-primary/50 bg-primary/[0.04] shadow-[0_0_50px_hsl(var(--primary)/0.12)]"
                : "border-border bg-card/80",
          )}
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <AlarmClock className="h-3.5 w-3.5 text-primary" />
              <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Regime Clock — Next Trending Tape
              </h3>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide",
                meta.border,
                meta.bg,
                f.currentKind === "trend-down" ? "text-down" : meta.text,
              )}
            >
              <span className={cn("h-1.5 w-1.5 animate-pulse rounded-full", f.currentKind === "trend-down" ? "bg-down" : meta.bar)} />
              {f.currentLabel}
            </span>
          </header>

          <div className="p-4">
            <div className="flex flex-col items-center gap-1 py-3 text-center">
              {trending ? (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    trending tape live — estimated time left
                  </div>
                  <div className={cn("font-display text-5xl font-bold tnum", f.currentKind === "trend-down" ? "text-down glow-down" : "text-up glow-up")}>
                    {f.remaining.overdue ? "LATE STAGE" : `~${fmtDur(f.remaining.medianMin)}`}
                  </div>
                  {f.remaining.overdue ? (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-warn">
                      outlasted every recorded trend — expect exhaustion
                    </span>
                  ) : (
                    <EtaRange eta={f.remaining} />
                  )}
                </>
              ) : eta && !eta.overdue ? (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    next trending tape estimated in
                  </div>
                  <div className="font-display text-5xl font-bold text-foreground tnum">~{fmtDur(eta.medianMin)}</div>
                  <EtaRange eta={eta} />
                </>
              ) : (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    next trending tape
                  </div>
                  <div className="font-display text-4xl font-bold tracking-[0.08em] text-primary">OVERDUE</div>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    this stretch outlasted every precedent — ignition can happen any minute
                  </span>
                </>
              )}
            </div>

            {/* Wait progress */}
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground tnum">
              <span>
                {trending ? "trend age" : "trend-free for"} {fmtDur(stretchAge)}
              </span>
              {eta && !eta.overdue && <span>{Math.round(waitProgress)}% through a typical {trending ? "trend" : "wait"}</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  trending ? (f.currentKind === "trend-down" ? "bg-down" : "bg-up") : eta?.overdue ? "animate-pulse bg-primary" : meta.bar,
                )}
                style={{ width: `${waitProgress}%` }}
              />
            </div>

            <p className="mt-3 text-xs leading-relaxed text-foreground/85">{f.narrative}</p>
          </div>
        </section>

        {/* Current regime survival */}
        <Panel
          title={`Current ${GROUP_META[f.currentGroup].label} — survival estimate`}
          icon={Hourglass}
          right={
            <span className="font-mono text-[10px] text-muted-foreground tnum">
              since {fmtTime(f.sinceMs)} · age {fmtDur(f.ageMin)}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            <StatRow
              label="Est. remaining"
              value={f.remaining.overdue ? "overdue" : `~${fmtShort(f.remaining.medianMin)}`}
              valueClass={f.remaining.overdue ? "text-primary" : meta.text}
            />
            <StatRow
              label="Optimistic (p25)"
              value={f.remaining.overdue ? "—" : fmtShort(f.remaining.p25Min)}
            />
            <StatRow
              label="Stubborn (p75)"
              value={f.remaining.overdue ? "—" : fmtShort(f.remaining.p75Min)}
            />
            <StatRow label="Precedents" value={f.remaining.sample} valueClass="text-muted-foreground" />
          </div>
          <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
            Conditional survival: given this regime already lasted {fmtShort(f.ageMin)}, how much longer similar runs
            historically held before flipping.
          </p>
        </Panel>

      </div>

      <div className="space-y-3 lg:col-span-4">
        {/* 15-minute frame efficiency audit */}
        <Panel
          title="15-Minute Frame — Efficiency Audit"
          icon={Layers}
          right={
            regimeAudit && (
              <span
                className={cn(
                  "font-mono text-[10px] font-bold uppercase tracking-wide tnum",
                  regimeAudit.clearsTarget ? "text-up" : "text-warn",
                )}
              >
                target {ACCURACY_TARGET}%
              </span>
            )
          }
        >
          {regimeAudit ? (
            <>
              <div className="space-y-2">
                {regimeAudit.buckets.map((b) => {
                  const hasData = b.rounds > 0;
                  const above = hasData && b.hitRatePct >= ACCURACY_TARGET;
                  return (
                    <div key={b.id} className={cn("rounded-lg border p-2", b.bettable ? "border-up/40 bg-up/[0.05]" : "border-border bg-secondary/30")}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className={cn("text-[11px] font-semibold", b.bettable ? "text-up" : "text-foreground/90")}>
                          {b.label}
                          {b.bettable && <span className="ml-1.5 font-mono text-[9px] uppercase tracking-wide text-up">bettable</span>}
                        </span>
                        <span className={cn("shrink-0 font-mono text-xs font-bold tnum", !hasData ? "text-muted-foreground" : above ? "text-up" : "text-down")}>
                          {hasData ? `${b.hitRatePct.toFixed(0)}%` : "—"}
                        </span>
                      </div>
                      <div className="relative">
                        <MiniBar value={hasData ? b.hitRatePct : 0} tone={!hasData ? "primary" : above ? "up" : "down"} />
                        <div className="absolute inset-y-0 border-l border-dashed border-foreground/40" style={{ left: `${ACCURACY_TARGET}%` }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-wide text-muted-foreground tnum">
                        <span>{b.callNote}</span>
                        <span>{hasData ? `${b.hits}/${b.rounds} rounds` : "no precedent"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-foreground/85">{regimeAudit.verdict}</p>
              <p className="mt-1.5 font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
                Replayed {regimeAudit.totalRounds} historical 5-min rounds with no lookahead — regime read at lock,
                graded at close. Re-audits every minute as new tape arrives.
              </p>
            </>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Auditing regime history — needs ~6 hours of candles…
            </p>
          )}
        </Panel>

        {/* Trend warming gauge */}
        <Panel
          title="Trend Warming"
          icon={Flame}
          right={
            <span
              className={cn(
                "font-mono text-xs font-bold tnum",
                f.warming >= 60 ? "text-up" : f.warming >= 35 ? "text-warn" : "text-muted-foreground",
              )}
            >
              {f.warming}%
            </span>
          }
        >
          <MiniBar value={f.warming} tone={f.warming >= 60 ? "up" : f.warming >= 35 ? "warn" : "primary"} />
          <p className="mt-2 text-xs leading-relaxed text-foreground/85">
            {f.warming >= 60
              ? "Ignition conditions building fast — a trending tape may start within minutes."
              : f.warming >= 35
                ? "Energy coiling, but the tape has not cleared the trend thresholds yet."
                : "No ignition signs. The tape is pure noise — the clock estimate is your best guide."}
          </p>
          <div className="mt-3 space-y-0.5">
            {f.warmingSignals.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-2 py-1">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.good ? "bg-up" : "bg-secondary-foreground/30")} />
                  <span className="text-xs text-foreground/90">{s.label}</span>
                </div>
                <span className={cn("shrink-0 font-mono text-[10px] tnum", s.good ? "text-up" : "text-muted-foreground")}>
                  {s.detail}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Regime duration database */}
        <Panel title="Regime lifespans — historical" icon={TimerReset}>
          <div className="space-y-3">
            {f.stats.map((s) => {
              const m = GROUP_META[s.group];
              return (
                <div key={s.group} className={cn("rounded-lg border p-2.5", m.border, "bg-secondary/30")}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn("font-display text-[11px] font-bold uppercase tracking-wider", m.text)}>
                      {m.label}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground tnum">
                      {s.count} runs · {s.sharePct.toFixed(0)}% of tape
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tnum">
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">median</div>
                      <div className="font-semibold">{fmtShort(s.medianMin)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">average</div>
                      <div className="font-semibold">{fmtShort(s.avgMin)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">longest</div>
                      <div className="font-semibold">{fmtShort(s.maxMin)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* How it works */}
        <Panel title="How the clock works" icon={Gauge}>
          <div className="space-y-2 text-xs leading-relaxed text-foreground/80">
            <p>
              <TrendingUp className="mr-1 inline h-3 w-3 text-up" />
              Every 1-minute bar in memory is classified into trend / chop / storm using path efficiency,
              signal-to-noise, and mean-reversion — the same market-mind engine that gates entries.
            </p>
            <p>
              The clock is a <span className="text-foreground">conditional survival estimate</span>: given the current
              stretch has already lasted this long, it measures how much longer similar stretches historically ran
              before a trend ignited.
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              Estimates are statistical, not guarantees — regimes can flip early or drag on. Trend share of tape:{" "}
              {f.trendSharePct.toFixed(0)}%. Only ~{f.trendSharePct.toFixed(0)}% of minutes are bettable; the clock
              exists so you wait through the rest.
            </p>
          </div>
        </Panel>
      </div>
      </div>

      {/* Full-width scrollable regime history */}
      <RegimeTimeline timeline={f.timeline} stats={f.stats} />
    </div>
  );
}
