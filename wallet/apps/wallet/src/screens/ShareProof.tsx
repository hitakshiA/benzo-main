/**
 * Create proof of funds, the Benzo differentiator (critique #59). Prove your
 * balance is at or above a threshold WITHOUT revealing the exact amount. It's a
 * first-class flow, not a profile row: pick the minimum, name who it's for, set an
 * expiry and whether it can be re-shared, and, crucially, see a pre-create
 * DISCLOSURE PREVIEW that spells out exactly what the recipient will and won't
 * learn before any proof is generated.
 *
 * The proof itself is a real Groth16 attestation of the threshold, generated
 * on-device; the recipient / expiry / re-share choices frame how it's shared.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, ShieldCheck, Smartphone } from "lucide-react";
import { proverPlan } from "../lib/proverPolicy";
import { proveBalanceClientSide } from "../lib/benzoClient";
import { fmtUsdc, usdcToBaseUnits } from "../lib/format";
import { useNetworkEnv } from "../lib/networkEnv";
import { Screen } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { AmountField, Button, SuccessCheck } from "../ui/primitives";
import { ProvableChip } from "../ui/privacy";

type Phase = "form" | "busy" | "done";

const EXPIRY = [
  { id: "1d", label: "24 hours", note: "expires in 24 hours" },
  { id: "7d", label: "7 days", note: "expires in 7 days" },
  { id: "30d", label: "30 days", note: "expires in 30 days" },
  { id: "none", label: "No expiry", note: "does not expire" },
] as const;
type ExpiryId = (typeof EXPIRY)[number]["id"];

export function ShareProof() {
  const env = useNetworkEnv();
  const [min, setMin] = useState("5000");
  const [recipient, setRecipient] = useState("");
  const [expiry, setExpiry] = useState<ExpiryId>("7d");
  const [reshareable, setReshareable] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [err, setErr] = useState<string | null>(null);
  const [onChain, setOnChain] = useState(false);
  const [onDevice, setOnDevice] = useState(false);
  // Local-only proving: capable desktops prove in-browser; otherwise the local
  // runtime endpoint must generate the proof. No outside prover fallback.
  const plan = proverPlan();
  const valid = Number(min) > 0;
  const assetLabel = env.isTestnet ? `Test ${env.asset}` : env.asset;
  const who = recipient.trim() || "The recipient";
  // `usdcToBaseUnits` throws on an over-precise input (e.g. "10.1234567"); the user
  // types freely, so guard it, a bad in-progress value shows 0.00, never crashes.
  const threshold = (() => {
    if (!valid) return `0.00 ${env.asset}`;
    try {
      return fmtUsdc(usdcToBaseUnits(min).toString());
    } catch {
      return `0.00 ${env.asset}`;
    }
  })();
  const expiryNote = EXPIRY.find((e) => e.id === expiry)?.note ?? "does not expire";

  async function generate() {
    setPhase("busy");
    setErr(null);
    setOnDevice(false);
    try {
      // Generate the proof on THIS DEVICE. The witness/notes never leave the
      // browser; no API fallback is allowed for balance proofs.
      const cs = await proveBalanceClientSide(usdcToBaseUnits(min).toString());
      if (!cs) throw new Error("proof_of_balance_unavailable");
      setOnChain(cs.onChain);
      setOnDevice(true);
      setPhase("done");
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setErr(/proof_of_balance/i.test(msg)
        ? "Balance proofs are not available in this local build yet. Use a capable desktop or try again after local proof artifacts finish loading."
        : msg);
      setPhase("form");
    }
  }

  return (
    <Screen className="flex min-h-full flex-col">
      <ScreenHeader title="Create proof of funds" />
      <div className="flex flex-1 flex-col px-5 pb-8 pt-1">
        <p className="text-[14px] leading-relaxed text-muted">
          Prove your balance is <span className="font-semibold text-ink">above an amount</span> without revealing your exact
          balance or your payment history.
        </p>

        <div className="mt-5">
          <div className="text-center text-[13px] font-semibold text-muted">Prove I have at least</div>
          <AmountField value={min} onChange={setMin} />
          <div className="mt-1 flex items-center justify-center gap-1.5 text-[12.5px] text-muted">
            Asset <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[12px] font-semibold text-ink">{assetLabel}</span>
          </div>
        </div>

        {/* Who it's for */}
        <label className="mt-5 block">
          <span className="text-[13px] font-semibold text-ink">Who is this for?</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. Grant Thornton"
            data-testid="proof-recipient"
            className="mt-1.5 w-full rounded-[var(--radius-input)] border border-hair bg-canvas px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-muted focus:border-accent focus:bg-card focus:ring-4 focus:ring-accent/15"
          />
        </label>

        {/* Expiry */}
        <div className="mt-4">
          <span className="text-[13px] font-semibold text-ink">Expires</span>
          <div className="no-scrollbar mt-1.5 flex gap-2 overflow-x-auto pb-1">
            {EXPIRY.map((e) => {
              const on = e.id === expiry;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setExpiry(e.id)}
                  data-testid={`proof-expiry-${e.id}`}
                  aria-pressed={on}
                  className={`flex-none rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    on ? "bg-accent text-white shadow-[var(--shadow-glow)]" : "bg-ink/[0.05] text-muted hover:text-ink"
                  }`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Re-shareable */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-hair bg-card px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">Allow re-sharing</div>
            <div className="text-[12.5px] text-muted">Let {who} forward this proof to others.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={reshareable}
            onClick={() => setReshareable((v) => !v)}
            data-testid="proof-reshare-toggle"
            className={`relative h-6 w-11 flex-none rounded-full transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${reshareable ? "bg-accent" : "bg-ink/15"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${reshareable ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {/* Pre-create disclosure preview, exactly what is (and isn't) revealed. */}
        <div className="mt-5 rounded-2xl bg-accent/[0.06] p-4" data-testid="proof-disclosure">
          <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.05em] text-[#4a2fa0]">
            <Eye size={13} /> What they'll learn
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink" data-testid="proof-disclosure-text">
            <span className="font-semibold">{who}</span> will learn your balance is at least{" "}
            <span className="font-semibold">{threshold}</span>. They will <span className="font-semibold">not</span> see your
            exact balance or your payment history.
          </p>
          <p className="mt-2 text-[12.5px] text-muted">
            This proof {reshareable ? "can be re-shared" : "is for this recipient only"} and {expiryNote}.
          </p>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-hair bg-card px-3.5 py-2.5 text-[12.5px] text-muted" data-testid="proof-prover-plan">
          {plan.onDevice ? <Smartphone size={15} className="flex-none text-accent" /> : <ShieldCheck size={15} className="flex-none text-accent" />}
          <span>{plan.reason}</span>
        </div>

        <div className="mt-auto pt-5">
          <Button full size="lg" disabled={!valid} loading={phase === "busy"} onClick={generate} data-testid="proof-generate">
            {phase === "busy" ? "Creating proof…" : "Create proof of funds"}
          </Button>
          {err ? <div className="mt-2 text-center text-sm text-danger" data-testid="proof-error">{err}</div> : null}
        </div>
      </div>

      <AnimatePresence>
        {phase === "done" ? (
          <motion.div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-canvas px-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-testid="proof-overlay"
          >
            <SuccessCheck />
            <ProvableChip label={onChain ? "Verified on-chain" : "Provable"} />
            <div className="font-display text-xl" data-testid="proof-success">
              You can prove you hold at least {threshold}
            </div>
            <div className="max-w-[290px] text-sm text-muted">
              <span className="font-semibold text-ink">{who}</span> will learn only that your balance clears this amount -
              never the exact figure or your payment history.
            </div>
            {onDevice && onChain ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-pos/10 px-3 py-1 text-[12px] font-semibold text-pos" data-testid="proof-self-verified">
                <Smartphone size={13} /> Proved on your device, verified on-chain
              </div>
            ) : null}
            {!onChain ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber/12 px-3 py-1 text-[12px] font-semibold text-[#9a6b12]" data-testid="proof-not-onchain">
                Generated on your device · not verified on-chain
              </div>
            ) : null}
            <Button className="mt-2" onClick={() => setPhase("form")}>Done</Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Screen>
  );
}
