/**
 * The send ceremony (S0), the flagship full-viewport coin. A full-screen overlay
 * driven by the shared payment state machine (@benzo/ui): a genuine 3D coin sits
 * CENTERED and tumbles on its axes while it works. Through encrypt + settle it
 * JITTERS (a rapid micro-shake) and throws off air/speed streaks that intensify as
 * the load ramps up, the honest "this is proving/settling under load" state, held
 * as long as the machine takes. On verify/confirmed the coin EXPLODES into a
 * confetti overdrive burst, then settles into the verifiable receipt. On error it
 * falters and dims, no celebration.
 *
 * The animation is a slave to the machine, never a timer, so it tells the truth
 * about proving/settlement. The one exception is the per-phase FLOOR: a fast local
 * proof can jump submitting→confirmed in a blink, so each phase is held on screen
 * for at least SEND_PHASE_FLOOR_MS before advancing (walked one step at a time),
 * so the working coin never flashes past. Collapses to a calm, static coin → check
 * → receipt under prefers-reduced-motion (no jitter, no streaks, no confetti).
 *
 * The coin is a literal 3D coin built in CSS (preserve-3d: stacked disc layers for
 * a real milled edge + an embossed $ front / Benzo-mark back). Swap <Coin3D> alone
 * to change the metaphor; the working/burst choreography is untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Copy, ExternalLink, ShieldCheck, X } from "lucide-react";
import { sendCeremonyView, SEND_RAIL_LABELS, SEND_PHASE_FLOOR_MS, type CeremonyPhase } from "@benzo/ui/send-sequence";
import { type PaymentPhase, type PaymentState } from "@benzo/ui/payment-state";
import { EASE } from "../motion";
import { Button, SuccessCheck } from "../primitives";
import { copyTextToClipboard } from "../../lib/clipboard";
import { fmtUsdcApproxUsd } from "../../lib/format";
import { COPY } from "../../lib/copy";
import { useNetworkEnv } from "../../lib/networkEnv";
import { explorerTx } from "../OnChainDetails";

export type CeremonyKind = "send" | "shield" | "unshield";

export interface SendReceipt {
  amount: string; // USDC base units
  recipient: string; // @handle or display name
  counterpartyLabel?: string;
  kind?: CeremonyKind;
  memo?: string;
  txHash?: string;
  onChain: boolean;
  provingMs?: number;
  prover: "local";
}

/** Network-aware tx explorer URL. Re-exported from the single source (OnChainDetails)
 *  so a mainnet build never deep-links the testnet explorer (was hardcoded "testnet"). */
export const explorerTxUrl = explorerTx;

// The cinematic phases in order + the 3-step rail index each maps to.
const PHASE_ORDER = ["encrypt", "settle", "verify"] as const;
const PHASE_STEP: Record<CeremonyPhase, number> = { encrypt: 0, settle: 1, verify: 2, error: -1 };
// Map a displayed cinematic phase back to a payment phase so the tested
// `sendCeremonyView` projection supplies honest title/sub copy for whatever is
// actually on screen (not what the machine has already raced ahead to).
const PHASE_TO_PAYMENT: Record<CeremonyPhase, PaymentPhase> = {
  encrypt: "proving",
  settle: "submitting",
  verify: "confirmed",
  error: "failed",
};

/**
 * Consumer-facing stage copy for whatever phase is on screen. Plain English only -
 * "Preparing your private payment" → "Waiting for confirmation" → "Payment
 * complete". The settle sub is network-aware ("Fuji Testnet is confirming"); the
 * error sub is the real message off the state machine.
 */
const KIND_COPY: Record<
  CeremonyKind,
  {
    preparing: { title: string; sub: string };
    confirming: { title: string; sub: (networkName: string) => string };
    complete: { title: string; sub: string };
    failedTitle: string;
  }
