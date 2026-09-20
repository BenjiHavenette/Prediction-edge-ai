/**
 * Wall Street Playbook — discipline distilled from history's greatest trades,
 * encoded as live rules the engine checks before every entry.
 *
 * Each rule carries the legend, the trade that proved it, and the principle.
 * Rules can VETO an entry (hard block), grant CONVICTION (everything a legend
 * would want is present), or add CAUTION/HONOR context. The engine never
 * overrides a veto — the greatest traders survived by what they refused to do.
 */

import type { HtfAlignment, RegimeKind } from "./regime";

export type PlaybookStance = "veto" | "conviction" | "caution" | "honor";

export interface PlaybookRule {
  id: string;
  legend: string;
  /** The trade or era that proved the principle. */
  trade: string;
  principle: string;
}

export interface FiredRule extends PlaybookRule {
  stance: PlaybookStance;
  /** Live, context-specific explanation of why the rule fired. */
  note: string;
}

export interface PlaybookContext {
  regimeKind: RegimeKind;
  alignment: HtfAlignment | null;
  /** Final adjusted UP probability (0..100). */
  upProb: number;
  confidence: number;
  /** Side the gates currently favor, if any. */
  side: "UP" | "DOWN" | null;
  evUp: number;
  evDown: number;
  payoutUp: number | null;
  payoutDown: number | null;
  cold: boolean;
  coldHitRate: number;
  /** Model's consecutive wrong directional calls, most recent first. */
  lossStreak: number;
  consecGreen: number;
  consecRed: number;
  /** Audited hit rate of the bettable condition (percent), null when unknown. */
  auditHitRatePct: number | null;
  auditRounds: number;
}

/** The full playbook, for display even when rules are dormant. */
export const PLAYBOOK: PlaybookRule[] = [
  {
    id: "livermore-sit",
    legend: "Jesse Livermore",
    trade: "1929 crash short — $100M",
    principle: "The big money is in the sitting, not the trading. Ride the confirmed trend; never fade it.",
  },
  {
    id: "livermore-average",
    legend: "Jesse Livermore",
    trade: "Boy Plunger's iron rule",
    principle: "Never average losses. A losing streak means the read is wrong — stop, don't double down.",
  },
  {
    id: "ptj-asymmetry",
    legend: "Paul Tudor Jones",
    trade: "Black Monday 1987 — +126%",
    principle: "5:1 asymmetry or nothing. Defense first: the most important rule is to play great defense.",
  },
  {
    id: "soros-conviction",
    legend: "Soros & Druckenmiller",
    trade: "1992 GBP short — $1B in a day",
    principle: "When everything lines up, go for the jugular. It takes courage to be a pig — but only then.",
  },
  {
    id: "simons-edge",
    legend: "Jim Simons",
    trade: "Medallion — 66%/yr for 30 years",
    principle: "Trade only the statistics. If the audited edge isn't there, the narrative doesn't matter.",
  },
  {
    id: "taleb-tail",
    legend: "Nassim Taleb",
    trade: "1987 & 2008 tail hedges",
    principle: "Never cross a river that is on average four feet deep. Violent, directionless tape is untradeable.",
  },
  {
    id: "seykota-bend",
    legend: "Ed Seykota",
    trade: "250,000% over 16 years",
    principle: "The trend is your friend except at the end where it bends. Don't chase an exhausted run.",
  },
  {
    id: "paulson-crowd",
    legend: "John Paulson",
    trade: "2007 subprime short — $15B",
    principle: "The greatest trades are against the crowd — when the numbers, not the mood, say the crowd is wrong.",
  },
  {
    id: "druckenmiller-capital",
    legend: "Stanley Druckenmiller",
    trade: "30 years, no losing year",
    principle: "Preserve capital when out of sync; swing hard only when in sync. Being cold is a signal, not bad luck.",
  },
  {
    id: "buffett-pitch",
    legend: "Warren Buffett",
    trade: "The fat-pitch doctrine",
    principle: "There are no called strikes in this game. Waiting costs nothing; swinging at noise costs everything.",
  },
];

export interface PlaybookResult {
  fired: FiredRule[];
  /** The first hard-blocking rule, if any. */
  veto: FiredRule | null;
  /** True when the Soros/Druckenmiller conviction condition is met. */
  conviction: boolean;
}

const rule = (id: string): PlaybookRule => {
  const r = PLAYBOOK.find((p) => p.id === id);
  if (!r) throw new Error(`Unknown playbook rule ${id}`);
  return r;
};

