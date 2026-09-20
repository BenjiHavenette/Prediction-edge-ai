import { Brain, FileUp, Swords, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Panel } from "@/components/bits";
import { useMarket } from "@/hooks/useMarket";
import { cn } from "@/lib/utils";

function AuditStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "up" | "down" | "primary" | "muted" }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/40 p-3">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-display text-lg font-bold tnum",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "primary" && "text-primary",
          tone === "muted" && "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="font-mono text-[9px] text-muted-foreground">{sub}</div>
    </div>
  );
}

/**
 * PancakeSwap history CSV importer: feeds real settled rounds (with Chainlink
 * lock/close prices) into the learning + neuroplasticity engines and grades
 * the user's own betting record against the model.
 */
export default function ImportPanel() {
  const { importAudit, importCsvData, records, coin } = useMarket();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const youVsEngine = useMemo(() => {
    const mine = records.filter((r) => r.imported && r.userSide !== undefined && r.result !== "FLAT");
    let yourWins = 0;
    let engineDecided = 0;
    let engineWins = 0;
    let agreed = 0;
    for (const r of mine) {
      if (r.userSide === r.result) yourWins++;
      const call = r.rawRecommendation ?? r.recommendation;
      if (call === "WAIT") continue;
      engineDecided++;
      if (call === r.result) engineWins++;
      if (call === r.userSide) agreed++;
    }
    return {
      graded: mine.length,
      yourRate: mine.length > 0 ? (yourWins / mine.length) * 100 : 0,
      engineDecided,
      engineRate: engineDecided > 0 ? (engineWins / engineDecided) * 100 : 0,
      agreed,
    };
  }, [records]);

  const handleFile = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const text = await file.text();
      const res = importCsvData(text);
      setMessage(res.message);
      setFailed(!res.ok);
      toast(res.ok ? "History imported" : "Import failed", { description: res.message });
    } catch {
      setMessage("Could not read that file — make sure it's the CSV exported from PancakeSwap.");
      setFailed(true);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Panel
      title="Import Your PancakeSwap History"
      icon={FileUp}
      right={
        importAudit !== null ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            last import · {new Date(importAudit.importedAt).toLocaleDateString()} · {importAudit.rows} rounds
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {busy ? "Importing…" : "Import CSV Export"}
        </button>
        <p className="min-w-[200px] flex-1 text-[10px] leading-relaxed text-muted-foreground">
          Export your round history from PancakeSwap Predictions ({coin.id} market) and load it here. Every settled
          round is replayed through the engine with its <span className="text-foreground/80">real Chainlink lock and close prices</span> and
          becomes a training sample — the adaptive weights and the neuro brain retrain on your actual rounds.
        </p>
      </div>

      {message !== null && (
        <p className={cn("mt-3 rounded-lg border px-3 py-2 font-mono text-[10px] leading-relaxed", failed ? "border-down/40 bg-down/10 text-down" : "border-up/40 bg-up/10 text-up")}>
          {message}
        </p>
      )}

      {importAudit !== null && importAudit.bets > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Swords className="h-3 w-3 text-primary" /> Your Betting Record
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AuditStat
              label="Your Win Rate"
              value={importAudit.wins + importAudit.losses > 0 ? `${importAudit.winRate.toFixed(1)}%` : "—"}
              sub={`${importAudit.wins}W – ${importAudit.losses}L${importAudit.flats > 0 ? ` – ${importAudit.flats} flat` : ""}`}
              tone={importAudit.winRate >= 51.3 ? "up" : "down"}
            />
            <AuditStat
              label="UP Side"
              value={importAudit.upBets > 0 ? `${((importAudit.upWins / importAudit.upBets) * 100).toFixed(0)}%` : "—"}
              sub={`${importAudit.upWins}/${importAudit.upBets} UP bets won`}
              tone={importAudit.upBets > 0 && importAudit.upWins / importAudit.upBets >= 0.5 ? "up" : "down"}
            />
            <AuditStat
              label="DOWN Side"
              value={importAudit.downBets > 0 ? `${((importAudit.downWins / importAudit.downBets) * 100).toFixed(0)}%` : "—"}
              sub={`${importAudit.downWins}/${importAudit.downBets} DOWN bets won`}
              tone={importAudit.downBets > 0 && importAudit.downWins / importAudit.downBets >= 0.5 ? "up" : "down"}
            />
            <AuditStat
              label="Est. PnL"
              value={`${importAudit.estPnl >= 0 ? "+" : ""}${importAudit.estPnl.toFixed(3)}`}
              sub={`${importAudit.totalWagered.toFixed(3)} wagered · streaks +${importAudit.bestStreak}/−${importAudit.worstStreak}`}
              tone={importAudit.estPnl >= 0 ? "up" : "down"}
            />
          </div>
        </div>
      )}

      {importAudit !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3">
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Brain className="h-3 w-3 text-primary" />
            <span className="font-bold text-foreground tnum">{importAudit.matchedRecords}</span> rounds injected as training data
          </span>
          {youVsEngine.graded >= 5 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              You vs Engine on your bet rounds:{" "}
              <span className={cn("font-bold tnum", youVsEngine.yourRate >= youVsEngine.engineRate ? "text-up" : "text-down")}>
                you {youVsEngine.yourRate.toFixed(0)}%
              </span>
              {" · "}
              <span className={cn("font-bold tnum", youVsEngine.engineRate >= youVsEngine.yourRate ? "text-up" : "text-down")}>
                engine {youVsEngine.engineRate.toFixed(0)}%
              </span>
              {youVsEngine.engineDecided > 0 && ` · agreed on ${youVsEngine.agreed}/${youVsEngine.engineDecided}`}
            </span>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            UP outcome share in file: <span className="font-bold text-foreground tnum">{importAudit.upOutcomeShare.toFixed(1)}%</span>
          </span>
        </div>
      )}
    </Panel>
  );
}
