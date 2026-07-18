import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shieldPublicUsdcClientSide: vi.fn(),
  unshieldPrivateUsdcClientSide: vi.fn(),
  saveLocalHistory: vi.fn(),
}));

vi.mock("./benzoClient", () => ({
  shieldPublicUsdcClientSide: mocks.shieldPublicUsdcClientSide,
  unshieldPrivateUsdcClientSide: mocks.unshieldPrivateUsdcClientSide,
}));

vi.mock("./history", () => ({
  saveLocalHistory: mocks.saveLocalHistory,
}));

import { useShieldStream } from "./useShieldStream";

describe("useShieldStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the client-side shield flow and records local history", async () => {
    mocks.shieldPublicUsdcClientSide.mockResolvedValue({ txHash: "0xshield", approvalTxHash: "0xapprove", prover: "local" });
    const { result } = renderHook(() => useShieldStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("shield", "12.5", "deposit", "local");
    });

    expect(r).toEqual({
      status: "settled",
      txHash: "0xshield",
      prover: "local",
      amount: "12500000",
      onChain: true,
    });
    expect(mocks.shieldPublicUsdcClientSide).toHaveBeenCalledWith("12500000", "deposit");
    expect(mocks.unshieldPrivateUsdcClientSide).not.toHaveBeenCalled();
    expect(mocks.saveLocalHistory).toHaveBeenCalledWith(expect.objectContaining({
      id: "0xshield",
      type: "shield",
      name: "Made private",
      note: "deposit",
      amount: "12500000",
      direction: "in",
      status: "settled",
      txHash: "0xshield",
    }));
  });

  it("runs the client-side unshield flow and records a cash-out row", async () => {
    mocks.unshieldPrivateUsdcClientSide.mockResolvedValue({ txHash: "0xunshield", prover: "local" });
    const { result } = renderHook(() => useShieldStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("unshield", "3", undefined, "local");
    });

    expect(r).toMatchObject({ status: "settled", txHash: "0xunshield", amount: "3000000" });
    expect(mocks.unshieldPrivateUsdcClientSide).toHaveBeenCalledWith("3000000", undefined);
    expect(mocks.shieldPublicUsdcClientSide).not.toHaveBeenCalled();
    expect(mocks.saveLocalHistory).toHaveBeenCalledWith(expect.objectContaining({
      type: "unshield",
      name: "Cash out",
      note: "Private USDC to public balance",
      direction: "out",
    }));
  });

  it("surfaces client-side shield failures", async () => {
    mocks.shieldPublicUsdcClientSide.mockRejectedValue(new Error("RPC timeout"));
    const { result } = renderHook(() => useShieldStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("shield", "2.5", undefined, "local");
    });

    expect(r).toBeNull();
    expect(result.current.state.error).toBe("Couldn't reach Avalanche right now. Please try again.");
    expect(mocks.saveLocalHistory).not.toHaveBeenCalled();
  });

  it("fails invalid amounts before starting the client-side shield flow", async () => {
    const { result } = renderHook(() => useShieldStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("shield", "0", undefined, "local");
    });

    expect(r).toBeNull();
    expect(result.current.state).toMatchObject({ phase: "failed", error: "Enter an amount above $0." });
    expect(mocks.shieldPublicUsdcClientSide).not.toHaveBeenCalled();
    expect(mocks.unshieldPrivateUsdcClientSide).not.toHaveBeenCalled();
  });
});
