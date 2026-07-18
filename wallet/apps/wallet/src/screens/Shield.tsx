import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Landmark, ShieldCheck, Smartphone } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ProverKind } from "../lib/api";
import { parsePositiveUsdcAmount } from "../lib/amount";
import { INSUFFICIENT_PRIVATE_USDC_ERROR, INSUFFICIENT_PUBLIC_USDC_SHIELD_ERROR } from "../lib/errors";
import { fmtUsd, fmtUsdc } from "../lib/format";
import { shouldLockOnSend, requireUnlock } from "../lib/lock";
import { proverPlan } from "../lib/proverPolicy";
import { useShieldStream, type ShieldMode } from "../lib/useShieldStream";
import { useWallet } from "../lib/store";
import { COPY } from "../lib/copy";
import { Screen } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { AmountField, Button, Card, Input, Segmented } from "../ui/primitives";
import { PrivateChip } from "../ui/privacy";
import { useHideBottomNav } from "../ui/shell";
import { SendCeremony, type SendReceipt } from "../ui/send/SendCeremony";

type Step = "form" | "confirm";

const MODE_COPY: Record<
  ShieldMode,
  {
    title: string;
    cta: string;
    action: string;
    source: string;
    destination: string;
    helper: string;
    review: string;
  }
> = {
  shield: {
    title: "Make private",
    cta: "Make private",
    action: "Make private",
    source: "Public USDC",
    destination: "Private balance",
    helper: "Move public USDC into your private balance. After confirmation, payments stay private on-chain.",
    review: "Public USDC becomes private after confirmation.",
  },
  unshield: {
    title: "Cash out",
    cta: "Cash out",
    action: "Cash out",
    source: "Private balance",
    destination: "Public USDC",
    helper: "Move private USDC back to the public balance at your wallet address.",
    review: "This cash-out becomes public USDC at your wallet address.",
  },
};

function modeFromParam(raw: string | null): ShieldMode {
  return raw === "unshield" ? "unshield" : "shield";
}

