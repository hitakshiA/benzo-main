import type { BenzoAccount } from "@benzo/core";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import { createViemClients, getPublicClient } from "./eerc";
import { HANDLE_REGISTRY_ADDRESS, REGISTRAR_ADDRESS } from "./network";
import { DEMO_MODE } from "../demo/flag";
import { demoIsRegisteredOnEerc } from "../demo/registry";

// On-chain @handle resolution against the Benzo HandleRegistry over Fuji RPC.
// This is the PRIMARY, source-of-truth path: sending to a @handle never needs
// the BFF. The backend /resolve endpoint (api.resolveHandle) survives only as an
// optional cache/enrichment fast-path and must never be required for a send.

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;
const HANDLE_CHARSET = /^[a-z0-9_]+$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Minimal ABI derived from contracts/benzo/HandleRegistry.sol.
export const handleRegistryAbi = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "handleOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "handleHash", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "transferHandle",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
] as const;

// Minimal ABI derived from contracts/eerc/Registrar.sol.
export const registrarAbi = [
  {
    type: "function",
    name: "isUserRegistered",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface ResolvedHandle {
  address: Address;
  registeredOnEerc: boolean;
  handle: string;
  source: "chain";
}

/**
 * Normalize a handle to the on-chain form the registry stores: strip a single
 * leading `@` and lowercase. Matches the backend + HandleRegistry.claim rules
 * (allowed bytes [a-z0-9_], length 3-32, no leading @).
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  const h = normalizeHandle(handle);
  return h.length >= HANDLE_MIN_LENGTH && h.length <= HANDLE_MAX_LENGTH && HANDLE_CHARSET.test(h);
}

function isZeroAddress(address: string | undefined): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * Read Registrar.isUserRegistered(address) -> whether the address has an eERC
 * public key registered. Best-effort: a registry hit is still valid even if the
 * eERC registration probe fails, so we degrade to `false` rather than throwing.
 */
export async function isRegisteredOnEerc(
  address: Address,
  client: PublicClient = getPublicClient(),
): Promise<boolean> {
  if (DEMO_MODE) return demoIsRegisteredOnEerc(address);
  if (!REGISTRAR_ADDRESS) return false;
  try {
    return (await client.readContract({
      address: REGISTRAR_ADDRESS,
      abi: registrarAbi,
      functionName: "isUserRegistered",
      args: [getAddress(address)],
    })) as boolean;
  } catch {
    return false;
  }
}

/**
 * Reverse lookup: HandleRegistry.handleOf(address) -> the @handle an address
 * owns, for display. Returns null when the address owns no handle.
 */
export async function reverseHandleOf(
  address: Address,
  client: PublicClient = getPublicClient(),
): Promise<string | null> {
  if (!HANDLE_REGISTRY_ADDRESS) return null;
  const handle = (await client.readContract({
    address: HANDLE_REGISTRY_ADDRESS,
    abi: handleRegistryAbi,
    functionName: "handleOf",
    args: [getAddress(address)],
  })) as string;
  return handle && handle.length > 0 ? handle : null;
}

/**
 * PRIMARY resolver: HandleRegistry.resolve(handle) -> address over Fuji RPC,
 * enriched with Registrar.isUserRegistered. No BFF call. Throws
 * `handle_not_found` for an unclaimed handle and `invalid_handle` for a handle
 * that can't be a registry key.
 */
export async function resolveHandleOnChain(
  handle: string,
  client: PublicClient = getPublicClient(),
): Promise<ResolvedHandle> {
  if (!HANDLE_REGISTRY_ADDRESS) throw new Error("Handle registry is not configured.");
  const normalized = normalizeHandle(handle);
  if (!isValidHandle(normalized)) throw new Error("invalid_handle");

  const owner = (await client.readContract({
    address: HANDLE_REGISTRY_ADDRESS,
    abi: handleRegistryAbi,
    functionName: "resolve",
    args: [normalized],
  })) as Address;

  if (isZeroAddress(owner)) throw new Error("handle_not_found");
  const address = getAddress(owner);
  const registeredOnEerc = await isRegisteredOnEerc(address, client);
  return { address, registeredOnEerc, handle: normalized, source: "chain" };
}

/**
 * On-chain availability: a handle is available when the registry has no owner.
 * Invalid handles are reported as unavailable (they can never be claimed).
 */
export async function handleAvailableOnChain(
  handle: string,
  client: PublicClient = getPublicClient(),
): Promise<{ available: boolean }> {
  if (!HANDLE_REGISTRY_ADDRESS || !isValidHandle(handle)) return { available: false };
  const owner = (await client.readContract({
    address: HANDLE_REGISTRY_ADDRESS,
    abi: handleRegistryAbi,
    functionName: "resolve",
    args: [normalizeHandle(handle)],
  })) as Address;
  return { available: isZeroAddress(owner) };
}

/**
 * Client-side registration: HandleRegistry.claim(handle) signed by the user's
 * own device wallet, so ownerOf(handle) == account.address (never the ops key).
 * Waits for the receipt and returns the tx hash.
 */
export async function claimHandleOnChain(
  account: BenzoAccount,
  handle: string,
): Promise<{ handle: string; txHash: Hex; address: Address }> {
  if (!HANDLE_REGISTRY_ADDRESS) throw new Error("Handle registry is not configured.");
  const normalized = normalizeHandle(handle);
  if (!isValidHandle(normalized)) throw new Error("invalid_handle");

  const { publicClient, walletClient } = createViemClients(account);
  const txHash = await walletClient.writeContract({
    account: walletClient.account!,
    chain: walletClient.chain,
    address: HANDLE_REGISTRY_ADDRESS,
    abi: handleRegistryAbi,
    functionName: "claim",
    args: [normalized],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    // A reverted claim must not report success, the registry owner was not updated.
    throw new Error("handle_claim_failed");
  }
  return { handle: normalized, txHash, address: account.address };
}
