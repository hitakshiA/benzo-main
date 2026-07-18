/**
 * Offline stand-ins for the on-chain reads that a few screens make outside the
 * wallet store (registration pre-check, the Profile ledger heartbeat, and the
 * balance proof). Each is a pure computation, no viem client, no RPC.
 */
import type { Address } from "viem";
import { DEMO_UNREGISTERED_ADDRESS } from "./seed";

/** Every address is "registered" for private payments EXCEPT the seeded one. */
export function demoIsRegisteredOnEerc(address: Address | string): boolean {
  return address.toLowerCase() !== DEMO_UNREGISTERED_ADDRESS.toLowerCase();
}

/** A plausible, slowly-advancing block height so Profile shows "Live · ledger #…". */
export function demoLedgerSequence(): number {
  return 41_000_000 + Math.floor(Date.now() / 6000);
}

/** A scripted proof-of-balance result (ShareProof): holds, verified, timed. */
export async function demoProveBalance(): Promise<{
  holds: boolean;
  onChain: boolean;
  provingMs: number;
  verifyMs: number;
}> {
  await new Promise((resolve) => setTimeout(resolve, 1800));
  return { holds: true, onChain: true, provingMs: 1800, verifyMs: 140 };
}
