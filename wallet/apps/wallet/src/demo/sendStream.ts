/**
 * The scripted send. Instead of building a witness, proving, and broadcasting,
 * this walks the shared @benzo/ui payment state machine on realistic timers so
 * the full-viewport coin-flight ceremony plays honestly (encrypt hold → settle
 * flight → verify), returns a fake txHash, decrements the demo balance, and
 * prepends a new activity row. No proving, no RPC.
 */
import type { Dispatch } from "react";
import type { PaymentEvent } from "@benzo/ui/payment-state";
import type { SettleResult } from "../lib/api";
import { listLocal } from "../lib/contacts";
import { usdcToBaseUnits } from "../lib/format";
import { applyDemoSend } from "./state";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeTxHash(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** How the recipient reads on the receipt + in the new activity row. */
function displayName(to: string): string {
  const contact = listLocal().find((c) => c.handle === to);
  if (contact) return contact.name;
  if (to.startsWith("bzr_")) return `${to.slice(0, 10)}...${to.slice(-8)}`;
  if (to.length > 24) return `${to.slice(0, 8)}...${to.slice(-8)}`;
  return to;
}

export async function demoRunSend(
  to: string,
  amount: string,
  memo: string | undefined,
  dispatch: Dispatch<PaymentEvent>,
  setReceipt: (receipt: SettleResult | null) => void,
): Promise<SettleResult | null> {
  const baseUnits = usdcToBaseUnits(amount).toString();

  dispatch({ type: "RESET" });
  setReceipt(null);

  // building → the ceremony overlay mounts, coin materializes
  dispatch({ type: "START" });
  await delay(650);

  // proving → cipher scramble + closing lock ring (held ≥ encrypt floor)
  dispatch({ type: "WITNESS_READY" });
  const provingMs = 1700;
  await delay(provingMs);

  // submitting → the coin flies edge-to-edge (held ≥ settle floor)
  dispatch({ type: "PROOF_READY", provingMs });
  const txHash = fakeTxHash();
  dispatch({ type: "SUBMITTED", txHash });
  await delay(900);

  // confirmed → verifiable receipt reveal
  const receipt: SettleResult = {
    status: "settled",
    txHash,
    prover: "local",
    amount: baseUnits,
    onChain: true,
    provingMs,
  };
  applyDemoSend({ to, name: displayName(to), amountBaseUnits: baseUnits, memo, txHash });
  setReceipt(receipt);
  dispatch({ type: "CONFIRMED" });

  return receipt;
}