export function Shield() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const modeParam = params.get("mode");
  const [mode, setMode] = useState<ShieldMode>(() => modeFromParam(modeParam));
  const [amount, setAmount] = useState(() => params.get("amount") ?? "");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [firing, setFiring] = useState(false);
  const { balance, publicBalance, refresh, refreshBalance, session } = useWallet();
  const { state, receipt, run, reset } = useShieldStream();
  const plan = useMemo(() => proverPlan(), []);

  useEffect(() => {
    setMode(modeFromParam(modeParam));
  }, [modeParam]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  function changeMode(next: ShieldMode) {
    setMode(next);
    setStep("form");
    reset();
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("mode", next);
      if (amount) p.set("amount", amount);
      else p.delete("amount");
      return p;
    }, { replace: true });
  }

  const parsedAmount = useMemo(() => parsePositiveUsdcAmount(amount), [amount]);
  const amountBaseUnits = parsedAmount.baseUnits;
  const sourceBalance = mode === "shield" ? publicBalance : balance;
  const sourceKnown = sourceBalance != null;
  const sourceBaseUnits = sourceBalance?.baseUnits ?? "0";
  const sourceValue = BigInt(sourceBaseUnits);
  const checkingBalance = parsedAmount.valid && !sourceKnown;
  const lowBalance = parsedAmount.valid && sourceKnown && parsedAmount.value > sourceValue;
  const balanceError = mode === "shield" ? INSUFFICIENT_PUBLIC_USDC_SHIELD_ERROR : INSUFFICIENT_PRIVATE_USDC_ERROR;
  const chainUnavailable = !!session && !session.live;
  const valid = !chainUnavailable && parsedAmount.valid && !checkingBalance && !lowBalance;
  const inFlight = state.phase !== "idle";
  const copy = MODE_COPY[mode];

  useHideBottomNav(step === "confirm" || inFlight);

  const view: SendReceipt = {
    amount: receipt?.amount ?? amountBaseUnits,
    recipient: copy.destination,
    counterpartyLabel: "To",
    memo: memo || undefined,
    kind: mode,
    prover: receipt?.prover ?? plan.kind,
    onChain: receipt?.onChain ?? false,
    txHash: receipt?.txHash,
    provingMs: receipt?.provingMs,
  };

  async function fire() {
    if (firing || inFlight || chainUnavailable) return;
    setFiring(true);
    try {
      if (shouldLockOnSend() && !(await requireUnlock())) return;
      await run(mode, amount, memo || undefined, plan.kind, false);
      void refresh();
    } finally {
      setFiring(false);
    }
  }

  function done() {
    reset();
    if (mode === "shield") {
      nav("/", { state: { justSent: true } });
      return;
    }
    // Cash out lands in public USDC, outside the private BalanceHero animation.
    nav("/");
  }

  return (
    <Screen>
      <ScreenHeader title={copy.title} />
      <div className="px-5 pt-2">
        {chainUnavailable ? (
          <div role="alert" className="mb-3 rounded-xl bg-amber/12 px-3 py-2 text-[12px] font-medium text-[#9a6b12]" data-testid="shield-chain-unavailable">
            Live chain connection unavailable. Balance and money actions are blocked until the app reconnects.
          </div>
        ) : null}

        <Segmented
          active={mode}
          onChange={changeMode}
          items={[
            { id: "shield", label: "Make private" },
            { id: "unshield", label: "Cash out" },
          ]}
        />

        {step === "form" ? (
          <>
            <Card className="mt-4 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent/10 text-accent">
                  {mode === "shield" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{copy.source} {"->"} {copy.destination}</div>
                  <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{copy.helper}</div>
                  <div className="mt-2 text-[12px] font-semibold text-ink" data-testid="shield-available">
                    Available: {sourceKnown ? fmtUsdc(sourceBaseUnits) : "Checking..."}
                  </div>
                </div>
              </div>
            </Card>

            <div className="mt-6">
              <AmountField value={amount} onChange={setAmount} autoFocus />
              <div className="text-center text-[13px] text-muted">{copy.source} to {copy.destination}</div>
              {parsedAmount.error ? (
                <div className="mx-auto mt-2 max-w-[300px] text-center text-[12px] font-medium text-danger" data-testid="shield-amount-error">
                  {parsedAmount.error}
                </div>
              ) : null}
              {checkingBalance ? (
                <div className="mx-auto mt-2 max-w-[300px] text-center text-[12px] text-muted" data-testid="shield-balance-checking">
                  Checking {copy.source.toLowerCase()} balance...
                </div>
              ) : null}
              {lowBalance ? (
                <div className="mx-auto mt-2 max-w-[300px] text-center text-[12px] text-[#9a6b12]" data-testid="shield-low-balance">
                  {balanceError}
                </div>
              ) : null}
              <div className="mt-3 flex justify-center gap-2">
                {["5", "10", "20", "50", "100"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(q)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      amount === q ? "border-accent bg-accent/10 text-accent" : "border-hair bg-card text-ink hover:bg-canvas"
                    }`}
                  >
                    ${q}
                  </button>
                ))}
              </div>
            </div>

            <Input className="mt-8" label="Note (optional)" placeholder="For your history" value={memo} onChange={(e) => setMemo(e.target.value)} data-testid="shield-memo" />

            <Button full size="lg" className="mt-6" disabled={!valid} onClick={() => setStep("confirm")} data-testid="shield-submit">
              {amount && valid ? `${copy.cta} · ${fmtUsd(amountBaseUnits)}` : copy.cta}
            </Button>
          </>
        ) : (
          <ConfirmStep
            mode={mode}
            amount={amountBaseUnits}
            memo={memo}
            plan={plan}
            firing={firing}
            chainUnavailable={chainUnavailable}
            onBack={() => setStep("form")}
            onConfirm={fire}
          />
        )}
      </div>

      {inFlight ? <SendCeremony state={state} receipt={view} onDone={done} onRetry={() => { reset(); setStep("confirm"); }} /> : null}
    </Screen>
  );
}

function ConfirmStep({
  mode,
  amount,
  memo,
  plan,
  firing,
  chainUnavailable,
  onBack,
  onConfirm,
}: {
  mode: ShieldMode;
  amount: string;
  memo: string;
  plan: { onDevice: boolean; kind: ProverKind; reason: string };
  firing: boolean;
  chainUnavailable: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const copy = MODE_COPY[mode];
  return (
    <div>
      <Card className="mt-3 p-5">
        <div className="text-center">
          <div className="font-display text-4xl text-ink">{fmtUsd(amount)}</div>
          <div className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1 text-[13px] font-semibold text-ink" data-testid="shield-route">
            <Landmark size={13} className="text-accent" /> {copy.source} {"->"} {copy.destination}
          </div>
        </div>
        {memo ? <div className="mt-3 rounded-xl bg-canvas/70 px-3 py-2 text-center text-sm text-ink">"{memo}"</div> : null}
        <div className="mt-4 flex justify-center">
          {mode === "shield" ? (
            <PrivateChip label={COPY.privateOnChain} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/12 px-2.5 py-1 text-xs font-semibold text-[#9a6b12]">
              <ArrowUpRight size={12} /> Public USDC
            </span>
          )}
        </div>
      </Card>

      <div className="mt-3 text-center text-sm text-muted">{copy.review}</div>

      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-hair bg-card px-3.5 py-2.5 text-xs text-muted" data-testid="shield-prover-plan">
        {plan.onDevice ? <Smartphone size={15} className="flex-none text-accent" /> : <ShieldCheck size={15} className="flex-none text-accent" />}
        <span>{plan.reason}</span>
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" onClick={onBack} disabled={firing} data-testid="shield-back">
          Back
        </Button>
        <Button full size="lg" loading={firing} disabled={firing || chainUnavailable} onClick={onConfirm} data-testid="shield-confirm">
          {mode === "shield" ? <ArrowDownLeft size={18} className="flex-none" /> : <ArrowUpRight size={18} className="flex-none" />}
          <span className="truncate">{copy.action} {fmtUsd(amount)}</span>
        </Button>
      </div>
    </div>
  );
}
