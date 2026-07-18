import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shield } from "./Shield";

const walletState = vi.hoisted(() => ({
  session: {
    profile: { handle: "tester", name: "Tester" },
    handle: "tester",
    live: true,
    mode: "live",
    missing: [],
    prover: { available: ["local"], mode: "local", location: "local" },
  },
  balance: { baseUnits: "10000000", live: true },
  publicBalance: {
    baseUnits: "5000000",
    address: "0x2222222222222222222222222222222222222222",
    asset: "USDC",
    issuer: "",
    live: true,
  },
  history: [],
  contacts: [],
  loading: false,
  error: null,
  hidden: false,
  toggleHidden: vi.fn(),
  deviceVerified: true,
  refresh: vi.fn(async () => true),
  refreshBalance: vi.fn(async () => undefined),
}));

const streamMocks = vi.hoisted(() => ({
  run: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/lock", () => ({
  requireUnlock: vi.fn(async () => true),
  shouldLockOnSend: vi.fn(() => false),
}));

vi.mock("../lib/useShieldStream", () => ({
  useShieldStream: () => ({
    state: { phase: "idle" },
    receipt: null,
    run: streamMocks.run,
    reset: streamMocks.reset,
  }),
}));

describe("Shield", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletState.session.live = true;
    walletState.session.mode = "live";
    walletState.balance = { baseUnits: "10000000", live: true };
    walletState.publicBalance = {
      baseUnits: "5000000",
      address: "0x2222222222222222222222222222222222222222",
      asset: "USDC",
      issuer: "",
      live: true,
    };
    walletState.refresh.mockResolvedValue(true);
    streamMocks.run.mockResolvedValue({
      status: "settled",
      txHash: "0xshield",
      prover: "local",
      amount: "2500000",
      onChain: true,
    });
  });

  function renderShield(path = "/shield?mode=shield") {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Shield />
      </MemoryRouter>,
    );
  }

  it("blocks make-private amounts above the public USDC balance", () => {
    renderShield();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "6" } });

    expect(screen.getByTestId("shield-available")).toHaveTextContent("5.00 USDC");
    expect(screen.getByTestId("shield-low-balance")).toHaveTextContent("Not enough public USDC");
    expect(screen.getByTestId("shield-submit")).toBeDisabled();
    expect(streamMocks.run).not.toHaveBeenCalled();
  });

  it("runs unshield from review using the private balance", async () => {
    renderShield("/shield?mode=unshield");

    expect(screen.getByTestId("shield-submit")).toHaveTextContent("Cash out");
    expect(screen.getByTestId("shield-available")).toHaveTextContent("10.00 USDC");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByTestId("shield-memo"), { target: { value: "bank" } });
    fireEvent.click(screen.getByTestId("shield-submit"));
    expect(await screen.findByTestId("shield-route")).toHaveTextContent("Private balance -> Public USDC");

    fireEvent.click(screen.getByTestId("shield-confirm"));

    await waitFor(() => expect(streamMocks.run).toHaveBeenCalledWith("unshield", "2.5", "bank", "local", false));
    expect(walletState.refresh).toHaveBeenCalled();
  });

  it("blocks shield review while the chain is unavailable", () => {
    walletState.session.live = false;
    walletState.session.mode = "unavailable";
    renderShield();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });

    expect(screen.getByTestId("shield-chain-unavailable")).toHaveTextContent(/money actions are blocked/i);
    expect(screen.getByTestId("shield-submit")).toBeDisabled();
    expect(streamMocks.run).not.toHaveBeenCalled();
  });
});
