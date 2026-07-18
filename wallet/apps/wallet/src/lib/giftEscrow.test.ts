import type { BenzoAccount } from "@benzo/core";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  recoverAddress,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ESCROW: "0x00000000000000000000000000000000000000ee",
  USDC: "0x5425890298aed601595a70AB815c96711a31Bc65",
  CHAIN_ID: 43113,
  ZERO: "0x0000000000000000000000000000000000000000",
  createViemClients: vi.fn(),
  getPublicClient: vi.fn(),
  createEerc: vi.fn(),
}));
const ESCROW = getAddress(hoisted.ESCROW);
const USDC = getAddress(hoisted.USDC);
const { CHAIN_ID, ZERO } = hoisted;

vi.mock("./network", () => ({
  PRIVATE_GIFT_ESCROW_ADDRESS: hoisted.ESCROW,
  USDC_DECIMALS: 6,
}));

vi.mock("./eerc", () => ({
  createViemClients: hoisted.createViemClients,
  getPublicClient: hoisted.getPublicClient,
  createEerc: hoisted.createEerc,
}));

import {
  claimGiftOnChain,
  computeClaimDigest,
  createGiftOnChain,
  decodeGiftClaimSecret,
  encodeGiftClaimSecret,
  giftStatusLabel,
  readGiftOnChain,
  refundGiftOnChain,
} from "./giftEscrow";

type ContractCall = { address?: string; functionName?: string; args?: unknown[] };

// Mirrors the GiftCreated event in giftEscrow.ts so the stubbed receipt can emit
// a log that giftIdFromReceipt (parseEventLogs) decodes back into a giftId.
const giftCreatedEventAbi = [
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

function createdGift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sender: getAddress("0x1111111111111111111111111111111111111111"),
    claimAddress: getAddress("0x2222222222222222222222222222222222222222"),
    token: getAddress(USDC),
    recipient: ZERO,
    amount: 2_500_000n,
    createdAt: 1_000n,
    expiry: 4_000_000_000n,
    status: 0,
    ...overrides,
  };
}

/** A viem-like public/wallet client pair with call capture. */
function makeClients(opts: {
  gift?: Record<string, unknown>;
  allowance?: bigint;
  createGiftId?: bigint;
} = {}) {
  const reads: ContractCall[] = [];
  const simulations: ContractCall[] = [];
  const writes: unknown[] = [];

  const readContract = vi.fn(async (c: ContractCall) => {
    reads.push(c);
    if (c.functionName === "getGift") return opts.gift ?? createdGift();
    if (c.functionName === "allowance") return opts.allowance ?? 0n;
    return undefined;
  });
  const simulateContract = vi.fn(async (c: ContractCall) => {
    simulations.push(c);
    if (c.functionName === "createGift") {
      return { request: { __sim: "createGift", args: c.args }, result: opts.createGiftId ?? 7n };
    }
    return { request: { __sim: c.functionName, args: c.args }, result: true };
  });
  // The mined GiftCreated event is authoritative for the gift id, so the stubbed
  // receipt must carry a decodable log (not empty) or createGiftOnChain throws.
  const giftCreatedLog = {
    address: ESCROW,
    topics: encodeEventTopics({
      abi: giftCreatedEventAbi,
      eventName: "GiftCreated",
      args: {
        giftId: opts.createGiftId ?? 7n,
        sender: getAddress("0x3333333333333333333333333333333333333333"),
        claimAddress: getAddress("0x4444444444444444444444444444444444444444"),
      },
    }),
    data: encodeAbiParameters(
      [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "expiry", type: "uint64" },
      ],
      [USDC, 2_500_000n, 4_000_000_000n],
    ),
  };
  const waitForTransactionReceipt = vi.fn(async () => ({
    status: "success",
    logs: [giftCreatedLog],
  }));
  const getChainId = vi.fn(async () => CHAIN_ID);
  const writeContract = vi.fn(async (req: unknown) => {
    writes.push(req);
    return "0xwritehash" as Hex;
  });

  const publicClient = { readContract, simulateContract, waitForTransactionReceipt, getChainId };
  const walletClient = {
    account: { address: getAddress("0x3333333333333333333333333333333333333333") },
    chain: { id: CHAIN_ID },
    writeContract,
  };
  return { publicClient, walletClient, reads, simulations, writes, readContract, writeContract };
}