> = {
  send: {
    preparing: COPY.ceremony.preparing,
    confirming: COPY.ceremony.confirming,
    complete: COPY.ceremony.complete,
    failedTitle: COPY.ceremony.failed.title,
  },
  shield: {
    preparing: { title: "Making USDC private", sub: "Creating your proof on this device" },
    confirming: { title: "Finalizing private balance", sub: (networkName) => `${networkName} is confirming your shield.` },
    complete: { title: "Money made private", sub: "Private balance updated" },
    failedTitle: "Couldn't make private",
  },
  unshield: {
    preparing: { title: "Preparing cash out", sub: "Creating your proof on this device" },
    confirming: { title: "Finalizing cash out", sub: (networkName) => `${networkName} is confirming your cash out.` },
    complete: { title: "Cash out complete", sub: "Public USDC updated" },
    failedTitle: "Couldn't cash out",
  },
};

function ceremonyCopy(kind: CeremonyKind, phase: CeremonyPhase, networkName: string, errorSub: string): { title: string; sub: string } {
  const copy = KIND_COPY[kind];
  switch (phase) {
    case "encrypt":
      return copy.preparing;
    case "settle":
      return { title: copy.confirming.title, sub: copy.confirming.sub(networkName) };
    case "verify":
      return copy.complete;
    case "error":
      return { title: copy.failedTitle, sub: errorSub };
  }
}

function receiptStatusLabel(kind: CeremonyKind, onChain: boolean): string {
  if (kind === "send") return onChain ? "Private payment on-chain" : "Private payment not verified on-chain";
  if (kind === "shield") return onChain ? "Private on-chain" : "Private balance update not verified on-chain";
  return onChain ? "Public USDC on-chain" : "Cash out not verified on-chain";
}

