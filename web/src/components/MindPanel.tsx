import { Landmark, Sparkles } from "lucide-react";

import { Panel } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { PLAYBOOK } from "@/lib/wallstreet";
import type { PlaybookStance } from "@/lib/wallstreet";
import { cn } from "@/lib/utils";

const MODE_META: Record<string, { label: string; className: string }> = {
  rewiring: { label: "Rewiring — losses spiked plasticity", className: "border-down/40 bg-down/10 text-down" },
  adapting: { label: "Adapting", className: "border-warn/40 bg-warn/10 text-warn" },
  consolidated: { label: "Consolidated — protecting what works", className: "border-up/40 bg-up/10 text-up" },
};

const STANCE_META: Record<PlaybookStance, { label: string; className: string }> = {
  veto: { label: "VETO", className: "border-down/40 bg-down/10 text-down" },
  conviction: { label: "CONVICTION", className: "border-up/40 bg-up/10 text-up" },
  caution: { label: "CAUTION", className: "border-warn/40 bg-warn/10 text-warn" },
  honor: { label: "IN EFFECT", className: "border-primary/40 bg-primary/10 text-primary" },
};

/**
 * Neuroplasticity — live synaptic trust per signal. Every settled round fires
 * Hebbian LTP/LTD: signals that call outcomes get potentiated, signals that
 * miss get depressed, and the learning rate itself spikes after losses.
 */
function NeuroSection() {
  const { neuro } = useMarket();
  const mode = MODE_META[neuro.mode] ?? MODE_META.adapting;

  return (
    <Panel
      title="Neuroplasticity"
      icon={Sparkles}
      right={
        <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide", mode.className)}>
          {mode.label}
        </span>
      }
    >
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] tnum">
          <span className="uppercase tracking-widest text-muted-foreground">Plasticity rate</span>
          <span className="text-foreground/80">
            {neuro.plasticityPct}% · {Math.round(neuro.recentHitRate * 100)}% recent calls
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              neuro.mode === "rewiring" ? "bg-down" : neuro.mode === "consolidated" ? "bg-up" : "bg-warn",
            )}
            style={{ width: `${Math.min(100, Math.max(4, neuro.plasticityPct))}%` }}
          />
        </div>
        <p className="mt-1.5 font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
          Losses spike plasticity (fast rewiring) · wins consolidate the synapses that earned them.
        </p>
      </div>

      <div className="space-y-1">
        {neuro.synapses.map((s) => {
          const drift = (s.strength - 1) * 100;
          const potentiated = drift > 4;
          const depressed = drift < -4;
          return (
            <div key={s.key} className="py-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground/90">{s.label}</span>
                <span className="font-mono text-[10px] tnum">
                  <span className={cn("font-semibold", potentiated ? "text-up" : depressed ? "text-down" : "text-muted-foreground")}>
                    ×{s.strength.toFixed(2)}
                  </span>
                  <span className="ml-1.5 text-muted-foreground">
                    {s.activations > 0 ? `${Math.round(s.hitRate * 100)}% / ${s.activations}` : "dormant"}
                  </span>
                </span>
              </div>
              <div className="relative mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="absolute inset-y-0 left-1/2 z-10 w-px bg-border" />
                {drift >= 0 ? (
                  <div
                    className="absolute inset-y-0 left-1/2 rounded-r-full bg-up transition-all duration-700"
                    style={{ width: `${Math.min(50, Math.abs(drift) * 0.55)}%` }}
                  />
                ) : (
                  <div
                    className="absolute inset-y-0 right-1/2 rounded-l-full bg-down transition-all duration-700"
                    style={{ width: `${Math.min(50, Math.abs(drift) * 0.55)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
        Potentiated synapses (LTP, green) push the forecast · depressed synapses (LTD, red) are discounted.
        Trained on {neuro.graded} settled rounds.
      </p>
    </Panel>
  );
}

/** Wall Street Playbook — rules from history's greatest trades, live-checked every round. */
function PlaybookSection() {
  const { nextRound } = useMarket();
  const fired = nextRound?.playbook.fired ?? [];
  const firedIds = new Set(fired.map((f) => f.id));
  const dormant = PLAYBOOK.filter((r) => !firedIds.has(r.id));
  // Dedupe dormant legends (Livermore appears twice).
  const dormantLegends = Array.from(new Set(dormant.map((r) => r.legend)));

  return (
    <Panel
      title="Wall Street Playbook"
      icon={Landmark}
      right={
        <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {fired.length} rule{fired.length === 1 ? "" : "s"} live
        </span>
      }
    >
      {fired.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          No legend's rule applies to the current tape — the standard gates govern this round.
        </p>
      ) : (
        <div className="space-y-2.5">
          {fired.map((f) => {
            const meta = STANCE_META[f.stance];
            return (
              <div key={f.id} className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{f.legend}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide", meta.className)}>
                    {meta.label}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{f.trade}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground/85">{f.note}</p>
              </div>
            );
          })}
        </div>
      )}

      {dormantLegends.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Watching the tape</div>
          <div className="flex flex-wrap gap-1.5">
            {dormantLegends.map((l) => (
              <span key={l} className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2.5 font-mono text-[9px] uppercase leading-relaxed tracking-wide text-muted-foreground">
        A veto from any legend hard-blocks the entry — the greatest traders survived by what they refused to do.
      </p>
    </Panel>
  );
}

/** Trader's Mind — the neuroplasticity brain plus the Wall Street Playbook. */
export default function MindPanel() {
  return (
    <>
      <NeuroSection />
      <PlaybookSection />
    </>
  );
}
