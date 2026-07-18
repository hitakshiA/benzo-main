import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const mocks = vi.hoisted(() => ({
  activityHints: vi.fn(),
  contacts: vi.fn(),
  getLocalAccount: vi.fn(),
  getLocalAccountSummary: vi.fn(),
  isWalletUnlocked: vi.fn(),
  listLocal: vi.fn(),
  listLocalHistory: vi.fn(),
  readEercActivityClientSide: vi.fn(),
  readPublicBalanceClientSide: vi.fn(),
  readShieldedBalanceClientSide: vi.fn(),
  session: vi.fn(),
}));

vi.mock("./api", () => ({
  AUTH_CHANGED_EVENT: "benzo:auth-changed",
  api: {
    activityHints: mocks.activityHints,
    contacts: mocks.contacts,
    session: mocks.session,
  },
}));

vi.mock("./benzoClient", () => ({
  readPublicBalanceClientSide: mocks.readPublicBalanceClientSide,
  readShieldedBalanceClientSide: mocks.readShieldedBalanceClientSide,
}));

vi.mock("./localWallet", () => ({
  getLocalAccount: mocks.getLocalAccount,
  getLocalAccountSummary: mocks.getLocalAccountSummary,
  isWalletUnlocked: mocks.isWalletUnlocked,
}));

vi.mock("./history", () => ({
  listLocalHistory: mocks.listLocalHistory,
}));

vi.mock("./contacts", () => ({
  listLocal: mocks.listLocal,
}));

vi.mock("./eercActivity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./eercActivity")>()),
  readEercActivityClientSide: mocks.readEercActivityClientSide,
}));

import { WalletProvider, useWallet } from "./store";

function Probe() {
  const { error, history, loading } = useWallet();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="history">{history.map((row) => `${row.type}:${row.amount}:${row.direction}`).join("|")}</div>
    </div>
  );
}

describe("WalletProvider activity refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.isWalletUnlocked.mockReturnValue(true);
    mocks.getLocalAccount.mockReturnValue({ address: ADDRESS });
    mocks.getLocalAccountSummary.mockReturnValue({ address: ADDRESS });
    mocks.readPublicBalanceClientSide.mockResolvedValue("1000000");
    mocks.readShieldedBalanceClientSide.mockResolvedValue("4200000");
    mocks.listLocalHistory.mockReturnValue([]);
    mocks.listLocal.mockReturnValue([]);
    mocks.session.mockRejectedValue(new Error("backend unplugged"));
    mocks.contacts.mockRejectedValue(new Error("backend unplugged"));
    mocks.activityHints.mockRejectedValue(new Error("backend unplugged"));
    mocks.readEercActivityClientSide.mockResolvedValue([{
      id: TX,
      type: "receive",
      name: "0x1111...1111",
      note: "Private eERC transfer decrypted on this device.",
      amount: "4200000",
      direction: "in",
      status: "settled",
      timestamp: 1_800_000_000,
      txHash: TX,
    }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("unplug-the-backend: shows incoming RPC activity even when /activity rejects", async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    expect(screen.getByTestId("history")).toHaveTextContent("receive:4200000:in");
    expect(screen.getByTestId("error")).toHaveTextContent("");
    expect(mocks.activityHints).toHaveBeenCalled();
    expect(mocks.readEercActivityClientSide).toHaveBeenCalledWith({ address: ADDRESS }, { hints: [] });
  });

  it("drops a stale activity refresh when the wallet locks while the scan is in flight", async () => {
    mocks.activityHints.mockResolvedValue([]);
    // Simulate a logout landing mid-refresh: the wallet is already locked by the
    // time the RPC scan resolves, so its rows must be discarded rather than
    // repainting the previous account's activity.
    mocks.readEercActivityClientSide.mockImplementation(async () => {
      mocks.isWalletUnlocked.mockReturnValue(false);
      return [{
        id: TX,
        type: "receive",
        name: "0x1111...1111",
        note: "Private eERC transfer decrypted on this device.",
        amount: "4200000",
        direction: "in",
        status: "settled",
        timestamp: 1_800_000_000,
        txHash: TX,
      }];
    });

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    expect(mocks.readEercActivityClientSide).toHaveBeenCalled();
    expect(screen.getByTestId("history").textContent).toBe("");
    expect(screen.getByTestId("history")).not.toHaveTextContent("receive:4200000:in");
  });

  it("passes fetched activity hints into the RPC scan", async () => {
    const hints = [{
      blockNumber: 56879309n,
      eventName: "PrivateTransfer",
      fromAddr: null,
      links: [],
      logIndex: 4,
      toAddr: ADDRESS,
      txHash: TX,
    }];
    mocks.activityHints.mockResolvedValue(hints);

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    expect(mocks.readEercActivityClientSide).toHaveBeenCalledWith({ address: ADDRESS }, { hints });
  });
});
