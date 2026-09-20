/**
 * PancakeSwap history import — turns the CSV the user exports from
 * pancakeswap.finance (Round, Result, Your Position, Bet Amount, Lock Price,
 * Close Price, …) into training data:
 *
 * 1. Every parsed round with a lock & close price is anchored to the on-chain
 *    round schedule and, where the local candle tape covers it, replayed
 *    through the full prediction engine (no lookahead) so the learning and
 *    neuroplasticity layers train on REAL settled rounds with REAL Chainlink
 *    lock/close prices instead of Binance approximations.
 * 2. Rounds where the user actually bet are graded into a personal audit —
 *    win rate, side bias, wagered, estimated PnL, streaks — persisted per coin.
 */

export interface ImportedRow {
  epoch: number;
  result: "UP" | "DOWN" | "FLAT" | null;
  position: "UP" | "DOWN" | null;
  betAmount: number | null;
  lockPrice: number | null;
  closePrice: number | null;
  totalBets: number | null;
  totalAmount: number | null;
  failed: boolean;
}

export interface ImportAudit {
  importedAt: number;
  /** Data rows parsed from the file. */
  rows: number;
  /** Rows whose outcome could be decided (result or prices present). */
  decided: number;
  /** Rounds that matched the candle tape and were injected as training records. */
  matchedRecords: number;
  /** Rows where the user had a position. */
  bets: number;
  wins: number;
  losses: number;
  flats: number;
  /** User win rate over decided bets, 0..100. */
  winRate: number;
  upBets: number;
  upWins: number;
  downBets: number;
  downWins: number;
  /** Total staked across all bets (same unit as the export, usually BNB). */
  totalWagered: number;
  /** Estimated PnL assuming a 1.95x payout on wins; flats lose the stake. */
  estPnl: number;
  bestStreak: number;
  worstStreak: number;
  /** Share of decided rounds in the file that closed UP, 0..100. */
  upOutcomeShare: number;
}

export interface ImportOutcome {
  ok: boolean;
  parsed: number;
  matched: number;
  message: string;
  audit: ImportAudit | null;
}

/** Splits one CSV line respecting double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const cleaned = v.replace(/[^0-9.eE+-]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSide(v: string | undefined): "UP" | "DOWN" | null {
  if (v === undefined) return null;
  if (/up|bull|long/i.test(v)) return "UP";
  if (/down|bear|short/i.test(v)) return "DOWN";
  return null;
}

function parseResult(v: string | undefined, position: "UP" | "DOWN" | null): "UP" | "DOWN" | "FLAT" | null {
  if (v === undefined) return null;
  const side = parseSide(v);
  if (side !== null) return side;
  if (/flat|draw|tie|house/i.test(v)) return "FLAT";
  // Some exports grade the row relative to the user's position ("Win"/"Loss").
  if (/win|won/i.test(v)) return position;
  if (/lo(se|st|ss)/i.test(v)) return position === "UP" ? "DOWN" : position === "DOWN" ? "UP" : null;
  return null;
}

/**
 * Parses a PancakeSwap Predictions history CSV export.
 * Column order is detected from the header row, so partial exports work too.
 */
export function parsePancakeCsv(text: string): ImportedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string): number => header.findIndex((h) => h.includes(name));
  const iRound = col("round");
  const iResult = col("result");
  const iPosition = col("position");
  const iBet = col("bet amount");
  const iLock = col("lock price");
  const iClose = col("close price");
  const iTotalBets = col("total bets");
  const iTotalAmount = col("total amount");
  const iFailed = col("failed");
  if (iRound < 0) return [];

  const rows: ImportedRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const epoch = parseNum(cells[iRound]);
    if (epoch === null || epoch <= 0 || !Number.isInteger(epoch)) continue;
    const position = iPosition >= 0 ? parseSide(cells[iPosition]) : null;
    const lockPrice = iLock >= 0 ? parseNum(cells[iLock]) : null;
    const closePrice = iClose >= 0 ? parseNum(cells[iClose]) : null;
    // Prefer the price-derived result — it is unambiguous.
    let result: "UP" | "DOWN" | "FLAT" | null = null;
    if (lockPrice !== null && closePrice !== null && lockPrice > 0 && closePrice > 0) {
      result = closePrice > lockPrice ? "UP" : closePrice < lockPrice ? "DOWN" : "FLAT";
    } else if (iResult >= 0) {
      result = parseResult(cells[iResult], position);
    }
    rows.push({
      epoch,
      result,
      position,
      betAmount: iBet >= 0 ? parseNum(cells[iBet]) : null,
      lockPrice,
      closePrice,
      totalBets: iTotalBets >= 0 ? parseNum(cells[iTotalBets]) : null,
      totalAmount: iTotalAmount >= 0 ? parseNum(cells[iTotalAmount]) : null,
      failed: iFailed >= 0 ? /true|yes|1/i.test(cells[iFailed] ?? "") : false,
    });
  }
  return rows;
}

/** Grades the user's own bets in the imported file into a persistent audit. */
export function gradeImport(rows: ImportedRow[], matchedRecords: number): ImportAudit {
  let decided = 0;
  let ups = 0;
  let bets = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let upBets = 0;
  let upWins = 0;
  let downBets = 0;
  let downWins = 0;
  let totalWagered = 0;
  let estPnl = 0;
  let streak = 0;
  let bestStreak = 0;
  let worstStreak = 0;

  // Grade chronologically (exports are usually newest-first).
  const ordered = [...rows].sort((a, b) => a.epoch - b.epoch);
  for (const r of ordered) {
    if (r.result !== null && r.result !== "FLAT") {
      decided++;
      if (r.result === "UP") ups++;
    }
    if (r.position === null || r.result === null || r.failed) continue;
    bets++;
    const stake = r.betAmount ?? 0;
    totalWagered += stake;
    if (r.result === "FLAT") {
      // PancakeSwap: the house takes flat rounds — both sides lose.
      flats++;
      estPnl -= stake;
      continue;
    }
    if (r.position === "UP") upBets++;
    else downBets++;
    if (r.position === r.result) {
      wins++;
      if (r.position === "UP") upWins++;
      else downWins++;
      estPnl += stake * 0.95;
      streak = streak >= 0 ? streak + 1 : 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      losses++;
      estPnl -= stake;
      streak = streak <= 0 ? streak - 1 : -1;
      worstStreak = Math.min(worstStreak, streak);
    }
  }

  const gradedBets = wins + losses;
  return {
    importedAt: Date.now(),
    rows: rows.length,
    decided,
    matchedRecords,
    bets,
    wins,
    losses,
    flats,
    winRate: gradedBets > 0 ? (wins / gradedBets) * 100 : 0,
    upBets,
    upWins,
    downBets,
    downWins,
    totalWagered,
    estPnl,
    bestStreak,
    worstStreak: Math.abs(worstStreak),
    upOutcomeShare: decided > 0 ? (ups / decided) * 100 : 0,
  };
}

const AUDIT_KEY = "pea_import_audit_v1";

/** Loads the persisted import audit for one coin. */
export function loadImportAudit(storageSuffix: string): ImportAudit | null {
  try {
    const raw = localStorage.getItem(`${AUDIT_KEY}${storageSuffix}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImportAudit;
    return typeof parsed === "object" && parsed !== null && typeof parsed.rows === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists the import audit for one coin. */
export function saveImportAudit(audit: ImportAudit, storageSuffix: string): void {
  try {
    localStorage.setItem(`${AUDIT_KEY}${storageSuffix}`, JSON.stringify(audit));
  } catch {
    // storage full or unavailable — non-fatal
  }
}
