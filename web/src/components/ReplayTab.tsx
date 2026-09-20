import { Check, ListVideo, RotateCcw, Target, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Panel, ScoreBar, StatRow } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { fmtDateTime, fmtPct, fmtUsd } from "@/lib/format";
import type { RoundRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORY_META: { key: keyof RoundRecord["snapshot"]["categories"]; label: string; weight: string }[] = [
  { key: "trend", label: "Trend Analysis", weight: "25%" },
  { key: "momentum", label: "Momentum Analysis", weight: "20%" },
  { key: "volume", label: "Volume Analysis", weight: "20%" },
  { key: "structure", label: "Market Structure", weight: "15%" },
  { key: "confluence", label: "Indicator Confluence", weight: "20%" },
];

function verdictOf(r: RoundRecord): { label: string; tone: "up" | "down" | "warn" } {
  if (r.recommendation === "WAIT") {
    const gated = r.rawRecommendation !== undefined && r.rawRecommendation !== "WAIT";
    if (gated) {
      return {
        label: `GATED — indicators leaned ${r.rawRecommendation} but the regime wasn't a confirmed trend, so no call was logged`,
        tone: "warn",
      };
    }
    return { label: "NO CALL — model recommended waiting", tone: "warn" };
  }
  if (r.result === "FLAT") return { label: "FLAT round — no winner", tone: "warn" };
  return r.result === r.recommendation
    ? { label: `AI WAS RIGHT — called ${r.recommendation}, closed ${r.result}`, tone: "up" }
    : { label: `AI WAS WRONG — called ${r.recommendation}, closed ${r.result}`, tone: "down" };
}

function ReplayDetail({ r }: { r: RoundRecord }) {
  const s = r.snapshot;
  const verdict = verdictOf(r);
  return (
    <Panel
      title={`Round Replay · #${Math.floor(r.startTime / 300000)}`}
      icon={RotateCcw}
      right={<span className="font-mono text-[10px] text-muted-foreground">{fmtDateTime(r.startTime)}</span>}
    >
      <div
        className={cn(
          "mb-4 rounded-lg border px-3 py-2 text-center font-display text-xs font-bold tracking-wider",
          verdict.tone === "up" && "border-up/40 bg-up/10 text-up",
          verdict.tone === "down" && "border-down/40 bg-down/10 text-down",
          verdict.tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
        )}
      >
        {verdict.label}
      </div>

      {r.regimeLabel !== undefined && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-1.5">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Regime at lock</span>
          <span
            className={cn(
              "font-mono text-[10px] font-bold",
              r.regimeKind === "trend-up" && "text-up",
              r.regimeKind === "trend-down" && "text-down",
              (r.regimeKind === "chop" || r.regimeKind === "storm") && "text-warn",
            )}
          >
            {r.regimeLabel}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
        <StatRow label="Lock" value={`$${fmtUsd(r.lockPrice)}`} />
        <StatRow label="Close" value={`$${fmtUsd(r.closePrice)}`} />
        <StatRow label="Move" value={fmtPct(r.movePct, 3)} valueClass={r.movePct >= 0 ? "text-up" : "text-down"} />
        <StatRow
          label="Result"
          value={r.result}
          valueClass={r.result === "UP" ? "text-up" : r.result === "DOWN" ? "text-down" : "text-warn"}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg bg-secondary/50 p-3">
        <div className="text-center">
          <div className="font-display text-xl font-bold text-up tnum">{r.predictedUp}%</div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Predicted UP</div>
        </div>
        <div className="text-center">
          <div className="font-display text-xl font-bold text-down tnum">{100 - r.predictedUp}%</div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Predicted DOWN</div>
        </div>
        <div className="text-center">
          <div className="font-display text-xl font-bold text-primary tnum">{r.confidence}%</div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Confidence</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Weighted category scores at lock
        </div>
        <div className="space-y-2.5">
          {CATEGORY_META.map((c) => {
            const v = s.categories[c.key];
            return (
              <div key={c.key}>
                <div className="mb-1 flex justify-between font-mono text-[10px]">
                  <span className="text-muted-foreground">
                    {c.label} <span className="text-muted-foreground/60">· {c.weight}</span>
                  </span>
                  <span className={cn("tnum", v >= 0 ? "text-up" : "text-down")}>{v > 0 ? `+${v}` : v}</span>
                </div>
                <ScoreBar value={v} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 border-t border-border/60 pt-3 sm:grid-cols-3">
        <StatRow label="RSI" value={s.rsi.toFixed(1)} valueClass={s.rsi >= 60 ? "text-up" : s.rsi <= 40 ? "text-down" : undefined} />
        <StatRow label="Stoch RSI" value={s.stochRsi.toFixed(0)} />
        <StatRow label="MACD Hist" value={s.macdHist.toFixed(2)} valueClass={s.macdHist >= 0 ? "text-up" : "text-down"} />
        <StatRow label="Rel. Volume" value={`${s.volumeRelative.toFixed(2)}x`} valueClass={s.volumeSpike ? "text-warn" : undefined} />
        <StatRow label="Buy Pressure" value={`${s.bullPressure.toFixed(0)}%`} valueClass={s.bullPressure >= 50 ? "text-up" : "text-down"} />
        <StatRow label="EMAs Above" value={`${s.emaAboveCount}/4`} />
        <StatRow label="EMA Cross" value={s.emaCross ?? "none"} valueClass={s.emaCross === "golden" ? "text-up" : s.emaCross === "death" ? "text-down" : undefined} />
        <StatRow label="VWAP Side" value={s.vwapSide} valueClass={s.vwapSide === "above" ? "text-up" : "text-down"} />
        <StatRow label="BB Event" value={s.bbEvent ?? "none"} />
        <StatRow label="Green Streak" value={String(s.consecGreen)} valueClass="text-up" />
        <StatRow label="Red Streak" value={String(s.consecRed)} valueClass="text-down" />
        <StatRow label="Exp. Move" value={`±${s.expectedMovePct.toFixed(3)}%`} />
      </div>

      {(s.patterns.length > 0 || s.smc.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
          {s.patterns.map((p) => (
            <span key={p} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              {p}
            </span>
          ))}
          {s.smc.map((p) => (
            <span key={p} className="rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 font-mono text-[10px] text-warn">
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border/60 bg-secondary/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">AI reasoning at lock</div>
        <p className="text-xs leading-relaxed text-foreground/90">{s.narrative}</p>
      </div>
    </Panel>
  );
}

/** Round Replay: review any past round and see exactly why the AI predicted UP or DOWN. */
export default function ReplayTab() {
  const { records } = useMarket();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [limit, setLimit] = useState<number>(60);

  const rows = useMemo(() => records.slice().reverse(), [records]);
  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  const last10 = useMemo(() => {
    const decided = rows.filter((r) => r.recommendation !== "WAIT" && r.result !== "FLAT").slice(0, 10);
    const correct = decided.filter((r) => r.result === r.recommendation).length;
    return {
      total: decided.length,
      correct,
      pct: decided.length > 0 ? Math.round((correct / decided.length) * 100) : null,
    };
  }, [rows]);

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="lg:col-span-12">
        <div className="flex items-center justify-between rounded-xl border border-down/40 bg-down/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-down" />
            <div>
              <span className="font-display text-xs font-bold uppercase tracking-widest text-foreground/90">
                Last 10 Accuracy
              </span>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                trend-regime calls only
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="font-display text-2xl font-bold text-down tnum">
              {last10.pct !== null ? `${last10.pct}%` : "—"}
            </span>
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground tnum">
              {last10.total > 0 ? `${last10.correct}/${last10.total} calls correct` : "no decided calls yet"}
            </div>
          </div>
        </div>
      </div>
      <div className="lg:col-span-7">{selected ? <ReplayDetail r={selected} /> : null}</div>
      <div className="lg:col-span-5">
        <Panel
          title="Completed Rounds"
          icon={ListVideo}
          right={<span className="font-mono text-[10px] text-muted-foreground tnum">{records.length} stored</span>}
        >
          <div className="max-h-[560px] space-y-1 overflow-y-auto pr-1">
            {rows.slice(0, limit).map((r) => {
              const correct = r.recommendation !== "WAIT" && r.result !== "FLAT" ? r.result === r.recommendation : null;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    selected?.id === r.id ? "bg-primary/10 ring-1 ring-primary/40" : "bg-secondary/50 hover:bg-secondary",
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-muted-foreground">{fmtDateTime(r.startTime)}</div>
                    <div className="font-mono text-[10px] tnum">
                      <span className={cn(r.movePct >= 0 ? "text-up" : "text-down")}>{fmtPct(r.movePct, 3)}</span>
                      {r.live && <span className="ml-1.5 text-primary">LIVE</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold",
                        r.recommendation === "UP" && "bg-up/15 text-up",
                        r.recommendation === "DOWN" && "bg-down/15 text-down",
                        r.recommendation === "WAIT" && "bg-warn/15 text-warn",
                      )}
                    >
                      {r.recommendation}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold",
                        r.result === "UP" && "bg-up/15 text-up",
                        r.result === "DOWN" && "bg-down/15 text-down",
                        r.result === "FLAT" && "bg-warn/15 text-warn",
                      )}
                    >
                      {r.result}
                    </span>
                    {correct === true && <Check className="h-3.5 w-3.5 text-up" />}
                    {correct === false && <X className="h-3.5 w-3.5 text-down" />}
                  </div>
                </button>
              );
            })}
          </div>
          {limit < rows.length && (
            <button
              onClick={() => setLimit((l) => l + 60)}
              className="mt-2 w-full rounded-lg border border-border py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              LOAD MORE ({rows.length - limit} remaining)
            </button>
          )}
        </Panel>
      </div>
    </div>
  );
}
