import type { BenzoAccount } from "@benzo/core";
import {
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { createEerc, createViemClients, getPublicClient } from "./eerc";
import { PRIVATE_GIFT_ESCROW_ADDRESS } from "./network";

// On-chain gift escrow for Benzo claim links (PrivateGiftEscrow.sol).
//
// A gift is TRUSTLESS on-chain escrow: createGift pulls the sender's public
// ERC20 into the contract; the recipient claims it into their encrypted eERC
// balance with a signature from an ephemeral key that travels in the link
// fragment (never a server). The BFF is never custody, a recipient can read a
// gift's status and claim it over RPC with the backend unreachable. Refund
// returns the escrowed token to the sender after expiry.

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const AMOUNT_PCT_LENGTH = 7;

/** The eERC amount PCT: a fixed uint256[7] Poseidon ciphertext. */
export type AmountPCT = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint];

// Minimal ABI derived from contracts/benzo/PrivateGiftEscrow.sol. Signatures
// match the deployed contract exactly (do not hand-edit types).
export const privateGiftEscrowAbi = [
  {
    type: "function",
    name: "createGift",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimAddress", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "giftId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "giftId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "sig", type: "bytes" },
      { name: "amountPCT", type: "uint256[7]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "giftId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getGift",
    stateMutability: "view",
    inputs: [{ name: "giftId", type: "uint256" }],
    outputs: [
      {
        name: "gift",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "claimAddress", type: "address" },
          { name: "token", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "createdAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "giftCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimDigest",
    stateMutability: "view",
    inputs: [
      { name: "giftId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "amountPCT", type: "uint256[7]" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "GiftCreated",
    inputs: [
      { name: "giftId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "claimAddress", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
    ],
  },
] as const;

// PrivateGiftEscrow.Status enum. Created gifts are claimable/refundable; a gift
// past expiry is still `Created` on-chain but surfaces as "expired" to the UI.
export const GIFT_STATUS = { created: 0, claimed: 1, refunded: 2 } as const;

export type GiftClaimStatus = "open" | "claimed" | "refunded" | "expired";

export interface OnChainGift {
  sender: Address;
  claimAddress: Address;
  token: Address;
  recipient: Address;
  amount: bigint;
  createdAt: bigint;
  expiry: bigint;
  status: number;
}

// The raw getGift tuple mirrors OnChainGift; normalizeGift re-checksums the
// addresses and coerces status (which the ABI decoder may hand back as bigint).
type RawGift = Omit<OnChainGift, "status"> & { status: number | bigint };

// The ephemeral claim key needs a poseidon encryptor + the recipient's public
// key. Only the subset of the eERC SDK surface we use, so tests can stub it.
interface GiftEerc {
  fetchPublicKey(address: Address): Promise<readonly bigint[]>;
  register(): Promise<{ transactionHash: string }>;
  poseidon: {
    processPoseidonEncryption(params: { inputs: bigint[]; publicKey: readonly bigint[] }): Promise<{
      cipher: bigint[];
      nonce: bigint;
      authKey: readonly bigint[];
    }>;
  };
}

/**
 * The configured PrivateGiftEscrow address, or throw a clear error. The address
 * is wired from `VITE_PRIVATE_GIFT_ESCROW_ADDRESS` (falling back to the
 * @benzo/config deployment); the zero placeholder means "not deployed yet".
 */
export function requireGiftEscrowAddress(): Address {
  const addr = PRIVATE_GIFT_ESCROW_ADDRESS;
  if (!addr || addr.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(
      "Gift escrow is not configured. Set VITE_PRIVATE_GIFT_ESCROW_ADDRESS to the deployed PrivateGiftEscrow address.",
    );
  }
  return getAddress(addr);
}

/**
 * Encode a gift claim secret (giftId + ephemeral key) for the URL fragment.
 * Self-describing so a legacy/backend claim secret is never mistaken for one.
 */
export function encodeGiftClaimSecret(giftId: bigint, claimPrivateKey: Hex): string {
  return `g${giftId.toString()}.${claimPrivateKey.replace(/^0x/, "").toLowerCase()}`;
}

/** Parse a gift claim secret. Returns null for anything that isn't one. */
export function decodeGiftClaimSecret(
  secret: string,
): { giftId: bigint; claimPrivateKey: Hex } | null {
  const match = /^g(\d+)\.([0-9a-fA-F]{64})$/.exec(secret.trim());
  if (!match) return null;
  return { giftId: BigInt(match[1]), claimPrivateKey: `0x${match[2].toLowerCase()}` as Hex };
}

function normalizeGift(raw: RawGift): OnChainGift {
  return {
    sender: getAddress(raw.sender),
    claimAddress: getAddress(raw.claimAddress),
    token: getAddress(raw.token),
    recipient: getAddress(raw.recipient),
    amount: raw.amount,
    createdAt: raw.createdAt,
    expiry: raw.expiry,
    status: Number(raw.status),
  };
}

/** Map an on-chain gift to the coarse status the claim UI shows. */
export function giftStatusLabel(
  gift: OnChainGift,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): GiftClaimStatus {
  if (gift.status === GIFT_STATUS.claimed) return "claimed";
  if (gift.status === GIFT_STATUS.refunded) return "refunded";
  if (gift.expiry > 0n && nowSeconds >= Number(gift.expiry)) return "expired";
  return "open";
}

/**
 * Read a gift straight from the escrow over RPC. This is the SOURCE OF TRUTH for
 * claim status; it needs no wallet and no BFF, so a recipient can check a gift
 * with the backend unreachable.
 */
export async function readGiftOnChain(
  giftId: bigint,
  client: PublicClient = getPublicClient(),
): Promise<OnChainGift> {
  const escrow = requireGiftEscrowAddress();
  const raw = (await client.readContract({
    address: escrow,
    abi: privateGiftEscrowAbi,
    functionName: "getGift",
    args: [giftId],
  })) as RawGift;
  return normalizeGift(raw);
}

/**
 * The digest the ephemeral claim key signs. Mirrors PrivateGiftEscrow.claimDigest:
 * keccak256(abi.encode(escrow, chainId, giftId, recipient, keccak256(abi.encode(amountPCT)))).
 * Computed client-side so a claim needs no extra RPC round-trip.
 */
export function computeClaimDigest(
  escrow: Address,
  chainId: number,
  giftId: bigint,
  recipient: Address,
  amountPCT: readonly bigint[],
): Hex {
  const innerHash = keccak256(encodeAbiParameters([{ type: "uint256[7]" }], [amountPCT as AmountPCT]));
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [getAddress(escrow), BigInt(chainId), giftId, getAddress(recipient), innerHash],
    ),
  );
}

async function ensureEscrowAllowance(
  account: BenzoAccount,
  token: Address,
  amount: bigint,
): Promise<void> {
  const escrow = requireGiftEscrowAddress();
  const { publicClient, walletClient } = createViemClients(account);
  const allowance = (await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [getAddress(account.address), escrow],
  })) as bigint;
  if (allowance >= amount) return;
  const { request } = await publicClient.simulateContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrow, amount],
    // Local signer account (not the bare address) so writeContract signs
    // on-device via eth_sendRawTransaction instead of the RPC-only
    // eth_sendTransaction that public RPCs reject. See eerc.ensureUsdcAllowance.
    account: walletClient.account,
  });
  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
}

