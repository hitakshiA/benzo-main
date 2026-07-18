/**
 * Money display. The balance hero is the single focal point of Home: a big
 * Helvetica-Now figure that counts up on first paint, masks to dots when hidden,
 * and sizes cents smaller than dollars. AmountText is the inline form for rows.
 */
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { fmtUsd, fmtUsdc, fmtUsdcApproxUsd, splitAmount, USDC_BASE_UNITS } from "../lib/format";
import { useNetworkEnv } from "../lib/networkEnv";

/** Smoothly count a number up to its target (skipped under reduced-motion). */
function useCountUp(target: number, durationMs = 900): number {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(reduce ? target : 0);
  const raf = useRef(0);
  useEffect(() => {
    if (reduce) {
      setVal(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(from + (target - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, durationMs, reduce]);
  return val;
}

export function BalanceHero({
  baseUnits,
  hidden,
  loading,
  arrived,
}: {
  baseUnits: string | bigint;
  hidden: boolean;
  loading?: boolean;
  /** Just landed from a send: play the count-up as an arrival (a coin drops in). */
  arrived?: boolean;
}) {
  // Count up over the integer-dollar value; render the live string from it.
  const targetDollars = Number(BigInt(baseUnits || 0) / USDC_BASE_UNITS);
  const animated = useCountUp(targetDollars);
  const { cents } = splitAmount(baseUnits);
  const liveBaseUnits = BigInt(Math.round(animated)) * USDC_BASE_UNITS;
  const { dollars } = splitAmount(liveBaseUnits);

  if (loading) {
    return <div className="skeleton mt-1.5 h-[54px] w-48 rounded-2xl" aria-label="Loading balance" />;
  }
  if (hidden) {
    return (
      <div className="font-display text-hero mt-1.5 flex items-center gap-1 tracking-tight" aria-label="Balance hidden">
        {"••••••".split("").map((d, i) => (
          <span key={i} className="text-[40px] opacity-70">
            •
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="relative">
      {arrived ? <ArrivingCoin /> : null}
      {/* One tight figure: `$4,820.50`. `tnum` (tabular-nums) forced the comma and
          the decimal point to a full digit-width advance, which read as gaps
          around the `$`, the thousands comma, and the cents, proportional
          figures keep the separators snug. The count-up changes the digit COUNT
          frame-to-frame anyway, so tabular alignment bought nothing here. */}
      <div className="font-display text-hero mt-1.5 flex items-baseline tracking-tight" aria-label={fmtUsd(baseUnits)}>
        <span className="text-hero-sub mr-px font-semibold">$</span>
        <span>{dollars.replace(/^\$/, "")}</span>
        {/* Cents share the dollars' ink + baseline, the decimal is part of one
            figure, not a muted afterthought (Home critique #52). */}
        <span className="text-hero-sub">.{cents}</span>
      </div>
    </div>
  );
}

/** The coin from the send ceremony landing into the hero as the balance counts up.
 *  The metaphor continues from `ui/send/SendCeremony.tsx` (same gradient + glow). */
function ArrivingCoin() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute -top-3 left-2 h-9 w-9 rounded-full bg-gradient-to-br from-accent to-[#9a6bff] shadow-[var(--shadow-glow)]"
      initial={{ y: -120, scale: 1, opacity: 0 }}
      animate={{ y: 6, scale: 0.35, opacity: [0, 1, 1, 0] }}
      transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1], times: [0, 0.35, 0.7, 1] }}
    />
  );
}

/**
 * The denomination / context line under the hero balance. On a testnet this is the
 * load-bearing "this is NOT real money" cue: "Test USDC · Fuji Testnet · No real
 * value". On mainnet it's a plain "USDC · Avalanche". Reads the active network-env.
 */
export function BalanceDenomination({ className = "" }: { className?: string }) {
  const env = useNetworkEnv();
  return (
    <div className={`text-[12px] font-medium text-muted ${className}`} data-testid="balance-denomination">
      {env.denomination}
    </div>
  );
}

/**
 * Inline, unit-explicit amount so USDC is never mistaken for a raw dollar figure.
 * `approxUsd` renders the review form "10.00 USDC ≈ $10.00"; otherwise "10.00 USDC".
 */
export function AmountUsdc({
  baseUnits,
  approxUsd = false,
  className = "",
}: {
  baseUnits: string | bigint;
  approxUsd?: boolean;
  className?: string;
}) {
  const text = approxUsd ? fmtUsdcApproxUsd(baseUnits) : fmtUsdc(baseUnits);
  return (
    <span className={`tnum ${className}`} data-testid="amount-usdc">
      {text}
    </span>
  );
}

/** Inline amount for activity rows / sheets. `direction` colors + signs it. */
export function AmountText({
  baseUnits,
  direction,
  className = "",
}: {
  baseUnits: string | bigint;
  direction?: "in" | "out";
  className?: string;
}) {
  const s = fmtUsd(typeof baseUnits === "bigint" ? (baseUnits < 0n ? -baseUnits : baseUnits) : String(baseUnits).replace(/^-/, ""));
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const color = direction === "in" ? "text-pos" : "text-ink";
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`font-display ${color} ${className}`}
    >
      {sign}
      {s}
    </motion.span>
  );
}