/** Evaluates every legend's rule against the live round context. */
export function evaluatePlaybook(ctx: PlaybookContext): PlaybookResult {
  const fired: FiredRule[] = [];
  const trending = ctx.regimeKind === "trend-up" || ctx.regimeKind === "trend-down";
  const sideProb = ctx.side === "UP" ? ctx.upProb : ctx.side === "DOWN" ? 100 - ctx.upProb : Math.max(ctx.upProb, 100 - ctx.upProb);
  const sideEv = ctx.side === "UP" ? ctx.evUp : ctx.side === "DOWN" ? ctx.evDown : Math.max(ctx.evUp, ctx.evDown);
  const sidePayout = ctx.side === "UP" ? ctx.payoutUp : ctx.side === "DOWN" ? ctx.payoutDown : null;

  // Livermore: never average losses.
  if (ctx.lossStreak >= 3) {
    fired.push({
      ...rule("livermore-average"),
      stance: "veto",
      note: `The model has been wrong ${ctx.lossStreak} calls in a row. Livermore's rule: a losing streak means the read is wrong — entries are blocked until a call lands.`,
    });
  }

  // Druckenmiller: cold means out of sync — preserve capital.
  if (ctx.cold && ctx.lossStreak < 3) {
    fired.push({
      ...rule("druckenmiller-capital"),
      stance: "caution",
      note: `Model is cold (${Math.round(ctx.coldHitRate * 100)}% recently). Druckenmiller sized down to near-zero when out of sync — every entry bar is raised.`,
    });
  }

  // Seykota: don't chase an exhausted run.
  if (ctx.side !== null) {
    const run = ctx.side === "UP" ? ctx.consecGreen : ctx.consecRed;
    if (run >= 6) {
      fired.push({
        ...rule("seykota-bend"),
        stance: "veto",
        note: `${run} consecutive ${ctx.side === "UP" ? "green" : "red"} candles — this is the end where the trend bends. Chasing the ${run + 1}th candle is where trend followers give profits back.`,
      });
    } else if (run === 5) {
      fired.push({
        ...rule("seykota-bend"),
        stance: "caution",
        note: `${run} straight ${ctx.side === "UP" ? "green" : "red"} candles — exhaustion territory. The entry stands, but this is late in the move.`,
      });
    }
  }

  // Paul Tudor Jones: no asymmetry, no trade.
  if (ctx.side !== null && sidePayout !== null && sidePayout < 1.7) {
    fired.push({
      ...rule("ptj-asymmetry"),
      stance: "veto",
      note: `The ${ctx.side} side only pays ${sidePayout.toFixed(2)}x — the crowd is already stacked on it. PTJ never took a trade without asymmetry; risking 1 to win ${(sidePayout - 1).toFixed(2)} isn't it.`,
    });
  }

  // Simons: no statistical edge, no trade — regardless of the story.
  if (ctx.auditHitRatePct !== null && ctx.auditRounds >= 12 && ctx.auditHitRatePct < 50) {
    fired.push({
      ...rule("simons-edge"),
      stance: "veto",
      note: `The audited bettable condition graded only ${ctx.auditHitRatePct.toFixed(0)}% over ${ctx.auditRounds} rounds on this tape. Simons' rule: no statistics, no trade — the narrative is irrelevant.`,
    });
  }

  // Taleb: storm tape is the four-foot-deep river.
  if (ctx.regimeKind === "storm") {
    fired.push({
      ...rule("taleb-tail"),
      stance: "honor",
      note: "Storm regime — violent swings with no direction. This is exactly the tape that blows accounts up; standing aside IS the trade.",
    });
  }

  // Buffett: patience while the tape offers nothing.
  if (ctx.regimeKind === "chop") {
    fired.push({
      ...rule("buffett-pitch"),
      stance: "honor",
      note: "Chop regime — no fat pitch on offer. There are no called strikes here; waiting costs nothing.",
    });
  }

  // Livermore: ride the confirmed trend.
  if (trending && ctx.alignment === "aligned") {
    fired.push({
      ...rule("livermore-sit"),
      stance: "honor",
      note: `Confirmed ${ctx.regimeKind === "trend-up" ? "up" : "down"}trend with the 15m frame agreeing — the sitting condition. Bets go WITH this move only.`,
    });
  }

  // Paulson: paid to be right against the crowd.
  if (ctx.side !== null && sidePayout !== null && sidePayout >= 2.3 && sideProb >= 62) {
    fired.push({
      ...rule("paulson-crowd"),
      stance: "conviction",
      note: `The crowd is on the other side — ${ctx.side} pays ${sidePayout.toFixed(2)}x while the model gives it ${Math.round(sideProb)}%. This is the Paulson setup: the numbers against the mood.`,
    });
  }

  // Soros/Druckenmiller: everything lines up — conviction.
  if (trending && ctx.alignment === "aligned" && ctx.side !== null && sideProb >= 66 && sideEv >= 0.1 && !ctx.cold && ctx.lossStreak < 2) {
    fired.push({
      ...rule("soros-conviction"),
      stance: "conviction",
      note: `Regime, 15m frame, probability (${Math.round(sideProb)}%) and EV (+${(sideEv * 100).toFixed(1)}%) all agree, and the model is in sync. This is the rare go-for-the-jugular alignment.`,
    });
  }

  const veto = fired.find((f) => f.stance === "veto") ?? null;
  const conviction = fired.some((f) => f.stance === "conviction");
  return { fired, veto, conviction };
}
