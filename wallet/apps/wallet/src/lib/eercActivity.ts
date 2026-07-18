import type { EERC } from "@avalabs/eerc-sdk";
import type { BenzoAccount } from "@benzo/core";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ActivityHint, ActivityRow } from "./api";
import { createEerc, getPublicClient } from "./eerc";
import {
  CHAIN_ID,
  EERC_ACTIVITY_LOG_WINDOW_BLOCKS,
  EERC_ACTIVITY_START_BLOCK,
  EERC_USDC_TOKEN_ID,
  ENCRYPTED_ERC_ADDRESS,
  USDC_TOKEN_ADDRESS,
} from "./network";

type EercDecryptor = Pick<EERC, "decryptPCT" | "getHistoricalBalance">;

type EercLog = {
  args?: Record<string, unknown>;
  blockNumber?: bigint | null;
  eventName?: string;
  logIndex?: number | null;
  transactionHash?: Hex | null;
};

type DecodedCall = ReturnType<typeof decodeFunctionData<typeof encryptedErcActivityAbi>>;
type EercEventName = "PrivateTransfer" | "PrivateMint" | "PrivateBurn" | "Deposit" | "Withdraw";
type HintLookup = {
  byLog: Map<string, ActivityHint>;
  byTx: Map<string, ActivityHint>;
};

// Running state for outgoing (send/burn) amount derivation. Each outflow's
// balancePCT decrypts to the balance *after* that event, so two outflows in the
// same block must chain: the second's starting balance is the first's remaining,
// not a re-read of `getHistoricalBalance(block - 1)` (which would ignore the
// first outflow and overstate the second). Adjacency is enforced by `ordinal`
// so any intervening event (an incoming transfer, mint, deposit, …) breaks the
// chain and falls back to the historical read.
type OutflowCarry = { current: { block: bigint; ordinal: number; remaining: bigint } | null };

const CACHE_PREFIX = "benzo.eercActivity.v1";
const RESCAN_OVERLAP_BLOCKS = 20n;
const MAX_CACHED_ROWS = 200;