function fakeEerc(pct: { cipher: bigint[]; nonce: bigint; authKey: bigint[] }, publicKey: bigint[] = [111n, 222n]) {
  return {
    fetchPublicKey: vi.fn(async () => publicKey),
    register: vi.fn(async () => ({ transactionHash: "0xregister" })),
    poseidon: { processPoseidonEncryption: vi.fn(async () => pct) },
  };
}

const RECIPIENT = getAddress("0x3333333333333333333333333333333333333333");

function account(): BenzoAccount {
  return { address: RECIPIENT, evmPrivateKey: "0x00" } as unknown as BenzoAccount;
}

describe("gift claim secret codec", () => {
  it("round-trips a giftId + ephemeral key through the fragment secret", () => {
    const key = generatePrivateKey();
    const secret = encodeGiftClaimSecret(42n, key);
    expect(secret).toBe(`g42.${key.slice(2).toLowerCase()}`);
    expect(decodeGiftClaimSecret(secret)).toEqual({ giftId: 42n, claimPrivateKey: key.toLowerCase() });
  });

  it("returns null for a legacy backend claim secret", () => {
    expect(decodeGiftClaimSecret("tok_abc123")).toBeNull();
    expect(decodeGiftClaimSecret("secret_used")).toBeNull();
  });
});

describe("giftStatusLabel", () => {
  it("maps on-chain status + expiry to the claim UI vocabulary", () => {
    expect(giftStatusLabel(createdGift() as never, 1_500)).toBe("open");
    expect(giftStatusLabel(createdGift({ status: 1 }) as never, 1_500)).toBe("claimed");
    expect(giftStatusLabel(createdGift({ status: 2 }) as never, 1_500)).toBe("refunded");
    // Still Created on-chain but past expiry -> expired to the UI.
    expect(giftStatusLabel(createdGift({ expiry: 1_000n }) as never, 1_500)).toBe("expired");
  });
});

describe("createGiftOnChain", () => {
  afterEach(() => vi.clearAllMocks());

  it("escrows the amount on-chain via createGift and returns the giftId", async () => {
    const clients = makeClients({ createGiftId: 7n });
    hoisted.createViemClients.mockReturnValue(clients);

    const result = await createGiftOnChain(account(), {
      token: getAddress(USDC),
      amount: 2_500_000n,
      expirySeconds: 4_000_000_000,
    });

    expect(result.giftId).toBe(7n);
    expect(result.claimPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.claimAddress).toBe(privateKeyToAccount(result.claimPrivateKey).address);

    // createGift was simulated against the escrow with the escrowed amount.
    const createSim = clients.simulations.find((c) => c.functionName === "createGift");
    expect(createSim?.address).toBe(ESCROW);
    expect(createSim?.args?.[0]).toBe(result.claimAddress);
    expect(createSim?.args?.[1]).toBe(getAddress(USDC));
    expect(createSim?.args?.[2]).toBe(2_500_000n); // escrowed amount
    expect(createSim?.args?.[3]).toBe(4_000_000_000n); // expiry
    // Approve happened first (allowance was 0).
    expect(clients.simulations.some((c) => c.functionName === "approve")).toBe(true);
  });
});