function giftIdFromReceipt(logs: readonly unknown[] | undefined): bigint | undefined {
  if (!logs || logs.length === 0) return undefined;
  try {
    const parsed = parseEventLogs({
      abi: privateGiftEscrowAbi,
      eventName: "GiftCreated",
      logs: logs as never,
    });
    const first = parsed[0] as { args?: { giftId?: bigint } } | undefined;
    return first?.args?.giftId;
  } catch {
    return undefined;
  }
}

/**
 * Escrow `amount` of `token` on-chain: mint an ephemeral claim key, approve the
 * escrow, and call createGift. Funds leave the sender into the contract, this
 * is real escrow, not a backend IOU. Returns the giftId + the ephemeral private
 * key (which the caller packs into the link fragment).
 */
export async function createGiftOnChain(
  account: BenzoAccount,
  params: { token: Address; amount: bigint; expirySeconds: number },
): Promise<{ giftId: bigint; claimPrivateKey: Hex; claimAddress: Address; txHash: Hex }> {
  const escrow = requireGiftEscrowAddress();
  const { token, amount, expirySeconds } = params;
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");

  const claimPrivateKey = generatePrivateKey();
  const claimAddress = privateKeyToAccount(claimPrivateKey).address;

  // Approve first so the createGift simulate/call can pull the token.
  await ensureEscrowAllowance(account, token, amount);

  const { publicClient, walletClient } = createViemClients(account);
  if (!walletClient.account) throw new Error("Local wallet account is not available.");
  const { request } = await publicClient.simulateContract({
    address: escrow,
    abi: privateGiftEscrowAbi,
    functionName: "createGift",
    args: [claimAddress, getAddress(token), amount, BigInt(expirySeconds)],
    account: walletClient.account,
  });
  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("gift_create_failed");

  // The MINED GiftCreated event is authoritative for the gift id, never fall
  // back to the simulation result, which can be stale if another createGift is
  // mined first, pointing the claim link at the wrong gift.
  const giftId = giftIdFromReceipt(receipt.logs);
  if (giftId === undefined) throw new Error("gift_create_no_id");
  return { giftId, claimPrivateKey, claimAddress, txHash };
}

