import { AlarmClock, CandlestickChart, History, LayoutDashboard, RotateCcw, Wifi, WifiOff, Zap } from "lucide-react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";


import {
  AlertsPanel,
  AssistantPanel,
  BollingerPanel,
  CorrelationPanel,
  FifthDimensionPanel,
  MomentumPanel,
  PriceActionPanel,
  SmcPanel,
  TrendPanel,
  VolumePanel,
  VwapPanel,
} from "@/components/EnginePanels";
import HeroPanel from "@/components/HeroPanel";
import HistoryTab from "@/components/HistoryTab";
import LearningPanel from "@/components/LearningPanel";
import MindPanel from "@/components/MindPanel";
import NextRoundPanel from "@/components/NextRoundPanel";
import PositionPanel from "@/components/PositionPanel";
import PriceChart from "@/components/PriceChart";
import RegimeClockTab from "@/components/RegimeClockTab";
import ReplayTab from "@/components/ReplayTab";
import TripleCandleTab from "@/components/TripleCandleTab";
import { useMarket } from "@/hooks/useMarket";
import { COIN_IDS } from "@/lib/coins";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "live" | "regime" | "history" | "candles" | "replay";

const TABS: { id: Tab; label: string; short: string; icon: LucideIcon }[] = [
  { id: "live", label: "Live", short: "Live", icon: LayoutDashboard },
  { id: "regime", label: "Regime Clock", short: "Regime", icon: AlarmClock },
  { id: "history", label: "Edge Analyzer", short: "Edge", icon: History },
  { id: "candles", label: "3-Candle Analyzer", short: "3-Candle", icon: CandlestickChart },
  { id: "replay", label: "Round Replay", short: "Replay", icon: RotateCcw },
];

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6">
      <div className="relative">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10">
          <Zap className="h-8 w-8 animate-blink text-primary" />
        </div>
        <div className="absolute -inset-2 -z-10 rounded-3xl bg-primary/10 blur-xl" />
      </div>
      <div className="text-center">
        <h1 className="font-display text-lg font-bold tracking-[0.2em]">
          PREDICTION EDGE <span className="text-primary">AI</span>
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Streaming Binance market data · replaying 500+ historical rounds…
        </p>
      </div>
      <div className="h-1 w-56 overflow-hidden rounded-full bg-secondary">
        <div className="h-full w-1/3 animate-[loading-slide_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <style>{`@keyframes loading-slide { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }`}</style>
    </div>
  );
}

function ErrorScreen({ retry }: { retry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="h-10 w-10 text-down" />
      <h1 className="font-display text-lg font-bold tracking-widest">MARKET DATA UNAVAILABLE</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Could not reach any market data source. Check your connection and try again.
      </p>
      <button
        onClick={retry}
        className="rounded-lg border border-primary/40 bg-primary/10 px-5 py-2 font-display text-sm font-bold tracking-widest text-primary transition-colors hover:bg-primary/20"
      >
        RETRY
      </button>
    </div>
  );
}

function LiveTab() {
  const { candles, round } = useMarket();
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-8">
        <NextRoundPanel />
        <PositionPanel />
        <HeroPanel />
        <PriceChart candles={candles} lockPrice={round?.lockPrice ?? null} />
        <AssistantPanel />
        <div className="grid gap-3 sm:grid-cols-2">
          <PriceActionPanel />
          <VolumePanel />
          <TrendPanel />
          <MomentumPanel />
          <VwapPanel />
          <BollingerPanel />
        </div>
      </div>
      <div className="space-y-3 lg:col-span-4">
        <FifthDimensionPanel />
        <MindPanel />
        <LearningPanel />
        <SmcPanel />
        <CorrelationPanel />
        <AlertsPanel />
      </div>
    </div>
  );
}

const Index = () => {
  const { status, connected, livePrice, retry, coin, setCoin } = useMarket();
  const [tab, setTab] = useState<Tab>("live");

  if (status === "loading") return <LoadingScreen />;
  if (status === "error") return <ErrorScreen retry={retry} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-sm font-bold leading-none tracking-[0.18em]">
                PREDICTION EDGE <span className="text-primary">AI</span>
              </h1>
              <p className="mt-0.5 hidden font-mono text-[9px] uppercase tracking-widest text-muted-foreground sm:block">
                5-min {coin.id} prediction analytics
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-mono text-sm font-bold tnum">${fmtUsd(livePrice)}</div>
              <div className="font-mono text-[9px] uppercase text-muted-foreground">{coin.pair}</div>
            </div>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[9px] font-semibold uppercase",
                connected ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down",
              )}
            >
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span className="hidden sm:inline">{connected ? "Live" : "Reconnecting"}</span>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-3 pb-1.5 sm:px-4">
          <div className="flex w-full gap-1 rounded-lg border border-border bg-secondary/40 p-1 sm:w-auto sm:max-w-xs">
            {COIN_IDS.map((c) => (
              <button
                key={c}
                onClick={() => setCoin(c)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-widest transition-colors",
                  coin.id === c
                    ? "bg-primary/20 text-primary shadow-[inset_0_0_0_1px] shadow-primary/40"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto px-4 pb-2.5 pt-0.5 no-scrollbar sm:px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors",
                tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-3 pb-14 pt-3 sm:px-4">
        {tab === "live" && <LiveTab />}
        {tab === "regime" && <RegimeClockTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "candles" && <TripleCandleTab />}
        {tab === "replay" && <ReplayTab />}
      </main>

      <footer className="border-t border-border/70 py-4">
        <p className="mx-auto max-w-7xl px-4 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
          Prediction Edge AI is an analytics tool. It does not place trades, provide financial advice, or guarantee
          outcomes. Prediction markets involve significant risk.
        </p>
      </footer>
    </div>
  );
};

export default Index;
