import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profile } from "./Profile";
import { NetworkProvider } from "../lib/networkContext";
import * as net from "../lib/network";

const walletState = vi.hoisted(() => ({
  session: {
    profile: { handle: "tester", name: "Tester" },
    handle: "tester",
    kycTier: 1,
    live: true,
    mode: "live",
    missing: [],
    prover: { available: ["local"], mode: "local", location: "local" },
  },
  balance: { baseUnits: "0", live: true },
  publicBalance: {
    baseUnits: "0",
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

const localMocks = vi.hoisted(() => {
  const deviceOnly = {
    bound: false,
    recoverable: false,
    status: "action-needed" as const,
    custody: "non-custodial" as const,
    label: "Device only",
    nextSteps: ["Reveal and save a backup JSON."],
  };
  const backupRevealed = {
    ...deviceOnly,
    recoverable: true,
    status: "healthy" as const,
    label: "Backup revealed",
    nextSteps: ["Restore on another device with your backup JSON. Benzo cannot recover it for you."],
    lastExportedAt: 1_725_000_000_000,
  };
  const backupSaved = {
    ...backupRevealed,
    label: "Backup saved",
    backupConfirmedAt: 1_725_000_100_000,
  };
  return {
    currentRecovery: deviceOnly,
    deviceOnly,
    backupRevealed,
    backupSaved,
    exportWallet: vi.fn(),
    getLocalAccountSummary: vi.fn(() => ({
      address: "0x2222222222222222222222222222222222222222",
      spendPub: "1",
      mvkPub: "aa",
    })),
    getLocalRecoveryStatus: vi.fn(() => deviceOnly),
    markWalletBackupConfirmed: vi.fn(),
  };
});

const lockMocks = vi.hoisted(() => ({
  getLockSettings: vi.fn(() => ({ onOpen: false, onSend: false })),
  lockCapable: vi.fn(() => true),
  requireUnlock: vi.fn(async () => true),
  setLockSettings: vi.fn(),
}));

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/chain", () => ({
  getChainStatus: vi.fn(async () => ({ sequence: 12345 })),
}));

vi.mock("../lib/lock", () => lockMocks);

vi.mock("../lib/localWallet", () => ({
  deleteWallet: vi.fn(async () => undefined),
  exportWallet: localMocks.exportWallet,
  getLocalAccountSummary: localMocks.getLocalAccountSummary,
  getLocalRecoveryStatus: localMocks.getLocalRecoveryStatus,
  markWalletBackupConfirmed: localMocks.markWalletBackupConfirmed,
}));

describe("Profile recovery export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localMocks.currentRecovery = localMocks.deviceOnly;
    localMocks.getLocalRecoveryStatus.mockImplementation(() => localMocks.currentRecovery);
    localMocks.exportWallet.mockImplementation(async () => {
      localMocks.currentRecovery = localMocks.backupRevealed;
      return JSON.stringify({
        evmPrivateKey: `0x${"1".repeat(64)}`,
        eercDecryptionKey: "2".repeat(64),
        orgSpendId: "3",
        mvkSeedHex: "4".repeat(64),
      }, null, 2);
    });
    localMocks.markWalletBackupConfirmed.mockImplementation(() => {
      localMocks.currentRecovery = localMocks.backupSaved;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals exportable recovery material after device unlock with the backend unplugged", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("backend unplugged");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Device only");

    fireEvent.click(screen.getByTestId("recovery-reveal"));

    await waitFor(() => expect(lockMocks.requireUnlock).toHaveBeenCalledOnce());
    expect(localMocks.exportWallet).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("recovery-backup-json")).toHaveTextContent("evmPrivateKey");
    expect(screen.getByTestId("recovery-backup-json")).toHaveTextContent("eercDecryptionKey");
    expect(screen.getByTestId("recovery-backup-json")).toHaveTextContent("orgSpendId");
    expect(screen.getByTestId("recovery-backup-json")).toHaveTextContent("mvkSeedHex");
    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Backup revealed");
  });

  it("confirms a revealed settings backup as saved", async () => {
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("recovery-reveal"));

    expect(await screen.findByTestId("recovery-backup-panel")).toBeInTheDocument();
    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Backup revealed");

    fireEvent.click(screen.getByTestId("recovery-confirm-saved"));

    expect(localMocks.markWalletBackupConfirmed).toHaveBeenCalledOnce();
    expect(screen.getByTestId("profile-recovery-status")).toHaveTextContent("Backup saved");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Backup saved");
  });

  it("does not export recovery material when unlock is cancelled", async () => {
    lockMocks.requireUnlock.mockResolvedValueOnce(false);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("recovery-reveal"));

    expect(await screen.findByTestId("recovery-error")).toHaveTextContent("Unlock cancelled.");
    expect(localMocks.exportWallet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("recovery-backup-json")).not.toBeInTheDocument();
  });
});