export function SendCeremony({
  state,
  receipt,
  onDone,
  onRetry,
}: {
  state: PaymentState;
  receipt: SendReceipt;
  onDone: () => void;
  onRetry: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const env = useNetworkEnv();
  const kind = receipt.kind ?? "send";
  const target = sendCeremonyView(state, { prover: receipt.prover, reducedMotion: reduce }).phase;
  const { phase, step } = useFlooredCeremonyPhase(target, reduce);

  // The honest state machine still decides WHICH phase is on screen; `shown` only
  // carries the real error message for the failure state. Everything else uses the
  // consumer-facing stage copy (crypto detail is deferred to Advanced details).
  const shown = sendCeremonyView({ ...state, phase: PHASE_TO_PAYMENT[phase] }, { prover: receipt.prover, reducedMotion: reduce });
  const stageCopy = ceremonyCopy(kind, phase, env.name, shown.sub);

  if (state.phase === "idle") return null;

  const failed = phase === "error";
  const done = phase === "verify";

  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col items-center justify-between overflow-hidden bg-canvas px-8 pb-10 pt-14 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-testid="send-overlay"
    >
      <PhaseRail step={failed ? step : PHASE_STEP[phase]} failed={failed} reduce={reduce} />

      {/* The coin stage, full-bleed so the burst can throw confetti to the edges. */}
      <div className="relative flex w-full flex-1 items-center justify-center">
        <CoinStage phase={phase} reduce={reduce} />
        <AnimatePresence>
          {done ? (
            <motion.div
              key="verify"
              className="relative z-10"
              initial={reduce ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : 0.3 }}
            >
              <VerifyReveal receipt={receipt} reduce={reduce} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="relative z-10 w-full">
        <div className="mb-6">
          <div className="font-display text-2xl" data-testid="ceremony-title">
            {stageCopy.title}
          </div>
          <div className="mt-1 text-sm text-muted" data-testid="ceremony-sub">
            {stageCopy.sub}
          </div>
        </div>

        {done ? (
          <Button full size="lg" onClick={onDone} data-testid="ceremony-done">
            Done
          </Button>
        ) : failed ? (
          <Button full size="lg" variant="secondary" onClick={onRetry} data-testid="ceremony-retry">
            Try again
          </Button>
        ) : (
          <SlowReassurance phase={phase} onEscape={onRetry} />
        )}
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------- floor-gated phase
/**
 * Drive the on-screen cinematic phase off the machine, but never faster than the
 * per-phase floor. We walk PHASE_ORDER one step at a time and hold each step for
 * SEND_PHASE_FLOOR_MS before advancing, so even an instant submitting→confirmed
 * still plays the full working sequence. Failures interrupt immediately (no floor),
 * and reduced-motion snaps straight to the real phase (nothing cinematic to hold).
 */
function useFlooredCeremonyPhase(target: CeremonyPhase, reduce: boolean): { phase: CeremonyPhase; step: number } {
  const [phase, setPhase] = useState<CeremonyPhase>(target);
  const enteredAt = useRef(now());
  const lastStep = useRef(PHASE_STEP[target] < 0 ? 0 : PHASE_STEP[target]);

  useEffect(() => {
    if (target === "error") {
      setPhase("error");
      return;
    }
    if (reduce || phase === "error") {
      if (phase !== target) {
        setPhase(target);
        enteredAt.current = now();
      }
      return;
    }
    const di = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
    const ti = PHASE_ORDER.indexOf(target as (typeof PHASE_ORDER)[number]);
    if (di < 0 || di >= ti) return; // already caught up

    const floor = SEND_PHASE_FLOOR_MS[phase as Exclude<CeremonyPhase, "error">] ?? 0;
    const wait = Math.max(0, floor - (now() - enteredAt.current));
    const id = setTimeout(() => {
      setPhase(PHASE_ORDER[di + 1]);
      enteredAt.current = now();
    }, wait);
    return () => clearTimeout(id);
  }, [target, phase, reduce]);

  if (phase !== "error") lastStep.current = PHASE_STEP[phase];
  return { phase, step: lastStep.current };
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ----------------------------------------------------------------- rail
function PhaseRail({ step, failed, reduce }: { step: number; failed: boolean; reduce: boolean }) {
  return (
    <div className="flex w-full max-w-[280px] items-center gap-2" aria-hidden={!reduce}>
      {SEND_RAIL_LABELS.map((label, i) => {
        const active = step >= 0 && i <= step;
        const isCurrent = i === step && !failed;
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
              <motion.div
                className={`absolute inset-y-0 left-0 rounded-full ${failed && isCurrent ? "bg-danger" : "bg-accent"}`}
                initial={false}
                animate={{ width: active || (failed && i <= Math.max(step, 0)) ? "100%" : "0%" }}
                transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
              />
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${active ? "text-accent" : "text-muted/60"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ the coin stage
/**
 * What's on the stage per phase:
 *  - encrypt + settle ("working"): the 3D coin, jittering + throwing speed
 *    streaks that intensify from encrypt → settle.
 *  - verify: the coin bursts (AnimatePresence exit) into a confetti overdrive.
 *  - error: a dimmed failure mark, no coin, no confetti.
 */
function CoinStage({ phase, reduce }: { phase: CeremonyPhase; reduce: boolean }) {
  const working = phase === "encrypt" || phase === "settle";
  const boost = phase === "settle";

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {phase === "error" ? (
        <motion.div
          className="flex h-24 w-24 items-center justify-center rounded-full bg-danger/12 text-danger"
          initial={reduce ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <X size={36} />
        </motion.div>
      ) : null}

      <AnimatePresence>
        {working ? (
          <motion.div
            key="coin"
            data-testid="ceremony-coin"
            className="relative flex items-center justify-center"
            initial={reduce ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            // The coin "explodes", pop + fade out just as the confetti fires.
            exit={reduce ? { opacity: 0 } : { scale: 1.55, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
          >
            {!reduce ? <SpeedStreaks boost={boost} /> : null}
            <Coin3D reduce={reduce} boost={boost} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {phase === "verify" && !reduce ? <ConfettiOverdrive /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 3D coin
const COIN = 120; // diameter (px)
const THICK = 16; // edge thickness (px)
const LAYERS = 14; // stacked discs that form the milled edge

/** A genuine 3D coin: stacked disc layers give a real edge, embossed faces spin
 *  into and out of view. Under reduced motion it's a calm, static front-facing coin. */
function Coin3D({ reduce, boost }: { reduce: boolean; boost: boolean }) {
  const layers = useMemo(
    () =>
      Array.from({ length: LAYERS }, (_, i) => {
        const z = -THICK / 2 + (i / (LAYERS - 1)) * THICK;
        return { z, key: i };
      }),
    [],
  );

  const spin = reduce
    ? undefined
    : { rotateY: [0, 360] };
  const spinT = { duration: boost ? 1.05 : 2.3, ease: "linear" as const, repeat: Number.POSITIVE_INFINITY };

  return (
    <div
      style={{ perspective: 900, perspectiveOrigin: "50% 42%" }}
      className="flex items-center justify-center"
    >
      <JitterWrapper reduce={reduce} boost={boost}>
        {/* Static tilt so we read the coin from slightly above (more depth). */}
        <motion.div
          style={{ transformStyle: "preserve-3d" }}
          initial={{ rotateX: -16 }}
          animate={reduce ? { rotateX: -10 } : { rotateX: [-16, -9, -16] }}
          transition={reduce ? { duration: 0 } : { duration: 4, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
        >
          <motion.div
            className="relative"
            style={{
              width: COIN,
              height: COIN,
              transformStyle: "preserve-3d",
              filter: "drop-shadow(0 10px 34px rgba(115,66,226,0.45))",
            }}
            initial={reduce ? { rotateY: 0 } : false}
            animate={spin}
            transition={spinT}
          >
            {/* Milled edge, a stack of discs between the two faces. */}
            {layers.map(({ z, key }) => (
              <span
                key={key}
                className="absolute inset-0 rounded-full"
                style={{
                  transform: `translateZ(${z}px)`,
                  background: "linear-gradient(90deg, #3a2380 0%, #7c4ff0 50%, #3a2380 100%)",
                }}
              />
            ))}

            {/* Front face, embossed $. */}
            <CoinFace z={THICK / 2}>
              <span
                className="font-display leading-none"
                style={{
                  fontSize: 52,
                  color: "rgba(255,255,255,0.96)",
                  textShadow: "0 1px 0 rgba(255,255,255,0.45), 0 -1.5px 1px rgba(60,20,120,0.5)",
                }}
              >
                $
              </span>
            </CoinFace>

            {/* Back face, the Benzo mark. */}
            <CoinFace z={THICK / 2} back>
              <span
                className="font-display leading-none"
                style={{
                  fontSize: 50,
                  color: "rgba(255,255,255,0.92)",
                  textShadow: "0 1px 0 rgba(255,255,255,0.4), 0 -1.5px 1px rgba(60,20,120,0.5)",
                }}
              >
                B
              </span>
            </CoinFace>
          </motion.div>
        </motion.div>
      </JitterWrapper>
    </div>
  );
}

/** One embossed coin face at ±half-thickness. `back` flips it so its glyph reads
 *  correctly (not mirrored) and hides it from the front via backface-culling. */
function CoinFace({ z, back, children }: { z: number; back?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-full"
      style={{
        transform: back ? `rotateY(180deg) translateZ(${z}px)` : `translateZ(${z}px)`,
        backfaceVisibility: "hidden",
        background:
          "radial-gradient(circle at 32% 26%, #b79bff 0%, var(--color-accent, #7342E2) 44%, #5227ae 100%)",
        boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.14), inset 0 -8px 18px rgba(40,12,90,0.4)",
      }}
    >
      {/* Specular highlight sweep. */}
      <span
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 30% 22%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 42%)",
        }}
      />
      {/* Embossed inner ring. */}
      <span className="pointer-events-none absolute inset-[10px] rounded-full border border-white/25" />
      <span className="relative">{children}</span>
    </div>
  );
}

/** Rapid micro-shake (random tiny translate + rotate) that conveys the coin working
 *  under load. Amplitude ramps up in the settle ("boost") phase. */
function JitterWrapper({ reduce, boost, children }: { reduce: boolean; boost: boolean; children: React.ReactNode }) {
  const jitter = useMemo(() => {
    const amp = boost ? 6 : 3;
    const n = 9;
    const rand = (m: number) => (Math.random() * 2 - 1) * m;
    return {
      x: Array.from({ length: n }, () => rand(amp)),
      y: Array.from({ length: n }, () => rand(amp)),
      rotate: Array.from({ length: n }, () => rand(amp * 0.5)),
    };
  }, [boost]);

  if (reduce) return <div style={{ transformStyle: "preserve-3d" }}>{children}</div>;
  return (
    <motion.div
      style={{ transformStyle: "preserve-3d" }}
      animate={jitter}
      transition={{ duration: boost ? 0.32 : 0.5, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
    >
      {children}
    </motion.div>
  );
}

// -------------------------------------------------------------- speed streaks
/** Air/speed streaks radiating outward past the coin, motion lines that intensify
 *  as the work ramps up. Never rendered under reduced motion. */
function SpeedStreaks({ boost }: { boost: boolean }) {
  const count = boost ? 16 : 10;
  const streaks = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: (360 / count) * i + (Math.random() * 12 - 6),
        delay: Math.random() * (boost ? 0.6 : 1),
        len: 22 + Math.random() * (boost ? 26 : 16),
      })),
    [count, boost],
  );
  const duration = boost ? 0.6 : 1.0;
  const outer = boost ? 230 : 175;
  const peak = boost ? 0.85 : 0.5;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative h-0 w-0">
        {streaks.map((s, i) => (
          <div
            key={i}
            className="absolute left-0 top-0"
            style={{ transform: `rotate(${s.angle}deg)` }}
          >
            <motion.span
              className="absolute rounded-full"
              style={{
                left: -1.25,
                width: 2.5,
                height: s.len,
                background: "linear-gradient(to top, rgba(154,107,255,0) 0%, var(--color-accent, #7342E2) 100%)",
              }}
              initial={{ y: -54, opacity: 0 }}
              animate={{ y: [-54, -outer], opacity: [0, peak, 0] }}
              transition={{
                duration,
                delay: s.delay,
                ease: "easeOut",
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: boost ? 0.05 : 0.25,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- confetti / overdrive
const CONFETTI_COLORS = ["var(--color-accent, #7342E2)", "#9a6bff", "#c8a6ff", "#ffd166", "#4ecb8f", "#ff8fd0", "#5bc8ff"];

/** The over-the-top finish: a shockwave + core flash + ~44 confetti particles blown
 *  out from where the coin was, then faded. Fires once on entering verify. */
function ConfettiOverdrive() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 170;
        return {
          key: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          rot: Math.random() * 720 - 360,
          w: 6 + Math.random() * 7,
          h: 8 + Math.random() * 10,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          delay: Math.random() * 0.08,
          dur: 0.9 + Math.random() * 0.7,
          round: Math.random() > 0.55,
        };
      }),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* Shockwave ring. */}
      <motion.span
        className="absolute rounded-full border-2"
        style={{ width: 120, height: 120, borderColor: "var(--color-accent, #7342E2)" }}
        initial={{ scale: 0.3, opacity: 0.7 }}
        animate={{ scale: 3.2, opacity: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      {/* Core flash. */}
      <motion.span
        className="absolute rounded-full"
        style={{
          width: 130,
          height: 130,
          background: "radial-gradient(circle, rgba(200,166,255,0.85) 0%, rgba(115,66,226,0) 70%)",
        }}
        initial={{ scale: 0.2, opacity: 0.9 }}
        animate={{ scale: 2.1, opacity: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
      {/* Confetti. */}
      {pieces.map((p) => (
        <motion.span
          key={p.key}
          className="absolute"
          style={{ width: p.w, height: p.h, background: p.color, borderRadius: p.round ? "50%" : 2 }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: [0, p.dx * 0.6, p.dx],
            y: [0, p.dy - 24, p.dy + 40],
            scale: [0, 1, 1, 0.85],
            opacity: [1, 1, 1, 0],
            rotate: p.rot,
          }}
          transition={{ duration: p.dur, delay: p.delay, ease: "easeOut", times: [0, 0.2, 0.7, 1] }}
        />
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- verify
function VerifyReveal({ receipt, reduce }: { receipt: SendReceipt; reduce: boolean }) {
  const [showDetails, setShowDetails] = useState(false);
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: receipt.counterpartyLabel ?? "To", value: receipt.recipient },
    { label: "Amount", value: fmtUsdcApproxUsd(receipt.amount) },
  ];
  if (receipt.memo) rows.push({ label: "Note", value: receipt.memo });
  const kind = receipt.kind ?? "send";
  const statusLabel = receiptStatusLabel(kind, receipt.onChain);
  const statusTone = receipt.onChain ? "text-pos" : "text-muted";
  const privacyNote =
    kind === "send"
      ? COPY.paymentPrivacy(receipt.recipient)
      : kind === "shield"
        ? "This USDC is now in your private balance. Future payments stay private on-chain."
        : "This cash-out is public USDC at your wallet address. Your remaining private balance stays private on-chain.";

  return (
    <div className="flex w-full max-w-[300px] flex-col items-center gap-4" data-testid="ceremony-receipt">
      <SuccessCheck size={76} />
      <div className="w-full rounded-2xl bg-card p-4 shadow-[var(--shadow-card)]">
        {rows.map((r, i) => (
          <motion.div
            key={r.label}
            className="flex items-center justify-between border-b border-hair/60 py-2 text-sm last:border-0"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.1 + i * 0.07, ease: EASE }}
          >
            <span className="text-muted">{r.label}</span>
            <span className="font-semibold text-ink">{r.value}</span>
          </motion.div>
        ))}
        <div className={`mt-3 flex items-center justify-center gap-1.5 text-[12px] font-medium ${statusTone}`}>
          <ShieldCheck size={13} /> {statusLabel}
        </div>
        <div className="mt-2 flex flex-col items-center">
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink"
            data-testid="receipt-details-toggle"
          >
            {showDetails ? "Hide details" : COPY.ceremony.advancedDetails}
            <ChevronDown size={13} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {showDetails ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                className="mt-2 flex flex-wrap items-center justify-center gap-2"
                data-testid="receipt-advanced"
              >
                {/* Cryptographic detail lives here, witness/prover/proof-time -
                    never in the everyday stage copy above. */}
                <span className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-muted">{COPY.proofOnDevice}</span>
                {typeof receipt.provingMs === "number" ? (
                  <span className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-muted">Proved in {(receipt.provingMs / 1000).toFixed(1)}s</span>
                ) : null}
                {receipt.txHash && receipt.onChain ? (
                  <a
                    href={explorerTxUrl(receipt.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-ink/10"
                    data-testid="receipt-explorer"
                  >
                    <ExternalLink size={12} /> View receipt
                  </a>
                ) : null}
                {receipt.txHash ? <CopyChip text={receipt.txHash} /> : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <p className="text-[12px] text-muted">{privacyNote}</p>
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void copyTextToClipboard(text).then(setCopied);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-ink/10"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Reference"}
    </button>
  );
}

// ----------------------------------------------------------------- slow reassurance
// Three honest stages: quiet (no message), reassurance (~6-8s), and a hard ceiling
// (~90s) that offers a safe escape WITHOUT claiming failure - the submit→poll loop
// can legitimately run long, but the user should never be stranded forever.
const STALL_CEILING_MS = 90_000;
function SlowReassurance({ phase, onEscape }: { phase: CeremonyPhase; onEscape: () => void }) {
  const [slow, setSlow] = useState(false);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setSlow(false);
    setStalled(false);
    const slowId = setTimeout(() => setSlow(true), phase === "encrypt" ? 6000 : 8000);
    const stallId = setTimeout(() => setStalled(true), STALL_CEILING_MS);
    return () => {
      clearTimeout(slowId);
      clearTimeout(stallId);
    };
  }, [phase]);
  if (stalled) {
    return (
      <div className="flex flex-col items-center gap-2 px-4" data-testid="ceremony-stalled">
        <p className="text-[13px] text-muted">Taking longer than usual. The network may be busy - your money hasn't moved yet.</p>
        <button onClick={onEscape} className="text-[13px] font-semibold text-accent" data-testid="ceremony-stalled-retry">
          Start over
        </button>
      </div>
    );
  }
  if (!slow) return <div className="h-[52px]" />;
  return (
    <p className="px-4 text-[13px] text-muted">
      {phase === "encrypt" ? "Strong proofs take a few seconds. Your money hasn't moved yet." : "Waiting for the ledger to close…"}
    </p>
  );
}
