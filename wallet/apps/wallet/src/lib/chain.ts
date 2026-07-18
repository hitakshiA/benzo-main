import { createPublicClient, http } from "viem";
import { ACTIVE_CHAIN, ENCRYPTED_ERC_ADDRESS, RPC_URL, subscribeNetwork } from "./network";
import { DEMO_MODE } from "../demo/flag";
import { demoLedgerSequence } from "../demo/registry";

export { ENCRYPTED_ERC_ADDRESS, RPC_URL };

export interface ChainStatus {
  sequence: number;
  protocolVersion: number;
  closedAt?: number;
}

function buildClient() {
  return createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL) });
}

// The read client is rebuilt whenever the active network changes so the ledger
// the Profile shows (and any direct chain read) tracks the selected environment.
let client = buildClient();
subscribeNetwork(() => {
  client = buildClient();
});

export async function getChainStatus(signal?: AbortSignal): Promise<ChainStatus> {
  if (DEMO_MODE) {
    return { sequence: demoLedgerSequence(), protocolVersion: ACTIVE_CHAIN.id };
  }
  const block = await client.getBlock();
  // viem's getBlock can't be cancelled mid-flight; if the caller aborted while
  // it was pending (e.g. a network switch), don't surface a now-stale block.
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return {
    sequence: Number(block.number),
    protocolVersion: ACTIVE_CHAIN.id,
    closedAt: block.timestamp ? Number(block.timestamp) : undefined,
  };
}

export async function verifyBalanceProofOnChain(_proof: unknown, _publics: string[]): Promise<boolean> {
  return false;
}

export function explorerTx(hash: string): string {
  return `${ACTIVE_CHAIN.blockExplorers?.default.url ?? ""}/tx/${hash}`;
}

export function eercConfigured(): boolean {
  return Boolean(ENCRYPTED_ERC_ADDRESS);
}
