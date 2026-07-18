import { useCallback, useReducer, useState } from "react";
import { initialPaymentState, paymentReducer, type PaymentState } from "@benzo/ui/payment-state";
import type { ProverKind, SendPhaseEvent, SettleResult } from "./api";
import { shieldPublicUsdcClientSide, unshieldPrivateUsdcClientSide } from "./benzoClient";
import { INVALID_AMOUNT, parsePositiveUsdcAmount } from "./amount";
import { saveLocalHistory } from "./history";
import { mapError } from "./errors";
import { DEMO_MODE } from "../demo/flag";
import { demoRunShield } from "../demo/shieldStream";

export type ShieldMode = "shield" | "unshield";

const HISTORY_META: Record<ShieldMode, { name: string; note: string; direction: "in" | "out" }> = {
  shield: {
    name: "Made private",
    note: "Public USDC to private balance",
    direction: "in",
  },
  unshield: {
    name: "Cash out",
    note: "Private USDC to public balance",
    direction: "out",
  },
};

export function useShieldStream() {
  const [state, dispatch] = useReducer(paymentReducer, initialPaymentState);
  const [receipt, setReceipt] = useState<SettleResult | null>(null);

  const apply = useCallback((e: SendPhaseEvent) => {
    if (e.phase === "failed") {
      dispatch({ type: "FAIL", error: e.error ?? "Couldn't move USDC" });
      return;
    }
    dispatch({ type: "START" });
    if (e.phase === "building") return;
    dispatch({ type: "WITNESS_READY" });
    if (e.phase === "proving") return;
    dispatch({ type: "PROOF_READY", provingMs: e.provingMs });
    if (e.txHash) dispatch({ type: "SUBMITTED", txHash: e.txHash });
    if (e.phase === "submitting") return;
    dispatch({ type: "CONFIRMED" });
  }, []);

  const run = useCallback(
    async (mode: ShieldMode, amount: string, memo: string | undefined, _prover: ProverKind, _proverAvailable = false) => {
      dispatch({ type: "RESET" });
      setReceipt(null);
      const parsedAmount = parsePositiveUsdcAmount(amount);
      if (!parsedAmount.valid) {
        dispatch({ type: "FAIL", error: parsedAmount.error ?? INVALID_AMOUNT });
        return null;
      }
      if (DEMO_MODE) return demoRunShield(mode, amount, memo, dispatch, setReceipt);
      dispatch({ type: "START" });
      try {
        apply({ phase: "proving" });
        const baseUnits = parsedAmount.baseUnits;
        const cs =
          mode === "shield"
            ? await shieldPublicUsdcClientSide(baseUnits, memo)
            : await unshieldPrivateUsdcClientSide(baseUnits, memo);
        if (cs?.txHash) {
          const r: SettleResult = { status: "settled", txHash: cs.txHash, prover: cs.prover, amount: baseUnits, onChain: true, provingMs: cs.provingMs };
          const meta = HISTORY_META[mode];
          saveLocalHistory({
            id: cs.txHash,
            type: mode,
            name: meta.name,
            note: memo || meta.note,
            amount: baseUnits,
            direction: meta.direction,
            status: "settled",
            timestamp: Math.floor(Date.now() / 1000),
            txHash: cs.txHash,
          });
          setReceipt(r);
          apply({ phase: "confirmed", txHash: cs.txHash, onChain: true, provingMs: cs.provingMs });
          return r;
        }
        throw new Error(mode === "shield" ? "Shield failed to return transaction hash." : "Cash out failed to return transaction hash.");
      } catch (err) {
        // Log the raw error (dev tools) before it's mapped to a friendly message —
        // the mapped copy hides the real cause (revert, rate limit, rpc, etc.).
        console.error(`[benzo] ${mode} failed:`, err);
        dispatch({
          type: "FAIL",
          error: mapError(err, mode === "shield" ? "Couldn't make USDC private right now. Your money is safe - please try again." : "Couldn't cash out right now. Your money is safe - please try again."),
        });
        return null;
      }
    },
    [apply],
  );

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    setReceipt(null);
  }, []);

  return { state: state as PaymentState, receipt, run, reset };
}