describe("Profile network switcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    net.setActiveNetwork("fuji");
    localStorage.clear();
  });
  afterEach(() => {
    net.setActiveNetwork("fuji");
    localStorage.clear();
  });

  function renderProfile() {
    return render(
      <NetworkProvider>
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </NetworkProvider>,
    );
  }

  it("shows a compact Fuji network row that opens the sheet", () => {
    renderProfile();
    expect(screen.getByTestId("network-row")).toHaveTextContent("Fuji Testnet");
    // Block height is NOT in the main row.
    expect(screen.getByTestId("network-row")).not.toHaveTextContent("#");

    fireEvent.click(screen.getByTestId("network-row"));
    expect(screen.getByTestId("network-option-fuji")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("network-option-avalanche")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("network-option-avalanche")).toHaveTextContent("Real assets");
  });

  it("reveals chain id + RPC only under Advanced", () => {
    renderProfile();
    expect(screen.queryByTestId("network-advanced")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("network-advanced-toggle"));
    expect(screen.getByTestId("network-advanced")).toHaveTextContent("43113");
  });

  it("gates a mainnet switch behind a real-assets confirm, then persists it", async () => {
    renderProfile();
    fireEvent.click(screen.getByTestId("network-row"));
    fireEvent.click(screen.getByTestId("network-option-avalanche"));

    // Confirm step first, not switched yet.
    expect(screen.getByTestId("network-confirm")).toBeInTheDocument();
    expect(net.getActiveNetwork()).toBe("fuji");

    fireEvent.click(screen.getByTestId("network-confirm-yes"));
    await waitFor(() => expect(net.getActiveNetwork()).toBe("avalanche"));
    expect(localStorage.getItem("benzo.network")).toBe("avalanche");
    expect(net.ENCRYPTED_ERC_ADDRESS).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");

    // Switch back to Fuji (a testnet needs no confirm).
    fireEvent.click(screen.getByTestId("network-row"));
    fireEvent.click(screen.getByTestId("network-option-fuji"));
    await waitFor(() => expect(net.getActiveNetwork()).toBe("fuji"));
  });
});

describe("Profile security lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localMocks.getLocalRecoveryStatus.mockImplementation(() => localMocks.deviceOnly);
  });

  function renderProfile() {
    return render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
  }

  it("offers a real Set up passkey action (no dead toggles) before one exists", () => {
    lockMocks.lockCapable.mockReturnValue(false);
    renderProfile();
    expect(screen.getByTestId("setup-passkey")).toBeInTheDocument();
    expect(screen.getByTestId("security-locked-note")).toBeInTheDocument();
    expect(screen.queryByTestId("security-toggles")).not.toBeInTheDocument();
  });

  it("reveals the lock toggles once a passkey is configured", () => {
    lockMocks.lockCapable.mockReturnValue(true);
    renderProfile();
    expect(screen.getByTestId("security-toggles")).toBeInTheDocument();
    expect(screen.getByTestId("lock-open-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("lock-send-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("setup-passkey")).not.toBeInTheDocument();
  });
});

describe("Profile deletion danger area", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockMocks.lockCapable.mockReturnValue(true);
  });

  function renderProfile() {
    return render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
  }

  it("blocks deletion until a backup is confirmed and DELETE is typed", () => {
    localMocks.getLocalRecoveryStatus.mockImplementation(() => localMocks.deviceOnly);
    renderProfile();

    fireEvent.click(screen.getByTestId("delete-open"));
    expect(screen.getByTestId("delete-needs-backup")).toBeInTheDocument();
    expect(screen.getByTestId("delete-address")).toBeInTheDocument();
    // No backup → still blocked even after typing DELETE.
    fireEvent.change(screen.getByTestId("delete-confirm-input"), { target: { value: "DELETE" } });
    expect(screen.getByTestId("delete-confirm")).toBeDisabled();
  });

  it("enables deletion only with a confirmed backup and typed confirmation", () => {
    localMocks.getLocalRecoveryStatus.mockImplementation(() => localMocks.backupSaved);
    renderProfile();

    fireEvent.click(screen.getByTestId("delete-open"));
    expect(screen.queryByTestId("delete-needs-backup")).not.toBeInTheDocument();
    expect(screen.getByTestId("delete-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-confirm-input"), { target: { value: "delete" } });
    expect(screen.getByTestId("delete-confirm")).not.toBeDisabled();
  });
});
