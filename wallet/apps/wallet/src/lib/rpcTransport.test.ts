import { describe, expect, it, vi, beforeEach } from "vitest";

const requestMock = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    http: () => () => ({ config: {}, request: requestMock, value: {} }),
  };
});

const { rpcTransport } = await import("./rpcTransport");

/** Build the transport the way viem does and hand back its request fn. */
function makeRequest() {
  return rpcTransport("https://rpc.example")({}).request as (
    args: { method: string; params?: unknown[] },
  ) => Promise<unknown>;
}

const FEE_CALL = {
  to: "0xabc",
  data: "0xdead",
  maxFeePerGas: "0xcc",
  maxPriorityFeePerGas: "0x96",
};

beforeEach(() => requestMock.mockReset());

describe("rpcTransport eth_estimateGas correction", () => {
  it("re-estimates without fee fields when the node returns an implausible allowance", async () => {
    requestMock
      .mockResolvedValueOnce("0x5a8ceb1b4c7d4") // ~1.59e15, the balance-derived allowance
      .mockResolvedValueOnce("0xcb08"); // 51,976 — the real estimate

    const result = await makeRequest()({ method: "eth_estimateGas", params: [FEE_CALL] });

    expect(result).toBe("0xcb08");
    expect(requestMock).toHaveBeenCalledTimes(2);
    const retried = requestMock.mock.calls[1][0].params[0];
    expect(retried).not.toHaveProperty("maxFeePerGas");
    expect(retried).not.toHaveProperty("maxPriorityFeePerGas");
    // Everything that defines the call itself must survive the retry.
    expect(retried).toMatchObject({ to: "0xabc", data: "0xdead" });
  });

  it("passes a normal estimate straight through", async () => {
    requestMock.mockResolvedValueOnce("0xcb08");

    const result = await makeRequest()({ method: "eth_estimateGas", params: [FEE_CALL] });

    expect(result).toBe("0xcb08");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when there are no fee fields to strip", async () => {
    // A genuinely huge estimate with no fee fields is the node's real answer,
    // so surface it rather than looping.
    requestMock.mockResolvedValueOnce("0x5a8ceb1b4c7d4");

    const result = await makeRequest()({
      method: "eth_estimateGas",
      params: [{ to: "0xabc", data: "0xdead" }],
    });

    expect(result).toBe("0x5a8ceb1b4c7d4");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the original result if the retry fails", async () => {
    requestMock
      .mockResolvedValueOnce("0x5a8ceb1b4c7d4")
      .mockRejectedValueOnce(new Error("node down"));

    const result = await makeRequest()({ method: "eth_estimateGas", params: [FEE_CALL] });

    expect(result).toBe("0x5a8ceb1b4c7d4");
  });

  it("leaves every other method untouched", async () => {
    requestMock.mockResolvedValueOnce("0x5a8ceb1b4c7d4");

    const result = await makeRequest()({ method: "eth_blockNumber", params: [] });

    expect(result).toBe("0x5a8ceb1b4c7d4");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
