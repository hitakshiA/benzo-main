import type { BenzoAccount } from "@benzo/core";
import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptedErcActivityAbi,
  mergeActivityRows,
  readEercActivityClientSide,
} from "./eercActivity";
import type { ActivityRow } from "./api";

const ACCOUNT = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as Address;
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = ACCOUNT;
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const TX2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const TX3 = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;

function proof(publicSignals: bigint[]) {
  return {
    proofPoints: {
      a: [0n, 0n],
      b: [
        [0n, 0n],
        [0n, 0n],
      ],
      c: [0n, 0n],
    },
    publicSignals,
  };
}

function transferInput(amount: bigint) {
  const signals = Array.from({ length: 32 }, () => 0n);
  signals[16] = amount;
  return encodeFunctionData({
    abi: encryptedErcActivityAbi,
    functionName: "transfer",
    args: [RECIPIENT, 1n, proof(signals), [0n, 0n, 0n, 0n, 0n, 0n, 0n]],
  });
}

// Outgoing transfer: the sender's post-transfer balance is carried in balancePCT[0].
function transferOutInput(remaining: bigint) {
  const signals = Array.from({ length: 32 }, () => 0n);
  return encodeFunctionData({
    abi: encryptedErcActivityAbi,
    functionName: "transfer",
    args: [SENDER, 1n, proof(signals), [remaining, 0n, 0n, 0n, 0n, 0n, 0n]],
  });
}

// MintProof.publicSignals is uint256[24]; the amount PCT lives at indices 8..14.
function mintInput(amount: bigint) {
  const signals = Array.from({ length: 24 }, () => 0n);
  signals[8] = amount;
  return encodeFunctionData({
    abi: encryptedErcActivityAbi,
    functionName: "privateMint",
    args: [RECIPIENT, proof(signals)],
  });
}