export const encryptedErcActivityAbi = [
  {
    type: "event",
    name: "PrivateTransfer",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "event",
    name: "PrivateMint",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "event",
    name: "PrivateBurn",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "event",
    name: "Deposit",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "dust", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "uint256[7]", name: "auditorPCT", type: "uint256[7]" },
      { indexed: true, internalType: "address", name: "auditorAddress", type: "address" },
    ],
  },
  {
    type: "function",
    name: "tokenIds",
    stateMutability: "view",
    inputs: [{ internalType: "address", name: "tokenAddress", type: "address" }],
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { components: proofComponents("uint256[32]"), internalType: "struct TransferProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { components: proofComponents("uint256[32]"), internalType: "struct TransferProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateMint",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { components: proofComponents("uint256[24]"), internalType: "struct MintProof", name: "proof", type: "tuple" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateMint",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { components: proofComponents("uint256[24]"), internalType: "struct MintProof", name: "proof", type: "tuple" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateBurn",
    stateMutability: "nonpayable",
    inputs: [
      { components: proofComponents("uint256[19]"), internalType: "struct BurnProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "privateBurn",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { components: proofComponents("uint256[19]"), internalType: "struct BurnProof", name: "proof", type: "tuple" },
      { internalType: "uint256[7]", name: "balancePCT", type: "uint256[7]" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function proofComponents(publicSignalsType: "uint256[19]" | "uint256[24]" | "uint256[32]") {
  return [
    {
      components: [
        { internalType: "uint256[2]", name: "a", type: "uint256[2]" },
        { internalType: "uint256[2][2]", name: "b", type: "uint256[2][2]" },
        { internalType: "uint256[2]", name: "c", type: "uint256[2]" },
      ],
      internalType: "struct ProofPoints",
      name: "proofPoints",
      type: "tuple",
    },
    { internalType: publicSignalsType, name: "publicSignals", type: publicSignalsType },
  ] as const;
}

const EVENT_BY_NAME = new Map(
  encryptedErcActivityAbi
    .filter((item) => item.type === "event")
    .map((item) => [item.name, item]),
);

export interface ReadEercActivityOptions {
  client?: PublicClient;
  eerc?: EercDecryptor;
  hints?: ActivityHint[];
}

export async function readEercActivityClientSide(
  account: BenzoAccount,
  options: ReadEercActivityOptions = {},
): Promise<ActivityRow[]> {
  if (!ENCRYPTED_ERC_ADDRESS || !USDC_TOKEN_ADDRESS) return [];
  const eerc = options.eerc ?? (await createEerc(account));
  if (!eerc) return [];

  const client = options.client ?? getPublicClient();
  const [latestBlock, usdcTokenId] = await Promise.all([
    client.getBlockNumber(),
    readUsdcTokenId(client),
  ]);
  const cache = loadActivityCache(account.address);
  const fromBlock = scanStartBlock(latestBlock, options.hints ?? [], cache?.scannedTo);
  if (fromBlock > latestBlock) return [];

  const logs = await collectActivityLogs(client, account.address, fromBlock, latestBlock);
  const hints = options.hints ?? [];
  const hintLookup = activityHintLookup(hints);
  const blockTimes = new Map<bigint, number>();
  const unresolvedBlockTimestamps = new Set<bigint>();
  const rows: ActivityRow[] = [];
  const outflowCarry: OutflowCarry = { current: null };

  for (const [logOrdinal, log] of sortLogsChronologically(uniqueLogs(logs)).entries()) {
    try {
      const row = await rowFromLog({
        account: account.address,
        blockTimes,
        client,
        eerc,
        hint: hintForLog(log, hintLookup),
        log,
        logOrdinal,
        outflowCarry,
        unresolvedBlockTimestamps,
        usdcTokenId,
      });
      if (row) rows.push(row);
    } catch (err) {
      console.warn("Skipping eERC activity log:", {
        error: err,
        eventName: log.eventName,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
      });
    }
  }

  const merged = mergeActivityRows(cache?.rows ?? [], applyActivityHints(rows, hints));
  if (unresolvedBlockTimestamps.size === 0) saveActivityCache(account.address, latestBlock, merged);
  return merged;
}

export function mergeActivityRows(...groups: ActivityRow[][]): ActivityRow[] {
  const byKey = new Map<string, ActivityRow>();
  for (const group of groups) {
    for (const row of group) {
      const key = activityKey(row);
      const existing = byKey.get(key);
      if (existing) {
        byKey.set(key, mergeActivityRow(existing, row));
        continue;
      }
      const txOnlyKey = txOnlyActivityKey(row);
      const txOnly = txOnlyKey ? byKey.get(txOnlyKey) : undefined;
      if (txOnlyKey && txOnly && canMergeTxOnlyActivity(txOnly, row)) {
        byKey.delete(txOnlyKey);
        byKey.set(key, mergeActivityRow(txOnly, row));
        continue;
      }
      const logAwareKey = findCompatibleLogAwareKey(byKey, row);
      if (logAwareKey) {
        const logAware = byKey.get(logAwareKey);
        byKey.set(logAwareKey, mergeActivityRow(row, logAware ?? row));
        continue;
      }
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export function applyActivityHints(rows: ActivityRow[], hints: ActivityHint[]): ActivityRow[] {
  if (hints.length === 0) return rows;
  const lookup = activityHintLookup(hints);
  return rows.map((row) => {
    const hint = hintForRow(row, lookup);
    if (!hint) return row;
    const label = hint.links.find((link) => link.label)?.label;
    return {
      ...row,
      name: label ?? row.name,
      timestamp: hint.timestamp ?? row.timestamp,
    };
  });
}

async function collectActivityLogs(
  client: PublicClient,
  account: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EercLog[]> {
  const address = getAddress(account);
  const all: EercLog[] = [];
  for (const [from, to] of blockWindows(fromBlock, toBlock, EERC_ACTIVITY_LOG_WINDOW_BLOCKS)) {
    const [transferIn, transferOut, deposits, withdraws, mints, burns] = await Promise.all([
      getEventLogs(client, "PrivateTransfer", { to: address }, from, to),
      getEventLogs(client, "PrivateTransfer", { from: address }, from, to),
      getEventLogs(client, "Deposit", { user: address }, from, to),
      getEventLogs(client, "Withdraw", { user: address }, from, to),
      getEventLogs(client, "PrivateMint", { user: address }, from, to),
      getEventLogs(client, "PrivateBurn", { user: address }, from, to),
    ]);
    all.push(...transferIn, ...transferOut, ...deposits, ...withdraws, ...mints, ...burns);
  }
  return all;
}

async function getEventLogs(
  client: PublicClient,
  eventName: EercEventName,
  args: Record<string, Address>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EercLog[]> {
  const event = EVENT_BY_NAME.get(eventName);
  if (!event || !ENCRYPTED_ERC_ADDRESS) return [];
  return client.getLogs({
    address: ENCRYPTED_ERC_ADDRESS,
    args,
    event,
    fromBlock,
    toBlock,
  } as never) as Promise<EercLog[]>;
}

async function rowFromLog(input: {
  account: Address;
  blockTimes: Map<bigint, number>;
  client: PublicClient;
  eerc: EercDecryptor;
  hint?: ActivityHint;
  log: EercLog;
  logOrdinal: number;
  outflowCarry: OutflowCarry;
  unresolvedBlockTimestamps: Set<bigint>;
  usdcTokenId: bigint;
}): Promise<ActivityRow | null> {
  const txHash = input.log.transactionHash ?? input.hint?.txHash;
  const blockNumber = input.log.blockNumber ?? input.hint?.blockNumber;
  if (!txHash || blockNumber == null) return null;

  const eventName = input.log.eventName ?? input.hint?.eventName;
  const timestamp = input.hint?.timestamp ?? (await blockTimestamp(
    input.client,
    input.blockTimes,
    blockNumber,
    input.unresolvedBlockTimestamps,
  ));
  if (timestamp == null) return null;
  const logIndex = input.log.logIndex ?? input.hint?.logIndex ?? null;
  const rowId = chainRowId(txHash, logIndex, input.logOrdinal);
  const rowLogIndex = logIndex ?? undefined;

  switch (eventName) {
    case "PrivateTransfer":
      return privateTransferRow({
        account: input.account,
        blockNumber,
        client: input.client,
        eerc: input.eerc,
        id: rowId,
        log: input.log,
        logIndex: rowLogIndex,
        logOrdinal: input.logOrdinal,
        outflowCarry: input.outflowCarry,
        timestamp,
        txHash,
        usdcTokenId: input.usdcTokenId,
      });
    case "Deposit":
      return depositRow(input.log, txHash, timestamp, input.usdcTokenId, rowId, rowLogIndex);
    case "Withdraw":
      return withdrawRow(input.log, txHash, timestamp, input.usdcTokenId, rowId, rowLogIndex);
    case "PrivateMint":
      return privateMintRow({
        account: input.account,
        client: input.client,
        eerc: input.eerc,
        id: rowId,
        log: input.log,
        logIndex: rowLogIndex,
        timestamp,
        txHash,
      });
    case "PrivateBurn":
      return privateBurnRow({
        account: input.account,
        blockNumber,
        client: input.client,
        eerc: input.eerc,
        id: rowId,
        log: input.log,
        logIndex: rowLogIndex,
        logOrdinal: input.logOrdinal,
        outflowCarry: input.outflowCarry,
        timestamp,
        txHash,
      });
    default:
      return null;
  }
}

async function privateTransferRow(input: {
  account: Address;
  blockNumber: bigint;
  client: PublicClient;
  eerc: EercDecryptor;
  id: string;
  log: EercLog;
  logIndex?: number;
  logOrdinal: number;
  outflowCarry: OutflowCarry;
  timestamp: number;
  txHash: Hex;
  usdcTokenId: bigint;
}): Promise<ActivityRow | null> {
  const from = addressArg(input.log.args?.from);
  const to = addressArg(input.log.args?.to);
  if (!from || !to) return null;

  const decoded = await decodeTx(input.client, input.txHash);
  if (!decoded || decoded.functionName !== "transfer") return null;

  const args = decoded.args as readonly unknown[];
  const tokenId = bigintArg(args[1]);
  if (tokenId == null || tokenId !== input.usdcTokenId) return null;

  const proof = proofArg(args[2]);
  const balancePCT = pctArg(args[3]);
  if (!proof || !balancePCT) return null;
  const account = input.account.toLowerCase();

  if (to.toLowerCase() === account) {
    const amount = input.eerc.decryptPCT(proof.publicSignals.slice(16, 23));
    return {
      id: input.id,
      type: "receive",
      name: shortAddress(from),
      note: "Private eERC transfer decrypted on this device.",
      amount: amount.toString(),
      direction: "in",
      status: "settled",
      timestamp: input.timestamp,
      logIndex: input.logIndex,
      txHash: input.txHash,
    };
  }

  if (from.toLowerCase() === account) {
    const amount = await outflowAmount({
      account: input.account,
      balancePCT,
      blockNumber: input.blockNumber,
      eerc: input.eerc,
      logOrdinal: input.logOrdinal,
      outflowCarry: input.outflowCarry,
      tokenAddress: USDC_TOKEN_ADDRESS,
    });
    return {
      id: input.id,
      type: "send",
      name: shortAddress(to),
      note: "Private eERC transfer proved locally.",
      amount: amount.toString(),
      direction: "out",
      status: "settled",
      timestamp: input.timestamp,
      logIndex: input.logIndex,
      txHash: input.txHash,
    };
  }

  return null;
}

function depositRow(
  log: EercLog,
  txHash: Hex,
  timestamp: number,
  usdcTokenId: bigint,
  id: string,
  logIndex?: number,
): ActivityRow | null {
  const tokenId = bigintArg(log.args?.tokenId);
  if (tokenId == null || tokenId !== usdcTokenId) return null;
  const amountArg = bigintArg(log.args?.amount);
  const dustArg = bigintArg(log.args?.dust);
  if (amountArg == null || dustArg == null) return null;
  const raw = amountArg - dustArg;
  const amount = raw < 0n ? 0n : raw;
  return {
    id,
    type: "shield",
    name: "Made private",
    note: "Public deposit amount is visible; resulting eERC balance is encrypted.",
    amount: amount.toString(),
    direction: "in",
    status: "settled",
    timestamp,
    logIndex,
    txHash,
  };
}

function withdrawRow(
  log: EercLog,
  txHash: Hex,
  timestamp: number,
  usdcTokenId: bigint,
  id: string,
  logIndex?: number,
): ActivityRow | null {
  const tokenId = bigintArg(log.args?.tokenId);
  const amount = bigintArg(log.args?.amount);
  if (tokenId == null || tokenId !== usdcTokenId || amount == null) return null;
  return {
    id,
    type: "unshield",
    name: "Transfer out",
    note: "Private eERC withdrawal proved locally.",
    amount: amount.toString(),
    direction: "out",
    status: "settled",
    timestamp,
    logIndex,
    txHash,
  };
}

async function privateMintRow(input: {
  account: Address;
  client: PublicClient;
  eerc: EercDecryptor;
  id: string;
  log: EercLog;
  logIndex?: number;
  timestamp: number;
  txHash: Hex;
}): Promise<ActivityRow | null> {
  const decoded = await decodeTx(input.client, input.txHash);
  if (!decoded || decoded.functionName !== "privateMint") return null;
  // MintProof.publicSignals is uint256[24] (vs uint256[32] for a transfer), so
  // viem decodes exactly 24 elements. Passing the transfer-sized minimum here
  // would reject every mint proof and silently drop incoming private mints.
  const proof = proofArg((decoded.args as readonly unknown[])[1], 24);
  if (!proof) return null;
  const amount = input.eerc.decryptPCT(proof.publicSignals.slice(8, 15));
  return {
    id: input.id,
    type: "receive",
    name: "Private mint",
    note: "Private mint decrypted on this device.",
    amount: amount.toString(),
    direction: "in",
    status: "settled",
    timestamp: input.timestamp,
    logIndex: input.logIndex,
    txHash: input.txHash,
  };
}

async function privateBurnRow(input: {
  account: Address;
  blockNumber: bigint;
  client: PublicClient;
  eerc: EercDecryptor;
  id: string;
  log: EercLog;
  logIndex?: number;
  logOrdinal: number;
  outflowCarry: OutflowCarry;
  timestamp: number;
  txHash: Hex;
}): Promise<ActivityRow | null> {
  const decoded = await decodeTx(input.client, input.txHash);
  if (!decoded || decoded.functionName !== "privateBurn") return null;
  const args = decoded.args as readonly unknown[];
  const balancePCT = pctArg(args.length === 2 ? args[1] : args[2]);
  if (!balancePCT) return null;
  const amount = await outflowAmount({
    account: input.account,
    balancePCT,
    blockNumber: input.blockNumber,
    eerc: input.eerc,
    logOrdinal: input.logOrdinal,
    outflowCarry: input.outflowCarry,
    tokenAddress: USDC_TOKEN_ADDRESS,
  });
  return {
    id: input.id,
    type: "send",
    name: "Private burn",
    note: "Private burn proved locally.",
    amount: amount.toString(),
    direction: "out",
    status: "settled",
    timestamp: input.timestamp,
    logIndex: input.logIndex,
    txHash: input.txHash,
  };
}

async function decodeTx(client: PublicClient, txHash: Hex): Promise<DecodedCall | null> {
  try {
    const tx = await client.getTransaction({ hash: txHash });
    return decodeFunctionData({ abi: encryptedErcActivityAbi, data: tx.input }) as DecodedCall;
  } catch {
    return null;
  }
}

async function readUsdcTokenId(client: PublicClient): Promise<bigint> {
  if (!ENCRYPTED_ERC_ADDRESS || !USDC_TOKEN_ADDRESS) return EERC_USDC_TOKEN_ID;
  try {
    const tokenId = await client.readContract({
      address: ENCRYPTED_ERC_ADDRESS,
      abi: encryptedErcActivityAbi,
      functionName: "tokenIds",
      args: [USDC_TOKEN_ADDRESS],
    });
    return tokenId && tokenId !== 0n ? tokenId : EERC_USDC_TOKEN_ID;
  } catch {
    return EERC_USDC_TOKEN_ID;
  }
}

async function blockTimestamp(
  client: PublicClient,
  cache: Map<bigint, number>,
  blockNumber: bigint,
  unresolved: Set<bigint>,
): Promise<number | null> {
  const cached = cache.get(blockNumber);
  if (cached != null) return cached;
  try {
    const block = await client.getBlock({ blockNumber });
    const timestamp = Number(block.timestamp);
    cache.set(blockNumber, timestamp);
    return timestamp;
  } catch {
    unresolved.add(blockNumber);
    return null;
  }
}

function scanStartBlock(latestBlock: bigint, hints: ActivityHint[], cachedScannedTo?: bigint): bigint {
  const hintedBlocks = hints.flatMap((hint) => (hint.blockNumber == null ? [] : [hint.blockNumber]));
  const hintedStart = hintedBlocks.reduce((min, value) => (value < min ? value : min), latestBlock);
  const incrementalStart = cachedScannedTo == null
    ? EERC_ACTIVITY_START_BLOCK
    : maxBigint(EERC_ACTIVITY_START_BLOCK, cachedScannedTo > RESCAN_OVERLAP_BLOCKS ? cachedScannedTo - RESCAN_OVERLAP_BLOCKS : EERC_ACTIVITY_START_BLOCK);
  return maxBigint(EERC_ACTIVITY_START_BLOCK, minBigint(incrementalStart, hintedStart));
}

function blockWindows(fromBlock: bigint, toBlock: bigint, windowSize: bigint): Array<[bigint, bigint]> {
  const windows: Array<[bigint, bigint]> = [];
  const size = windowSize > 0n ? windowSize : 10000n;
  for (let from = fromBlock; from <= toBlock; from += size) {
    const to = from + size - 1n > toBlock ? toBlock : from + size - 1n;
    windows.push([from, to]);
  }
  return windows;
}

function sortLogsChronologically(logs: EercLog[]): EercLog[] {
  return [...logs].sort((a, b) => {
    const blockA = a.blockNumber ?? 0n;
    const blockB = b.blockNumber ?? 0n;
    if (blockA !== blockB) return blockA < blockB ? -1 : 1;
    const idxA = a.logIndex ?? Number.MAX_SAFE_INTEGER;
    const idxB = b.logIndex ?? Number.MAX_SAFE_INTEGER;
    return idxA - idxB;
  });
}

// Derive an outgoing (send/burn) amount from the post-event balancePCT, chaining
// consecutive same-block outflows so later events don't reuse a stale starting
// balance. See the OutflowCarry type for the rationale.
async function outflowAmount(input: {
  account: Address;
  balancePCT: bigint[];
  blockNumber: bigint;
  eerc: EercDecryptor;
  logOrdinal: number;
  outflowCarry: OutflowCarry;
  tokenAddress?: Address;
}): Promise<bigint> {
  const carry = input.outflowCarry.current;
  const carried = carry && carry.block === input.blockNumber && carry.ordinal === input.logOrdinal - 1
    ? carry.remaining
    : null;
  const previous = carried ?? (await input.eerc.getHistoricalBalance(
    input.account,
    input.blockNumber > 0n ? input.blockNumber - 1n : 0n,
    input.tokenAddress,
  ));
  const remaining = input.eerc.decryptPCT(input.balancePCT);
  input.outflowCarry.current = { block: input.blockNumber, ordinal: input.logOrdinal, remaining };
  return previous >= remaining ? previous - remaining : 0n;
}

function uniqueLogs(logs: EercLog[]): EercLog[] {
  const seen = new Set<string>();
  return logs.filter((log, i) => {
    const key = log.transactionHash && log.logIndex != null
      ? `${log.transactionHash}:${log.logIndex}`
      : `__idx:${i}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activityKey(row: ActivityRow): string {
  return isLogAwareActivity(row) ? row.id.toLowerCase() : row.txHash?.toLowerCase() ?? row.id;
}

function txOnlyActivityKey(row: ActivityRow): string | null {
  return row.txHash ? row.txHash.toLowerCase() : null;
}

function isTxOnlyActivity(row: ActivityRow): boolean {
  return Boolean(row.txHash && row.id.toLowerCase() === row.txHash.toLowerCase());
}

function isLogAwareActivity(row: ActivityRow): boolean {
  return Boolean(row.txHash && row.id.toLowerCase() !== row.txHash.toLowerCase());
}

function findCompatibleLogAwareKey(byKey: Map<string, ActivityRow>, row: ActivityRow): string | null {
  if (!isTxOnlyActivity(row)) return null;
  for (const [key, candidate] of byKey) {
    if (canMergeTxOnlyActivity(row, candidate)) return key;
  }
  return null;
}

function canMergeTxOnlyActivity(txOnly: ActivityRow, logAware: ActivityRow): boolean {
  return isTxOnlyActivity(txOnly) &&
    isLogAwareActivity(logAware) &&
    txOnly.txHash?.toLowerCase() === logAware.txHash?.toLowerCase() &&
    txOnly.type === logAware.type &&
    txOnly.direction === logAware.direction;
}

function mergeActivityRow(existing: ActivityRow | undefined, row: ActivityRow): ActivityRow {
  if (!existing) return row;
  return {
    ...existing,
    ...row,
    name: existing.name && existing.type === "send" ? existing.name : row.name,
    note: existing.note || row.note,
    tone: existing.tone ?? row.tone,
  };
}

function activityHintLookup(hints: ActivityHint[]): HintLookup {
  const lookup: HintLookup = {
    byLog: new Map(),
    byTx: new Map(),
  };
  for (const hint of hints) {
    if (!hint.txHash) continue;
    lookup.byTx.set(hint.txHash.toLowerCase(), hint);
    if (hint.logIndex != null) lookup.byLog.set(logHintKey(hint.txHash, hint.logIndex), hint);
  }
  return lookup;
}

function hintForLog(log: EercLog, lookup: HintLookup): ActivityHint | undefined {
  if (!log.transactionHash) return undefined;
  if (log.logIndex != null) return lookup.byLog.get(logHintKey(log.transactionHash, log.logIndex));
  return lookup.byTx.get(log.transactionHash.toLowerCase());
}

function hintForRow(row: ActivityRow, lookup: HintLookup): ActivityHint | undefined {
  if (!row.txHash) return undefined;
  if (row.logIndex != null) return lookup.byLog.get(logHintKey(row.txHash as Hex, row.logIndex));
  return lookup.byTx.get(row.txHash.toLowerCase());
}

function logHintKey(txHash: Hex, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`;
}

function chainRowId(txHash: Hex, logIndex: number | null, logOrdinal: number): string {
  return logIndex == null ? `${txHash}:idx:${logOrdinal}` : `${txHash}:${logIndex}`;
}

function minBigint(first: bigint, ...rest: bigint[]): bigint {
  return rest.reduce((min, value) => (value < min ? value : min), first);
}

function maxBigint(first: bigint, ...rest: bigint[]): bigint {
  return rest.reduce((max, value) => (value > max ? value : max), first);
}

function activityCacheKey(address: Address): string | null {
  if (!ENCRYPTED_ERC_ADDRESS) return null;
  return `${CACHE_PREFIX}:${CHAIN_ID}:${ENCRYPTED_ERC_ADDRESS.toLowerCase()}:${address.toLowerCase()}`;
}

function loadActivityCache(address: Address): { rows: ActivityRow[]; scannedTo: bigint } | null {
  if (typeof localStorage === "undefined") return null;
  const key = activityCacheKey(address);
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as {
      rows?: ActivityRow[];
      scannedTo?: string;
    } | null;
    if (!parsed?.scannedTo || !Array.isArray(parsed.rows)) return null;
    return { rows: parsed.rows, scannedTo: BigInt(parsed.scannedTo) };
  } catch {
    return null;
  }
}

function saveActivityCache(address: Address, scannedTo: bigint, rows: ActivityRow[]): void {
  if (typeof localStorage === "undefined") return;
  const key = activityCacheKey(address);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        rows: rows.slice(0, MAX_CACHED_ROWS),
        scannedTo: scannedTo.toString(),
      }),
    );
  } catch {
    /* ignore storage quota/private mode */
  }
}

// `minLength` matches the proof's on-chain publicSignals width: 32 for a
// transfer, 24 for a mint, 19 for a burn. Callers must pass the right length so
// a valid proof of a different shape is not rejected.
function proofArg(value: unknown, minLength = 32): { publicSignals: bigint[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const signals = (value as { publicSignals?: unknown }).publicSignals;
  const publicSignals = pctArray(signals, minLength);
  return publicSignals ? { publicSignals } : null;
}

function pctArg(value: unknown): bigint[] | null {
  return pctArray(value, 7);
}

function pctArray(value: unknown, minLength: number): bigint[] | null {
  if (!Array.isArray(value) || value.length < minLength) return null;
  const out: bigint[] = [];
  for (const item of value) {
    const parsed = bigintArg(item);
    if (parsed == null) return null;
    out.push(parsed);
  }
  return out;
}

function bigintArg(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function addressArg(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
