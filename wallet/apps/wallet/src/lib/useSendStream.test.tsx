import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EVM_ADDRESS = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;

const mocks = vi.hoisted(() => ({
  resolveHandleOnChain: vi.fn(),
  sendClientSide: vi.fn(),
  decodeRecipient: vi.fn(),
  saveLocalHistory: vi.fn(),
}));

vi.mock("./handleRegistry", () => ({
  resolveHandleOnChain: mocks.resolveHandleOnChain,
}));

vi.mock("./benzoClient", () => ({
  sendClientSide: mocks.sendClientSide,
}));

vi.mock("./recipient", () => ({
  decodeRecipient: mocks.decodeRecipient,
}));

vi.mock("./history", () => ({
  saveLocalHistory: mocks.saveLocalHistory,
}));

import { useSendStream } from "./useSendStream";

describe("useSendStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs client-side send flow for a direct EVM address", async () => {
    mocks.sendClientSide.mockResolvedValue({ txHash: "0xtx_local", prover: "local" });
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run(EVM_ADDRESS, "2.5", "memo", "local");
    });

    expect(r).toEqual({
      status: "settled",
      txHash: "0xtx_local",
      prover: "local",
      amount: "2500000",
      onChain: true,
    });
    expect(mocks.decodeRecipient).not.toHaveBeenCalled();
    expect(mocks.sendClientSide).toHaveBeenCalledWith(EVM_ADDRESS, "2500000", "memo");
    expect(mocks.saveLocalHistory).toHaveBeenCalled();
  });

  it("resolves @handles on-chain via HandleRegistry before sending", async () => {
    mocks.decodeRecipient.mockReturnValue(null);
    mocks.resolveHandleOnChain.mockResolvedValue({
      address: EVM_ADDRESS,
      registeredOnEerc: true,
      handle: "mara",
      source: "chain",
    });
    mocks.sendClientSide.mockResolvedValue({ txHash: "0xtx_handle", prover: "local" });
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("@mara", "1", undefined, "local");
    });

    expect(r).toMatchObject({ status: "settled", txHash: "0xtx_handle" });
    expect(mocks.resolveHandleOnChain).toHaveBeenCalledWith("@mara");
    expect(mocks.sendClientSide).toHaveBeenCalledWith(EVM_ADDRESS, "1000000", undefined);
  });

  it("sends to a @handle with the BFF unreachable (no network fetch on the path)", async () => {
    // Unplug the backend: any BFF call would hit fetch and blow up.
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED: backend is down")));
    vi.stubGlobal("fetch", fetchMock);
    mocks.decodeRecipient.mockReturnValue(null);
    mocks.resolveHandleOnChain.mockResolvedValue({
      address: EVM_ADDRESS,
      registeredOnEerc: true,
      handle: "mara",
      source: "chain",
    });
    mocks.sendClientSide.mockResolvedValue({ txHash: "0xtx_offline", prover: "local" });
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("@mara", "3", undefined, "local");
    });

    expect(r).toMatchObject({ status: "settled", txHash: "0xtx_offline" });
    expect(mocks.resolveHandleOnChain).toHaveBeenCalledWith("@mara");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("uses bzr_ receive codes when they carry an EVM recipient", async () => {
    mocks.decodeRecipient.mockReturnValue({ address: EVM_ADDRESS });
    mocks.sendClientSide.mockResolvedValue({ txHash: "0xtx_bzr", prover: "local" });
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("bzr_recipient", "2.5", "memo", "local");
    });

    expect(r).toMatchObject({ status: "settled", txHash: "0xtx_bzr" });
    expect(mocks.resolveHandleOnChain).not.toHaveBeenCalled();
    expect(mocks.sendClientSide).toHaveBeenCalledWith(EVM_ADDRESS, "2500000", "memo");
  });

  it("surfaces handle resolution failures", async () => {
    mocks.decodeRecipient.mockReturnValue(null);
    mocks.resolveHandleOnChain.mockRejectedValue(new Error("handle_not_found"));
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("invalid_recipient", "2.5", "memo", "local");
    });

    expect(r).toBeNull();
    expect(result.current.state.error).toBe("handle_not_found");
  });

  it("handles client-side send failure", async () => {
    mocks.decodeRecipient.mockReturnValue({ address: EVM_ADDRESS });
    mocks.sendClientSide.mockRejectedValue(new Error("RPC timeout"));
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("bzr_recipient", "2.5", "memo", "local");
    });

    expect(r).toBeNull();
    expect(result.current.state.error).toBe("Couldn't reach Avalanche right now. Please try again.");
  });
});
