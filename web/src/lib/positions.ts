export type PositionSide = "UP" | "DOWN";

/**
 * Lifecycle of a user-logged position:
 * pending → live (round locked) → won | lost | flat (settled).
 * void = the app missed the settlement window (tab closed / chain sync changed).
 */
export type PositionStatus = "pending" | "live" | "won" | "lost" | "flat" | "void";

/** A position the user manually locked in on PancakeSwap and logged in the app. */
export interface UserPosition {
  id: string;
  /** PancakeSwap epoch (or synthetic round number when chain sync is down). */
  epoch: number;
  side: PositionSide;
  /** Stake in BNB, null when the user didn't specify one. */
  amountBnb: number | null;
  enteredAt: number;
  /** Payout multiplier snapshot for the chosen side at log time. */
  payoutAtEntry: number | null;
  /** Model forecast snapshot at log time. */
  modelUpProb: number | null;
  modelAction: string | null;
  regimeLabel: string | null;
  /** True when the engine's gated side matched this entry (null = engine had no side). */
  agreesWithModel: boolean | null;
  status: PositionStatus;
  /** Round start time once the position goes live. */
  startTime: number | null;
  lockPrice: number | null;
  closePrice: number | null;
  settledAt: number | null;
  /** Realized PnL in BNB (null when no stake was logged). */
  pnlBnb: number | null;
}

export interface PositionStats {
  settled: number;
  wins: number;
  losses: number;
  flats: number;
  /** Wins over all settled entries (0..1). */
  hitRate: number;
  /** Positive = current winning streak, negative = losing streak. */
  streak: number;
  /** Net realized PnL in BNB across entries with a known stake (null when none). */
  netPnlBnb: number | null;
  withModel: { wins: number; total: number };
  againstModel: { wins: number; total: number };
}

const STORAGE_KEY = "pe-user-positions-v1";
const MAX_STORED = 200;

/** Loads logged positions from localStorage for one coin. */
export function loadPositions(storageSuffix: string = ""): UserPosition[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}${storageSuffix}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserPosition[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p?.epoch === "number" && (p.side === "UP" || p.side === "DOWN"));
  } catch {
    return [];
  }
}

/** Persists logged positions to localStorage for one coin. */
export function savePositions(positions: UserPosition[], storageSuffix: string = ""): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}${storageSuffix}`, JSON.stringify(positions.slice(-MAX_STORED)));
  } catch {
    // Storage unavailable (private mode / quota) — tracking continues in memory.
  }
}

const isSettled = (p: UserPosition): boolean => p.status === "won" || p.status === "lost" || p.status === "flat";

/** Aggregates the user's settled positions into a session record. */
export function computePositionStats(positions: UserPosition[]): PositionStats {
  const settled = positions.filter(isSettled);
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let netPnl = 0;
  let pnlKnown = false;
  let withWins = 0;
  let withTotal = 0;
  let againstWins = 0;
  let againstTotal = 0;

  for (const p of settled) {
    if (p.status === "won") wins++;
    else if (p.status === "lost") losses++;
    else flats++;
    if (p.pnlBnb !== null) {
      netPnl += p.pnlBnb;
      pnlKnown = true;
    }
    if (p.agreesWithModel === true) {
      withTotal++;
      if (p.status === "won") withWins++;
    } else if (p.agreesWithModel === false) {
      againstTotal++;
      if (p.status === "won") againstWins++;
    }
  }

  let streak = 0;
  for (let i = settled.length - 1; i >= 0; i--) {
    const won = settled[i].status === "won";
    if (streak === 0) streak = won ? 1 : -1;
    else if (streak > 0 && won) streak++;
    else if (streak < 0 && !won) streak--;
    else break;
  }

  return {
    settled: settled.length,
    wins,
    losses,
    flats,
    hitRate: settled.length > 0 ? wins / settled.length : 0,
    streak,
    netPnlBnb: pnlKnown ? netPnl : null,
    withModel: { wins: withWins, total: withTotal },
    againstModel: { wins: againstWins, total: againstTotal },
  };
}