describe("eERC RPC activity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("decrypts an incoming PrivateTransfer from logs and calldata without the BFF", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string }; args: Record<string, string> }) => {
        if (params.event.name === "PrivateTransfer" && params.args.to === ACCOUNT) {
          return [{
            args: { from: SENDER, to: ACCOUNT },
            blockNumber: 56879309n,
            eventName: "PrivateTransfer",
            logIndex: 4,
            transactionHash: TX,
          }];
        }
        return [];
      }),
      getTransaction: vi.fn().mockResolvedValue({ input: transferInput(4_200_000n) }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = {
      decryptPCT: vi.fn((pct: bigint[]) => pct[0]),
      getHistoricalBalance: vi.fn(),
    };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        amount: "4200000",
        direction: "in",
        name: "0x1111...1111",
        status: "settled",
        txHash: TX,
        type: "receive",
      }),
    ]);
    expect(eerc.decryptPCT).toHaveBeenCalledWith(expect.arrayContaining([4_200_000n]));
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      args: { to: ACCOUNT },
      fromBlock: 56879304n,
      toBlock: 56879310n,
    }));
  });

  it("decrypts an incoming PrivateMint from its 24-signal proof so the mint row is visible", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string }; args: Record<string, string> }) => {
        if (params.event.name === "PrivateMint" && params.args.user === ACCOUNT) {
          return [{
            args: { user: ACCOUNT },
            blockNumber: 56879309n,
            eventName: "PrivateMint",
            logIndex: 3,
            transactionHash: TX,
          }];
        }
        return [];
      }),
      getTransaction: vi.fn().mockResolvedValue({ input: mintInput(7_500_000n) }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = {
      decryptPCT: vi.fn((pct: bigint[]) => pct[0]),
      getHistoricalBalance: vi.fn(),
    };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        amount: "7500000",
        direction: "in",
        name: "Private mint",
        status: "settled",
        txHash: TX,
        type: "receive",
      }),
    ]);
    expect(eerc.decryptPCT).toHaveBeenCalledWith(expect.arrayContaining([7_500_000n]));
  });

  it("carries the sender balance across two outflows in one block instead of overstating the second", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string }; args: Record<string, string> }) => {
        if (params.event.name === "PrivateTransfer" && params.args.from === ACCOUNT) {
          return [
            {
              args: { from: ACCOUNT, to: SENDER },
              blockNumber: 56879309n,
              eventName: "PrivateTransfer",
              logIndex: 1,
              transactionHash: TX,
            },
            {
              args: { from: ACCOUNT, to: SENDER },
              blockNumber: 56879309n,
              eventName: "PrivateTransfer",
              logIndex: 2,
              transactionHash: TX2,
            },
          ];
        }
        return [];
      }),
      getTransaction: vi.fn(async ({ hash }: { hash: string }) => ({
        input: transferOutInput(hash === TX ? 60n : 25n),
      })),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = {
      decryptPCT: vi.fn((pct: bigint[]) => pct[0]),
      getHistoricalBalance: vi.fn().mockResolvedValue(100n),
    };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    const byTx = Object.fromEntries(rows.map((row) => [row.txHash, row.amount]));
    // First outflow: 100 - 60 = 40. Second carries forward from 60 (not another
    // read of block-1's 100), so 60 - 25 = 35 rather than the overstated 75.
    expect(byTx[TX]).toBe("40");
    expect(byTx[TX2]).toBe("35");
    expect(eerc.getHistoricalBalance).toHaveBeenCalledTimes(1);
  });

  it("lets chain rows replace same-tx local rows so amounts are not stale", () => {
    const local: ActivityRow = {
      id: TX,
      type: "send",
      name: "@mara",
      note: "coffee",
      amount: "1",
      direction: "out",
      status: "settled",
      timestamp: 10,
      txHash: TX,
    };
    const chain: ActivityRow = {
      ...local,
      id: `${TX}:4`,
      logIndex: 4,
      name: "0x2222...2222",
      note: "Private eERC transfer proved locally.",
      amount: "2500000",
      timestamp: 20,
    };

    expect(mergeActivityRows([local], [chain])).toEqual([
      expect.objectContaining({
        amount: "2500000",
        id: `${TX}:4`,
        name: "@mara",
        note: "coffee",
        timestamp: 20,
      }),
    ]);
  });

  it("floors malformed Deposit dust greater than amount to zero", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string } }) => {
        if (params.event.name !== "Deposit") return [];
        return [{
          args: { amount: 100n, dust: 200n, tokenId: 1n },
          blockNumber: 56879309n,
          eventName: "Deposit",
          logIndex: 5,
          transactionHash: TX,
        }];
      }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = { decryptPCT: vi.fn(), getHistoricalBalance: vi.fn() };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    expect(rows).toEqual([expect.objectContaining({
      amount: "0",
      id: `${TX}:5`,
      type: "shield",
    })]);
  });

  it("keeps same-transaction logs without log indexes distinct via the index fallback", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string } }) => {
        if (params.event.name !== "Deposit") return [];
        return [
          {
            args: { amount: 111n, dust: 0n, tokenId: 1n },
            blockNumber: 56879309n,
            eventName: "Deposit",
            transactionHash: TX,
          },
          {
            args: { amount: 222n, dust: 0n, tokenId: 1n },
            blockNumber: 56879309n,
            eventName: "Deposit",
            transactionHash: TX,
          },
        ];
      }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = { decryptPCT: vi.fn(), getHistoricalBalance: vi.fn() };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual([`${TX}:idx:0`, `${TX}:idx:1`]);
    expect(rows.map((row) => row.amount)).toEqual(["111", "222"]);
  });

  it("does not collapse distinct chain events from the same transaction", () => {
    const first: ActivityRow = {
      id: `${TX}:1`,
      type: "shield",
      name: "Made private",
      note: "",
      amount: "100",
      direction: "in",
      status: "settled",
      timestamp: 10,
      logIndex: 1,
      txHash: TX,
    };
    const second: ActivityRow = {
      ...first,
      id: `${TX}:2`,
      amount: "200",
      logIndex: 2,
    };

    expect(mergeActivityRows([first, second])).toEqual([
      expect.objectContaining({ amount: "100", id: `${TX}:1` }),
      expect.objectContaining({ amount: "200", id: `${TX}:2` }),
    ]);
  });

  it("skips one bad log and keeps later valid activity", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string }; args: Record<string, string> }) => {
        if (params.event.name === "PrivateTransfer" && params.args.to === ACCOUNT) {
          return [
            {
              args: { from: SENDER, to: ACCOUNT },
              blockNumber: 56879309n,
              eventName: "PrivateTransfer",
              logIndex: 1,
              transactionHash: TX,
            },
            {
              args: { from: SENDER, to: ACCOUNT },
              blockNumber: 56879310n,
              eventName: "PrivateTransfer",
              logIndex: 2,
              transactionHash: TX2,
            },
          ];
        }
        return [];
      }),
      getTransaction: vi.fn(async ({ hash }: { hash: string }) => ({
        input: transferInput(hash === TX ? 1_000_000n : 2_000_000n),
      })),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = {
      decryptPCT: vi.fn((pct: bigint[]) => {
        if (pct[0] === 1_000_000n) throw new Error("bad decrypt");
        return pct[0];
      }),
      getHistoricalBalance: vi.fn(),
    };

    const rows = await readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    );

    expect(rows).toEqual([expect.objectContaining({
      amount: "2000000",
      id: `${TX2}:2`,
      txHash: TX2,
    })]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("drops malformed Deposit events instead of fabricating zero-amount rows", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string } }) => {
        if (params.event.name !== "Deposit") return [];
        return [{
          args: { dust: 0n, tokenId: 1n },
          blockNumber: 56879309n,
          eventName: "Deposit",
          logIndex: 5,
          transactionHash: TX,
        }];
      }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    } as unknown as PublicClient;
    const eerc = { decryptPCT: vi.fn(), getHistoricalBalance: vi.fn() };

    await expect(readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    )).resolves.toEqual([]);
  });

  it("does not cache a fabricated timestamp when block lookup fails", async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string } }) => {
        if (params.event.name !== "Deposit") return [];
        return [{
          args: { amount: 100n, dust: 0n, tokenId: 1n },
          blockNumber: 56879309n,
          eventName: "Deposit",
          logIndex: 5,
          transactionHash: TX3,
        }];
      }),
      getBlock: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    } as unknown as PublicClient;
    const eerc = { decryptPCT: vi.fn(), getHistoricalBalance: vi.fn() };

    await expect(readEercActivityClientSide(
      { address: ACCOUNT } as BenzoAccount,
      { client, eerc },
    )).resolves.toEqual([]);

    // A row whose block timestamp could not be read is dropped rather than
    // fabricated, so nothing untrustworthy can reach the cache.
    const cached = Object.keys(localStorage)
      .map((k) => JSON.parse(localStorage.getItem(k) ?? "{}"))
      .flatMap((entry) => entry.rows ?? []);
    expect(cached).toEqual([]);
  });

  it("still advances the scan cursor past the blocks it did resolve", async () => {
    // The cursor must survive a partial scan. Discarding it whenever any timestamp
    // fails is self-reinforcing under rate limiting: every later poll rescans the
    // full history, which draws more failures, so the cursor never advances.
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async (params: { event: { name: string } }) => {
        if (params.event.name !== "Deposit") return [];
        return [{
          args: { amount: 100n, dust: 0n, tokenId: 1n },
          blockNumber: 56879309n,
          eventName: "Deposit",
          logIndex: 5,
          transactionHash: TX3,
        }];
      }),
      getBlock: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    } as unknown as PublicClient;
    const eerc = { decryptPCT: vi.fn(), getHistoricalBalance: vi.fn() };

    await readEercActivityClientSide({ address: ACCOUNT } as BenzoAccount, { client, eerc });

    const entries = Object.keys(localStorage).map((k) =>
      JSON.parse(localStorage.getItem(k) ?? "{}"),
    );
    expect(entries).toHaveLength(1);
    // Stops one short of the block that failed, so that block is retried next pass.
    expect(entries[0].scannedTo).toBe("56879308");
  });
});

describe("eERC activity single-flight", () => {
  it("shares one scan between overlapping callers", async () => {
    let getLogsCalls = 0;
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(56879310n),
      readContract: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn(async () => { getLogsCalls++; return []; }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1n }),
    } as unknown as PublicClient;
    const eerc = { decryptPCT: vi.fn(), getHistoricalBalance: vi.fn() };
    const account = { address: ACCOUNT } as BenzoAccount;

    // Three concurrent refreshes must cost one scan, not three.
    await Promise.all([
      readEercActivityClientSide(account, { client, eerc }),
      readEercActivityClientSide(account, { client, eerc }),
      readEercActivityClientSide(account, { client, eerc }),
    ]);
    const afterConcurrent = getLogsCalls;
    expect(afterConcurrent).toBeGreaterThan(0);

    // Once settled the guard clears, so a later refresh still scans.
    await readEercActivityClientSide(account, { client, eerc });
    expect(getLogsCalls).toBeGreaterThan(afterConcurrent);
  });
});
