/**
 * Consumer-facing money formatting. The wallet speaks dollars, never token
 * decimals: amounts come off the wire as configured USDC base units and render
 * as "$1,240.50". Two decimals by default (cents); more only when the trailing
 * precision is real.
 */
import { USDC_DECIMALS } from "./network";

export const USDC_BASE_UNITS = 10n ** BigInt(USDC_DECIMALS);

/** "1240500000" -> "1,240.50" (grouped, >=2 decimals, trailing zeros trimmed past cents). */
export function usdFromBaseUnits(minor: string | bigint, decimals = USDC_DECIMALS): string {
  let n: bigint;
  try {
    n = typeof minor === "bigint" ? minor : BigInt(minor || "0");
  } catch {
    return String(minor);
  }
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** "$1,240.50" - the headline form. */
export function fmtUsd(minor: string | bigint): string {
  const s = usdFromBaseUnits(minor);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** "10.00 USDC", the inline, unit-explicit form for send/review/rows so an amount
 *  is never mistaken for a raw dollar figure. */
export function fmtUsdc(minor: string | bigint): string {
  return `${usdFromBaseUnits(minor)} USDC`;
}

/** "10.00 USDC ≈ $10.00", the review form (USDC is the asset; $ is the reference). */
export function fmtUsdcApproxUsd(minor: string | bigint): string {
  return `${usdFromBaseUnits(minor)} USDC ≈ ${fmtUsd(minor)}`;
}

/** Signed, with explicit + for credits: "+$200.00" / "−$50.00" (true minus glyph). */
export function fmtSigned(minor: string | bigint, direction: "in" | "out"): string {
  const s = usdFromBaseUnits(typeof minor === "bigint" ? (minor < 0n ? -minor : minor) : minor.replace(/^-/, ""));
  return direction === "in" ? `+$${s}` : `−$${s}`;
}

/** Parse a typed human amount ("25", "25.50") into USDC base units. */
export function usdcToBaseUnits(amount: string): bigint {
  const clean = amount.trim().replace(/[$,]/g, "");
  const neg = clean.startsWith("-");
  const [whole, frac = ""] = clean.replace(/^[-+]/, "").split(".");
  if (frac.length > USDC_DECIMALS) throw new Error(`USDC has at most ${USDC_DECIMALS} decimals`);
  const baseUnits = BigInt(whole || "0") * USDC_BASE_UNITS + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
  return neg ? -baseUnits : baseUnits;
}

/** Split a money string into [bigPart, centsPart] so the hero can size them differently. */
export function splitAmount(minor: string | bigint): { dollars: string; cents: string } {
  const s = usdFromBaseUnits(minor);
  const [d, c = "00"] = s.split(".");
  return { dollars: d, cents: c.slice(0, 2) };
}

/** "now" / "2 min ago" / "Jun 18" - relative for recent, calendar for older. */
export function relativeTime(tsSeconds: number, nowMs = Date.now()): string {
  const diff = Math.floor(nowMs / 1000) - tsSeconds;
  if (diff < 45) return "now";
  // floor, not round, otherwise 3570–3599s rounds up to "60 min ago" right before
  // the ≥3600 branch takes over, so the minutes reading never reaches 60.
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 7 * 86_400) return `${Math.round(diff / 86_400)}d ago`;
  return new Date(tsSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Row time for the activity feed. Recent rows read relatively ("now" / "5 min
 * ago"); anything older shows a REAL clock time so a day-grouped feed never
 * collapses to a vague "2d ago" (critique #53). Same-day → "3:04 PM"; older →
 * "Jun 18, 3:04 PM".
 */
export function activityRowTime(tsSeconds: number, nowMs = Date.now()): string {
  const diff = Math.floor(nowMs / 1000) - tsSeconds;
  if (diff < 45) return "now";
  // floor, not round, otherwise 3570–3599s rounds up to "60 min ago" right before
  // the ≥3600 branch takes over, so the minutes reading never reaches 60.
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} min ago`;
  const d = new Date(tsSeconds * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date(nowMs);
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return time;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

/** Day bucket label for grouping the activity feed: Today / Yesterday / date. */
export function dayBucket(tsSeconds: number, nowMs = Date.now()): string {
  const d = new Date(tsSeconds * 1000);
  const today = new Date(nowMs);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(nowMs - 86_400_000);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/** Full, human date + time for a receipt: "Jun 21, 2026 at 3:04 PM". */
export function fullDateTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} at ${time}`;
}

/** Deterministic initials for an avatar from a name or @handle. */
export function initials(nameOrHandle: string): string {
  const s = nameOrHandle.replace(/^@/, "").trim();
  if (!s) return "?";
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
