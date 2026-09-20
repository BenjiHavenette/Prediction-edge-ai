/** Formats a USD value with thousands separators. */
export const fmtUsd = (v: number, digits = 2): string =>
  v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Signed USD value, e.g. "+124.50". */
export const fmtSign = (v: number, digits = 2): string => `${v >= 0 ? "+" : "-"}${fmtUsd(Math.abs(v), digits)}`;

/** Signed percentage, e.g. "+0.12%". */
export const fmtPct = (v: number, digits = 2): string => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

/** Clock time HH:MM for a timestamp. */
export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Short date + time for a timestamp. */
export const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Countdown clock M:SS from seconds. */
export const fmtClock = (secs: number): string => {
  const s = Math.max(0, secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Compact large numbers, e.g. "3.4T". */
export const fmtCompact = (v: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
