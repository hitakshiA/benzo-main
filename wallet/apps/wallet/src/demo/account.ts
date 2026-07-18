/**
 * The demo identity. A deterministic account derived offline from a fixed seed -
 * so it has a real, well-formed EVM address + eERC keys (Receive QR, Request
 * links, and Profile all render truthfully), yet it never touches a chain. No
 * passkey, no keychain, no signature.
 */
import { accountFromSignedMessage, type BenzoAccount } from "@benzo/core";

// A stable, arbitrary 32-byte seed. `accountFromSignedMessage` HKDF-derives the
// full account from it, so the address/keys are consistent across reloads.
const DEMO_SEED = Uint8Array.from(
  { length: 32 },
  (_v, i) => (i * 31 + 7) & 0xff,
);

let cached: BenzoAccount | null = null;

export function getDemoAccount(): BenzoAccount {
  if (!cached) cached = accountFromSignedMessage(DEMO_SEED, "demo");
  return cached;
}

function toHexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Matches the shape of `getLocalAccountSummary()` in lib/localWallet. */
export function getDemoAccountSummary(): { address: string; spendPub: string; mvkPub: string } {
  const account = getDemoAccount();
  return {
    address: account.address,
    spendPub: account.spendPub.toString(),
    mvkPub: toHexBytes(account.mvkPub),
  };
}

export const DEMO_HANDLE = "@you";
export const DEMO_DISPLAY_NAME = "Demo Wallet";
