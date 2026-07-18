import type { BenzoAccount } from "@benzo/core";
import { getAddress, type PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

// Hoisted with vi.mock so the module-mock factories below can reference them.
const hoisted = vi.hoisted(() => ({
  REGISTRY: "0x00000000000000000000000000000000000000Aa",
  REGISTRAR: "0x00000000000000000000000000000000000000Bb",
  createViemClients: vi.fn(),
  getPublicClient: vi.fn(),
}));
const { REGISTRY, REGISTRAR } = hoisted;
const eercMocks = hoisted;

vi.mock("./network", () => ({
  HANDLE_REGISTRY_ADDRESS: hoisted.REGISTRY,
  REGISTRAR_ADDRESS: hoisted.REGISTRAR,
}));

vi.mock("./eerc", () => ({
  createViemClients: hoisted.createViemClients,
  getPublicClient: hoisted.getPublicClient,
}));

import {
  claimHandleOnChain,
  handleAvailableOnChain,
  isValidHandle,
  normalizeHandle,
  resolveHandleOnChain,
} from "./handleRegistry";

type ReadArgs = { functionName: string; args?: unknown[] };

function fakeClient(
  handlers: Partial<Record<string, (a: ReadArgs) => unknown>> = {},
): { client: { readContract: ReturnType<typeof vi.fn> }; readContract: ReturnType<typeof vi.fn> } {
  const readContract = vi.fn(async (a: ReadArgs) => {
    const handler = handlers[a.functionName];
    if (handler) return handler(a);
    if (a.functionName === "resolve") return OWNER;
    if (a.functionName === "isUserRegistered") return true;
    if (a.functionName === "handleOf") return "alice";
    return undefined;
  });
  return { client: { readContract }, readContract };
}

describe("normalizeHandle / isValidHandle", () => {
  it("strips a leading @ and lowercases so @Alice == alice", () => {
    expect(normalizeHandle("@Alice")).toBe("alice");
    expect(normalizeHandle("  @ALICE ")).toBe("alice");
    expect(normalizeHandle("alice")).toBe(normalizeHandle("@Alice"));
  });

  it("enforces the registry charset and 3-32 length", () => {
    expect(isValidHandle("@Alice")).toBe(true);
    expect(isValidHandle("ab")).toBe(false);
    expect(isValidHandle("bad-dash")).toBe(false);
    expect(isValidHandle("a".repeat(33))).toBe(false);
  });
});

describe("resolveHandleOnChain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves a @handle via HandleRegistry.resolve with no BFF call", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("BFF must not be reached")));
    vi.stubGlobal("fetch", fetchMock);
    const { client, readContract } = fakeClient();

    const resolved = await resolveHandleOnChain("@alice", client as unknown as PublicClient);

    expect(resolved).toEqual({
      address: getAddress(OWNER),
      registeredOnEerc: true,
      handle: "alice",
      source: "chain",
    });
    // resolve() read against the registry, isUserRegistered() against the registrar.
    expect(readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ address: REGISTRY, functionName: "resolve", args: ["alice"] }),
    );
    expect(readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ address: REGISTRAR, functionName: "isUserRegistered", args: [getAddress(OWNER)] }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still resolves the address when the backend is unplugged (fetch throws)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));
    const { client } = fakeClient();

    await expect(resolveHandleOnChain("@alice", client as unknown as PublicClient)).resolves.toMatchObject({
      address: getAddress(OWNER),
      source: "chain",
    });
  });

  it("normalizes so @Alice resolves the same registry key as alice", async () => {
    const upper = fakeClient();
    const lower = fakeClient();

    await resolveHandleOnChain("@Alice", upper.client as unknown as PublicClient);
    await resolveHandleOnChain("alice", lower.client as unknown as PublicClient);

    expect(upper.readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ functionName: "resolve", args: ["alice"] }),
    );
    expect(lower.readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ functionName: "resolve", args: ["alice"] }),
    );
  });

  it("throws handle_not_found for an unclaimed handle", async () => {
    const { client } = fakeClient({ resolve: () => ZERO });
    await expect(resolveHandleOnChain("@ghost", client as unknown as PublicClient)).rejects.toThrow(
      "handle_not_found",
    );
  });

  it("throws invalid_handle without reading the chain for a malformed handle", async () => {
    const { client, readContract } = fakeClient();
    await expect(resolveHandleOnChain("ab", client as unknown as PublicClient)).rejects.toThrow(
      "invalid_handle",
    );
    expect(readContract).not.toHaveBeenCalled();
  });

  it("degrades registeredOnEerc to false when the registrar read fails", async () => {
    const { client } = fakeClient({
      isUserRegistered: () => {
        throw new Error("registrar unavailable");
      },
    });
    await expect(resolveHandleOnChain("@alice", client as unknown as PublicClient)).resolves.toMatchObject({
      address: getAddress(OWNER),
      registeredOnEerc: false,
    });
  });
});

describe("handleAvailableOnChain", () => {
  it("reports an unclaimed handle available and a claimed one taken", async () => {
    const free = fakeClient({ resolve: () => ZERO });
    const taken = fakeClient({ resolve: () => OWNER });

    await expect(handleAvailableOnChain("@new_handle", free.client as unknown as PublicClient)).resolves.toEqual({
      available: true,
    });
    await expect(handleAvailableOnChain("@alice", taken.client as unknown as PublicClient)).resolves.toEqual({
      available: false,
    });
  });

  it("reports invalid handles as unavailable without a chain read", async () => {
    const { client, readContract } = fakeClient();
    await expect(handleAvailableOnChain("ab", client as unknown as PublicClient)).resolves.toEqual({
      available: false,
    });
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("claimHandleOnChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs a claim from the user's own wallet so ownerOf == the user address", async () => {
    const writeContract = vi.fn(async () => "0xclaimtx");
    const waitForTransactionReceipt = vi.fn(async () => ({ status: "success" }));
    eercMocks.createViemClients.mockReturnValue({
      publicClient: { waitForTransactionReceipt },
      walletClient: { account: { address: OWNER }, chain: { id: 43113 }, writeContract },
    });
    const account = { address: OWNER, evmPrivateKey: "0x00" } as unknown as BenzoAccount;

    const result = await claimHandleOnChain(account, "@Alice");

    expect(eercMocks.createViemClients).toHaveBeenCalledWith(account);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: REGISTRY, functionName: "claim", args: ["alice"] }),
    );
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xclaimtx" });
    expect(result).toEqual({ handle: "alice", txHash: "0xclaimtx", address: OWNER });
  });
});