describe("claimGiftOnChain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reads the gift on-chain and claims with a signature bound to recipient + amountPCT", async () => {
    const ephemeralKey = generatePrivateKey();
    const claimAddress = privateKeyToAccount(ephemeralKey).address;
    const gift = createdGift({ claimAddress, amount: 2_500_000n });
    const clients = makeClients({ gift });
    hoisted.createViemClients.mockReturnValue(clients);
    const pct = { cipher: [1n, 2n, 3n, 4n], nonce: 9n, authKey: [5n, 6n] };
    const eerc = fakeEerc(pct);
    hoisted.createEerc.mockResolvedValue(eerc);

    const result = await claimGiftOnChain(account(), 7n, ephemeralKey);

    // Read the gift straight from the escrow (source of truth).
    const getGiftRead = clients.reads.find((c) => c.functionName === "getGift");
    expect(getGiftRead?.address).toBe(ESCROW);
    expect(getGiftRead?.args?.[0]).toBe(7n);

    // claim() called with [giftId, recipient, sig, amountPCT].
    const claimCall = clients.writeContract.mock.calls[0][0] as ContractCall;
    expect(claimCall.functionName).toBe("claim");
    const [giftId, recipient, sig, amountPCT] = claimCall.args as [bigint, string, Hex, bigint[]];
    expect(giftId).toBe(7n);
    expect(recipient).toBe(RECIPIENT);
    // amountPCT = [...cipher, ...authKey, nonce], encrypted to the recipient key.
    expect(amountPCT).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 9n]);
    expect(eerc.poseidon.processPoseidonEncryption).toHaveBeenCalledWith({
      inputs: [2_500_000n],
      publicKey: [111n, 222n],
    });

    // The signature is the ephemeral key over the exact contract digest, binding
    // recipient + amountPCT, recovering it yields the gift's claimAddress.
    const digest = computeClaimDigest(getAddress(ESCROW), CHAIN_ID, 7n, RECIPIENT, amountPCT);
    await expect(recoverAddress({ hash: digest, signature: sig })).resolves.toBe(claimAddress);

    expect(result).toEqual({ amount: "2500000", txHash: "0xwritehash" });
  });

  it("still reads status and claims over RPC when the backend is unplugged (fetch rejects)", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    vi.stubGlobal("fetch", fetchMock);

    const ephemeralKey = generatePrivateKey();
    const claimAddress = privateKeyToAccount(ephemeralKey).address;
    const gift = createdGift({ claimAddress });

    // Read gift status over RPC (getPublicClient path) with no BFF.
    hoisted.getPublicClient.mockReturnValue(makeClients({ gift }).publicClient);
    const status = giftStatusLabel(await readGiftOnChain(7n), 1_500);
    expect(status).toBe("open");

    // Claim over RPC with the wallet clients, backend still down.
    const clients = makeClients({ gift });
    hoisted.createViemClients.mockReturnValue(clients);
    hoisted.createEerc.mockResolvedValue(fakeEerc({ cipher: [1n, 2n, 3n, 4n], nonce: 9n, authKey: [5n, 6n] }));

    const result = await claimGiftOnChain(account(), 7n, ephemeralKey);
    expect(result.txHash).toBe("0xwritehash");
    expect(clients.writeContract.mock.calls[0][0]).toMatchObject({ functionName: "claim" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to claim a gift that isn't in the Created state", async () => {
    const clients = makeClients({ gift: createdGift({ status: 1 }) });
    hoisted.createViemClients.mockReturnValue(clients);
    hoisted.createEerc.mockResolvedValue(fakeEerc({ cipher: [1n, 2n, 3n, 4n], nonce: 9n, authKey: [5n, 6n] }));
    await expect(claimGiftOnChain(account(), 7n, generatePrivateKey())).rejects.toThrow("gift_not_claimable");
    expect(clients.writeContract).not.toHaveBeenCalled();
  });
});

describe("refundGiftOnChain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls refund(giftId) against the escrow", async () => {
    const clients = makeClients();
    hoisted.createViemClients.mockReturnValue(clients);
    const result = await refundGiftOnChain(account(), 7n);
    const call = clients.writeContract.mock.calls[0][0] as ContractCall;
    expect(call.address).toBe(ESCROW);
    expect(call.functionName).toBe("refund");
    expect(call.args).toEqual([7n]);
    expect(result).toEqual({ txHash: "0xwritehash" });
  });
});
