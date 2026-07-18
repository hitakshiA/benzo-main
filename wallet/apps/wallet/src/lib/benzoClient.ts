import { encodeBenzoLink } from "@benzo/links";
import { getAddress, type Address, type Hex } from "viem";
import type { BenzoRecipient } from "@benzo/core";
import {
  createEerc,
  readEercPrivateBalance,
  readPublicUsdcBalance,
  shieldPublicUsdc,
  transferPrivateUsdc,
  unshieldPrivateUsdc,
} from "./eerc";
import {
  claimGiftOnChain,
  createGiftOnChain,
  decodeGiftClaimSecret,
  encodeGiftClaimSecret,
  giftStatusLabel,
  readGiftOnChain,
  refundGiftOnChain,
  type GiftClaimStatus,
} from "./giftEscrow";
import { claimHandleOnChain } from "./handleRegistry";
import { activatePrivateBalance, getLocalAccount } from "./localWallet";
import { USDC_TOKEN_ADDRESS } from "./network";
import { DEMO_MODE } from "../demo/flag";
import { demoProveBalance } from "../demo/registry";

// Gift links escrow the sender's public USDC on-chain for 30 days; unclaimed
// funds are refundable to the sender after expiry.
const GIFT_EXPIRY_SECONDS = 30 * 24 * 3600;

export async function getClient() {
  const account = getLocalAccount();
  return account ? await createEerc(account) : null;
}

export async function sendClientSide(
  to: Address | BenzoRecipient,
  amountBaseUnits: string,
  memo?: string,
): Promise<{ txHash?: string; provingMs?: number; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const address = typeof to === "string" ? to : to.address;
  if (!address) return null;
  await activatePrivateBalance();
  const result = await transferPrivateUsdc(account, address, BigInt(amountBaseUnits), memo);
  return { txHash: result.txHash, provingMs: result.provingMs, prover: "local" };
}

export async function activatePrivateBalanceClientSide(): Promise<{ txHash?: string; alreadyRegistered: boolean } | null> {
  return activatePrivateBalance();
}

/**
 * Claim a @handle on-chain with the device wallet, so HandleRegistry.ownerOf
 * resolves to the user's own address. Returns null when the wallet is locked.
 * No registration UI surfaces this yet; it is the client-side registration
 * primitive a future "claim your @handle" screen should call.
 */
export async function claimHandleClientSide(
  handle: string,
): Promise<{ handle: string; txHash: Hex; address: Address } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  return claimHandleOnChain(account, handle);
}

export async function shieldPublicUsdcClientSide(
  amountBaseUnits: string,
  memo?: string,
): Promise<{ approvalTxHash?: string; registrationTxHash?: string; txHash?: string; provingMs?: number; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const result = await shieldPublicUsdc(account, BigInt(amountBaseUnits), memo);
  return { ...result, prover: "local" };
}

export async function unshieldPrivateUsdcClientSide(
  amountBaseUnits: string,
  memo?: string,
): Promise<{ registrationTxHash?: string; txHash?: string; provingMs?: number; prover: "local" } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const result = await unshieldPrivateUsdc(account, BigInt(amountBaseUnits), memo);
  return { ...result, prover: "local" };
}

export async function clientSideReadsAvailable(): Promise<boolean> {
  return getLocalAccount() !== null;
}

export async function readShieldedBalanceClientSide(): Promise<string | null> {
  const account = getLocalAccount();
  if (!account) return null;
  return readEercPrivateBalance(account);
}

export async function readPublicBalanceClientSide(): Promise<string | null> {
  const account = getLocalAccount();
  if (!account) return null;
  return readPublicUsdcBalance(account);
}

export async function proveBalanceClientSide(
  _minBaseUnits: string,
): Promise<{ holds: boolean; onChain: boolean; provingMs?: number; verifyMs?: number } | null> {
  if (DEMO_MODE) return demoProveBalance();
  return null;
}

/**
 * Create a gift link backed by TRUSTLESS on-chain escrow: escrow the sender's
 * public USDC into PrivateGiftEscrow under a fresh ephemeral claim key, and pack
 * the giftId + ephemeral key into the link fragment (never a server). The
 * returned `claimSecretHex` is that self-describing fragment secret; it doubles
 * as the local id so a later refund can recover the giftId with no backend.
 */
export async function createInviteClientSide(
  amountBaseUnits: string,
): Promise<{ link: string; claimSecretHex: string; txHash?: string } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  if (!USDC_TOKEN_ADDRESS) throw new Error("USDC token is not configured.");
  const amount = BigInt(amountBaseUnits);
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");

  const expirySeconds = Math.floor(Date.now() / 1000) + GIFT_EXPIRY_SECONDS;
  const { giftId, claimPrivateKey, txHash } = await createGiftOnChain(account, {
    token: getAddress(USDC_TOKEN_ADDRESS),
    amount,
    expirySeconds,
  });
  const secret = encodeGiftClaimSecret(giftId, claimPrivateKey);
  const link = encodeBenzoLink(
    {
      type: "claim",
      secret,
      amount: amountBaseUnits,
      asset: "USDC",
      app: "consumer",
      expiresAt: String(expirySeconds),
    },
    "web",
  );
  return { link, claimSecretHex: secret, txHash };
}

/**
 * Refund an unclaimed gift back to the sender after expiry, straight against the
 * escrow. The giftId is recovered from the stored claim secret, no backend.
 */
export async function refundInviteClientSide(
  claimSecretHex: string,
): Promise<{ txHash?: string } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const decoded = decodeGiftClaimSecret(claimSecretHex);
  if (!decoded) throw new Error("This gift isn't an on-chain escrow and can't be refunded here.");
  const { txHash } = await refundGiftOnChain(account, decoded.giftId);
  return { txHash };
}

/**
 * Claim a gift link into the recipient's private balance over RPC. The giftId +
 * ephemeral signing key come from the link fragment, so the backend is never
 * custody and never required.
 */
export async function claimLinkClientSide(
  claimSecretHex: string,
): Promise<{ amount: string; txHash?: string } | null> {
  const account = getLocalAccount();
  if (!account) return null;
  const decoded = decodeGiftClaimSecret(claimSecretHex);
  if (!decoded) throw new Error("This claim link isn't an on-chain gift.");
  const { amount, txHash } = await claimGiftOnChain(account, decoded.giftId, decoded.claimPrivateKey);
  return { amount, txHash };
}

/**
 * Read a gift's claim status straight from the escrow (SOURCE OF TRUTH). Needs
 * no wallet and no BFF, so a recipient can check a link with the backend
 * unreachable. Returns null for a secret that isn't an on-chain gift (legacy
 * links fall back to the optional backend metadata cache).
 */
export async function giftClaimStatusClientSide(
  claimSecretHex: string,
): Promise<{ status: GiftClaimStatus; amount?: string; expiresAt?: number } | null> {
  const decoded = decodeGiftClaimSecret(claimSecretHex);
  if (!decoded) return null;
  const gift = await readGiftOnChain(decoded.giftId);
  return {
    status: giftStatusLabel(gift),
    amount: gift.amount.toString(),
    expiresAt: Number(gift.expiry),
  };
}
