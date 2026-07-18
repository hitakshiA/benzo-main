import { useCallback, useReducer, useState } from "react";
import { paymentReducer, initialPaymentState, type PaymentState } from "@benzo/ui/payment-state";
import { type ProverKind, type SettleResult, type SendPhaseEvent } from "./api";
import { sendClientSide } from "./benzoClient";
import { usdcToBaseUnits } from "./format";
import { decodeRecipient } from "./recipient";
import { resolveHandleOnChain } from "./handleRegistry";
import { saveLocalHistory } from "./history";
import { isValidEvmAddress, normalizeEvmAddress } from "./address";
import { mapError } from "./errors";
import { DEMO_MODE } from "../demo/flag";
import { demoRunSend } from "../demo/sendStream";

export function useSendStream() {
  const [state, dispatch] = useReducer(paymentReducer, initialPaymentState);
  const [receipt, setReceipt] = useState<SettleResult | null>(null);

  const apply = useCallback((e: SendPhaseEvent) => {
    if (e.phase === "failed") {
      dispatch({ type: "FAIL", error: e.error ?? "Couldn't send" });
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
    async (to: string, amount: string, memo: string | undefined, prover: ProverKind, _proverAvailable = false, requestId?: string) => {
      // DEMO MODE: scripted walk of the payment state machine, no proving, no RPC.
      if (DEMO_MODE) return demoRunSend(to, amount, memo, dispatch, setReceipt);
      dispatch({ type: "RESET" });
      setReceipt(null);
      dispatch({ type: "START" });
      try {
        const recipient = await resolvePrivateRecipient(to);
        apply({ phase: "proving" });
        const baseUnits = usdcToBaseUnits(amount).toString();
        const cs = await sendClientSide(recipient, baseUnits, memo);
        if (cs?.txHash) {
          const r: SettleResult = { status: "settled", txHash: cs.txHash, prover: cs.prover, amount: baseUnits, onChain: true, provingMs: cs.provingMs };
          saveLocalHistory({
            id: cs.txHash,
            type: "send",
            name: to.startsWith("bzr_") ? `${to.slice(0, 10)}...${to.slice(-8)}` : to,
            note: memo || "",
            amount: baseUnits,
            direction: "out",
            status: "settled",
            timestamp: Math.floor(Date.now() / 1000),
            txHash: cs.txHash,
          });
          setReceipt(r);
          apply({ phase: "confirmed", txHash: cs.txHash, onChain: true, provingMs: cs.provingMs });
          return r;
        }
        throw new Error("Local-first send failed to return transaction hash.");
      } catch (err) {
        // Raw error to dev tools before the friendly mapping hides the cause.
        console.error("[benzo] send failed:", err);
        dispatch({ type: "FAIL", error: mapError(err, "Couldn't send right now. Your money is safe - please try again.") });
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

async function resolvePrivateRecipient(to: string): Promise<`0x${string}`> {
  const trimmed = to.trim();
  if (isValidEvmAddress(trimmed)) return normalizeEvmAddress(trimmed) as `0x${string}`;
  const decoded = decodeRecipient(trimmed);
  if (decoded?.address) return decoded.address;
  // A bare @handle resolves on-chain via HandleRegistry over Fuji RPC, no BFF
  // call sits on the send path, so this succeeds with the backend unreachable.
  const resolved = await resolveHandleOnChain(trimmed);
  return resolved.address;
}