async function ensureRecipientRegistered(
  eerc: GiftEerc,
  recipient: Address,
  client: PublicClient,
): Promise<void> {
  const publicKey = await eerc.fetchPublicKey(recipient);
  if (publicKey[0] !== 0n || publicKey[1] !== 0n) return;
  const result = await eerc.register();
  const hash = result.transactionHash as Hex;
  if (hash) await client.waitForTransactionReceipt({ hash });
}

async function buildClaimAmountPCT(
  eerc: GiftEerc,
  recipient: Address,
  amount: bigint,
): Promise<AmountPCT> {
  const publicKey = await eerc.fetchPublicKey(recipient);
  if (publicKey[0] === 0n && publicKey[1] === 0n) throw new Error("recipient_not_registered");
  // USDC (6 decimals) maps 1:1 to the eERC's encrypted representation, matching
  // the shield deposit convention, so no rescaling is needed here. amountPCT is
  // only the recipient-encrypted history entry the eERC stores off the eGCT; it
  // is not verified against the on-chain balance (see depositFor NatSpec).
  const { cipher, nonce, authKey } = await eerc.poseidon.processPoseidonEncryption({
    inputs: [amount],
    publicKey,
  });
  const amountPCT = [...cipher, ...authKey, nonce];
  if (amountPCT.length !== AMOUNT_PCT_LENGTH) {
    throw new Error("gift_amount_pct_malformed");
  }
  return amountPCT as unknown as AmountPCT;
}

/**
 * Claim a gift into the caller's encrypted balance. Reads the gift on-chain
 * (source of truth), ensures the recipient is eERC-registered, builds the
 * recipient-encrypted amountPCT, and calls claim() with a signature from the
 * ephemeral key over the contract digest (bound to recipient + amountPCT).
 */
export async function claimGiftOnChain(
  account: BenzoAccount,
  giftId: bigint,
  claimPrivateKey: Hex,
): Promise<{ amount: string; txHash: Hex }> {
  const escrow = requireGiftEscrowAddress();
  const { publicClient, walletClient } = createViemClients(account);
  if (!walletClient.account) throw new Error("Local wallet account is not available.");
  const recipient = getAddress(account.address);

  const gift = await readGiftOnChain(giftId, publicClient);
  if (gift.status !== GIFT_STATUS.created) throw new Error("gift_not_claimable");
  if (gift.expiry > 0n && Math.floor(Date.now() / 1000) >= Number(gift.expiry)) {
    throw new Error("gift_expired");
  }

  const eerc = (await createEerc(account)) as GiftEerc | null;
  if (!eerc) throw new Error("eERC contracts are not configured.");
  await ensureRecipientRegistered(eerc, recipient, publicClient);
  const amountPCT = await buildClaimAmountPCT(eerc, recipient, gift.amount);

  const chainId = walletClient.chain?.id ?? (await publicClient.getChainId());
  const digest = computeClaimDigest(escrow, chainId, giftId, recipient, amountPCT);
  const signature = await sign({ hash: digest, privateKey: claimPrivateKey, to: "hex" });

  const txHash = await walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: escrow,
    abi: privateGiftEscrowAbi,
    functionName: "claim",
    args: [giftId, recipient, signature, amountPCT],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("gift_claim_failed");
  return { amount: gift.amount.toString(), txHash };
}

/**
 * Refund an unclaimed gift to the sender after expiry. Only the original sender
 * (this wallet) can call it; the contract enforces sender + expiry.
 */
export async function refundGiftOnChain(
  account: BenzoAccount,
  giftId: bigint,
): Promise<{ txHash: Hex }> {
  const escrow = requireGiftEscrowAddress();
  const { publicClient, walletClient } = createViemClients(account);
  if (!walletClient.account) throw new Error("Local wallet account is not available.");
  const txHash = await walletClient.writeContract({
    account: walletClient.account,
    chain: walletClient.chain,
    address: escrow,
    abi: privateGiftEscrowAbi,
    functionName: "refund",
    args: [giftId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("gift_refund_failed");
  return { txHash };
}
