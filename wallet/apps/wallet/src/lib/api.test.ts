import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registryMocks = vi.hoisted(() => ({ handleAvailableOnChain: vi.fn() }));
vi.mock("./handleRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./handleRegistry")>()),
  handleAvailableOnChain: registryMocks.handleAvailableOnChain,
}));

import {
  api,
  apiHref,
  prepareApiRequest,
  siweAddressLooksWellFormed,
} from "./api";

const ADDRESS = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("wallet API on Avalanche services/api", () => {
  beforeEach(() => {
    registryMocks.handleAvailableOnChain.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses cookie credentials and reuses idempotency keys until a write completes", () => {
    const first = prepareApiRequest("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: "alice" }),
    });
    const retry = prepareApiRequest("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: "alice" }),
    });

    const firstKey = (first.init.headers as Headers).get("idempotency-key");
    const retryKey = (retry.init.headers as Headers).get("idempotency-key");
    expect(first.url).toBe(apiHref("/handles"));
    expect(first.init.credentials).toBe("include");
    expect((first.init.headers as Headers).get("authorization")).toBeNull();
    expect(firstKey).toMatch(/^idem_/);
    expect(retryKey).toBe(firstKey);

    first.clearIdempotency?.();
    const next = prepareApiRequest("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: "alice" }),
    });
    expect((next.init.headers as Headers).get("idempotency-key")).not.toBe(firstKey);
  });

  it("signs in with SIWE using nonce and verify endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ nonce: "abc12345", expiresAt: "2026-07-07T00:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ user: { address: ADDRESS, id: "usr_1", roles: ["user"] } }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "0x1234" as const);

    await expect(api.signInWithSiwe(ADDRESS, signMessage)).resolves.toMatchObject({
      user: { address: ADDRESS },
    });

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref(`/auth/nonce?address=${encodeURIComponent(ADDRESS)}`));
    expect(fetchMock.mock.calls[1][0]).toBe(apiHref("/auth/verify"));
    const verifyBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
      message: string;
      signature: string;
    };
    expect(verifyBody.message).toContain("Sign in to Benzo Wallet.");
    expect(verifyBody.message).toContain("abc12345");
    expect(verifyBody.signature).toBe("0x1234");
    expect(localStorage.getItem("benzo.siweAddress")).toBe(ADDRESS.toLowerCase());
  });

  it("maps /auth/me into the wallet session shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      user: { address: ADDRESS, id: "usr_1", roles: ["user"] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.session()).resolves.toMatchObject({
      handle: ADDRESS,
      live: true,
      mode: "live",
      prover: { available: ["local"], mode: "local", location: "local" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/auth/me"));
  });

  it("reads handle availability from the on-chain registry, not the BFF", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("BFF must not be called")));
    vi.stubGlobal("fetch", fetchMock);
    registryMocks.handleAvailableOnChain
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce({ available: false });

    await expect(api.handleAvailable("@alice")).resolves.toEqual({ available: true });
    await expect(api.handleAvailable("@alice")).resolves.toEqual({ available: false });
    expect(registryMocks.handleAvailableOnChain).toHaveBeenCalledWith("@alice");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps /activity as optional indexer hints without fabricating display amounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      activity: [{
        blockNumber: "56879309",
        eventName: "PrivateTransfer",
        logIndex: 4,
        links: [
          [],
          { label: "Gift claim", objectType: "invite" },
          null,
        ],
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toAddr: ADDRESS,
        blockTime: "2026-07-07T00:00:00.000Z",
      }],
      nextCursor: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const hints = await api.activityHints();
    expect(hints).toEqual([expect.objectContaining({
      blockNumber: 56879309n,
      eventName: "PrivateTransfer",
      logIndex: 4,
      timestamp: 1_783_382_400,
      toAddr: ADDRESS,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })]);
    expect(hints[0]?.links).toEqual([{ label: "Gift claim", objectType: "invite" }]);
  });

  it("times out hanging read requests with a clean error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.session();
    const assertion = expect(pending).rejects.toThrow("This is taking too long. Please try again.");
    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not eject a self-custody wallet on a backend 401 (no auth bus)", async () => {
    // A 401 must be a non-event: it throws for the caller to catch, but never
    // clears local state or fires an auth-required bus (that bus was removed).
    localStorage.setItem("benzo.siweAddress", ADDRESS.toLowerCase());
    const onAuthRequired = vi.fn();
    window.addEventListener("benzo:auth-required", onAuthRequired);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "SIWE session required" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.session()).rejects.toThrow("SIWE session required");

    expect(localStorage.getItem("benzo.siweAddress")).toBe(ADDRESS.toLowerCase());
    expect(onAuthRequired).not.toHaveBeenCalled();
    window.removeEventListener("benzo:auth-required", onAuthRequired);
  });

  it("classifies stored SIWE addresses before protected screens mount", () => {
    expect(siweAddressLooksWellFormed(null)).toBe(false);
    expect(siweAddressLooksWellFormed("benzo-test.not-json.sig")).toBe(false);
    expect(siweAddressLooksWellFormed("0xabc")).toBe(false);
    expect(siweAddressLooksWellFormed(ADDRESS.toLowerCase())).toBe(true);
  });

  it("does not expose removed money-flow stubs", () => {
    const surface = api as unknown as Record<string, unknown>;
    expect(surface.addMoney).toBeUndefined();
    expect(surface.cashOut).toBeUndefined();
    expect(surface.importDeposit).toBeUndefined();
    expect(surface.makePublic).toBeUndefined();
    expect(surface.sendPublic).toBeUndefined();
    expect(surface.claim).toBeUndefined();
    expect(surface.claimStatus).toBeUndefined();
    expect(surface.shareProof).toBeUndefined();
  });
});
