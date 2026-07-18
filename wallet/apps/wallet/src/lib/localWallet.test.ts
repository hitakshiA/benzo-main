import { accountFromSignedMessage } from "@benzo/core";
import { MemoryKVStore } from "@benzo/wallet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  kv: undefined as MemoryKVStore | undefined,
  open: vi.fn(),
}));

vi.mock("@benzo/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@benzo/wallet")>();
  return {
    ...actual,
    IndexedDbKVStore: {
      open: storeMocks.open,
    },
  };
});

const passkeyMocks = vi.hoisted(() => {
  const secret = new Uint8Array(32).fill(7);
  return {
    derivePasskeySecret: vi.fn(async () => secret),
    hasPasskey: vi.fn(() => true),
    registerPasskey: vi.fn(async () => undefined),
    secret,
  };
});

const activationMocks = vi.hoisted(() => ({
  handleAvailableOnChain: vi.fn(),
  isRegisteredOnEerc: vi.fn(),
  registerEercAccount: vi.fn(),
}));

vi.mock("./passkey", () => ({
  derivePasskeySecret: passkeyMocks.derivePasskeySecret,
  hasPasskey: passkeyMocks.hasPasskey,
  registerPasskey: passkeyMocks.registerPasskey,
}));

vi.mock("./eerc", () => ({
  registerEercAccount: activationMocks.registerEercAccount,
  ensureGasFunded: vi.fn(async () => undefined),
}));

vi.mock("./handleRegistry", () => ({
  handleAvailableOnChain: activationMocks.handleAvailableOnChain,
  isRegisteredOnEerc: activationMocks.isRegisteredOnEerc,
  normalizeHandle: (handle: string) => handle.trim().replace(/^@/, "").toLowerCase(),
}));

import {
  activatePrivateBalance,
  createWallet,
  createWalletAuto,
  createWalletWithPasskey,
  exportWallet,
  getLocalAccount,
  getLocalRecoveryStatus,
  isWalletUnlocked,
  lockWallet,
  markWalletBackupConfirmed,
  tryAutoUnlock,
  unlockWalletWithPasskey,
} from "./localWallet";

describe("local wallet recovery", () => {
  beforeEach(() => {
    storeMocks.kv = new MemoryKVStore();
    storeMocks.open.mockImplementation(async () => storeMocks.kv);
    vi.clearAllMocks();
    activationMocks.handleAvailableOnChain.mockResolvedValue({ available: false });
    activationMocks.isRegisteredOnEerc.mockResolvedValue(true);
    activationMocks.registerEercAccount.mockResolvedValue(`0x${"a".repeat(64)}`);
    localStorage.clear();
  });

  afterEach(() => {
    lockWallet();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates a recoverable passkey wallet and exports with the backend unplugged", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("backend unplugged");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const account = await createWalletWithPasskey("alex");
    const expectedAccount = accountFromSignedMessage(passkeyMocks.secret);

    expect(account.address).toBe(expectedAccount.address);
    expect(account.spendSk).toBe(expectedAccount.spendSk);
    expect(passkeyMocks.registerPasskey).toHaveBeenCalledWith({ userName: "alex", displayName: "alex" });
    // One-tap create must NOT authenticate to any backend, a self-custody wallet
    // exists purely on-device (no forced SIWE in the lifecycle).
    expect(fetchMock).not.toHaveBeenCalled();

    const backup = JSON.parse(await exportWallet()) as {
      evmPrivateKey: string;
      eercDecryptionKey: string;
      orgSpendId: string;
      mvkSeedHex: string;
    };

    expect(backup).toEqual({
      evmPrivateKey: expectedAccount.evmPrivateKey,
      eercDecryptionKey: expectedAccount.eercDecryptionKey,
      orgSpendId: expectedAccount.spendSk.toString(),
      mvkSeedHex: Array.from(passkeyMocks.secret, (x) => x.toString(16).padStart(2, "0")).join(""),
    });
    expect(getLocalRecoveryStatus()).toMatchObject({
      bound: true,
      recoverable: true,
      label: "Synced passkey",
      status: "healthy",
    });
  });

  it("records explicit backup confirmation in local recovery state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");
    await exportWallet();
    markWalletBackupConfirmed();

    expect(getLocalRecoveryStatus()).toMatchObject({
      backupConfirmedAt: expect.any(Number),
      label: "Synced passkey",
      recoverable: true,
    });
  });

  it("starts a new passphrase wallet with no prior backup metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");
    await exportWallet();
    markWalletBackupConfirmed();

    expect(getLocalRecoveryStatus().backupConfirmedAt).toEqual(expect.any(Number));

    await createWallet("new passphrase");

    const status = getLocalRecoveryStatus();
    expect(status.lastExportedAt).toBeUndefined();
    expect(status.backupConfirmedAt).toBeUndefined();
    expect(status).toMatchObject({
      bound: false,
      label: "Device only",
      recoverable: false,
      status: "action-needed",
    });
  });

  it("starts a new passkey wallet with no prior backup metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");
    await exportWallet();
    markWalletBackupConfirmed();

    expect(getLocalRecoveryStatus().backupConfirmedAt).toEqual(expect.any(Number));

    await createWalletWithPasskey("new-alex");

    const status = getLocalRecoveryStatus();
    expect(status.lastExportedAt).toBeUndefined();
    expect(status.backupConfirmedAt).toBeUndefined();
    expect(status).toMatchObject({
      bound: true,
      label: "Synced passkey",
      recoverable: true,
      status: "healthy",
    });
  });

  it("lets a legacy wallet with no recovery metadata reveal a backup later", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");
    localStorage.removeItem("benzo.recovery.v1");

    await expect(exportWallet()).resolves.toContain("evmPrivateKey");

    expect(getLocalRecoveryStatus()).toMatchObject({
      bound: false,
      label: "Backup revealed",
      recoverable: true,
      status: "healthy",
    });
  });

  it("activates a new private balance by registering when the registrar has no key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    activationMocks.isRegisteredOnEerc.mockResolvedValue(false);

    const account = await createWalletWithPasskey("alex");

    await expect(activatePrivateBalance()).resolves.toEqual({
      alreadyRegistered: false,
      txHash: `0x${"a".repeat(64)}`,
    });
    expect(activationMocks.isRegisteredOnEerc).toHaveBeenCalledWith(account.address);
    expect(activationMocks.registerEercAccount).toHaveBeenCalledWith(account);
  });

  it("does not double-register when the registrar already has the wallet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    activationMocks.isRegisteredOnEerc.mockResolvedValue(true);

    const account = await createWalletWithPasskey("alex");

    await expect(activatePrivateBalance()).resolves.toEqual({
      alreadyRegistered: true,
    });
    expect(activationMocks.isRegisteredOnEerc).toHaveBeenCalledWith(account.address);
    expect(activationMocks.registerEercAccount).not.toHaveBeenCalled();
  });

  it("unlocks without any backend SIWE call", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("backend must not be called");
    });
    vi.stubGlobal("fetch", fetchMock);

    const created = await createWalletWithPasskey("alex");
    lockWallet();
    const unlocked = await unlockWalletWithPasskey();

    expect(unlocked.address).toBe(created.address);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not persist any wallet secret to web storage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unplugged");
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await createWalletWithPasskey("alex");

    // No plaintext keys anywhere in session/local storage, the sealed keychain
    // (IndexedDB) is the only place secrets live, so XSS can't lift a raw key.
    const expected = accountFromSignedMessage(passkeyMocks.secret);
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i++) {
        const value = store.getItem(store.key(i) as string) ?? "";
        expect(value).not.toContain(expected.evmPrivateKey);
        expect(value).not.toContain(expected.eercDecryptionKey);
      }
    }
    expect(sessionStorage.getItem("benzo.softSession.v1")).toBeNull();
  });

  it("device wallet: creates + silently auto-unlocks with no passkey/passcode prompt", async () => {
    const account = await createWalletAuto();
    expect(getLocalAccount()).not.toBeNull();
    expect(localStorage.getItem("benzo.wallet.type")).toBe("device");
    expect(passkeyMocks.registerPasskey).not.toHaveBeenCalled();
    expect(passkeyMocks.derivePasskeySecret).not.toHaveBeenCalled();

    // A reload drops the in-memory session; tryAutoUnlock re-opens it silently.
    lockWallet();
    expect(isWalletUnlocked()).toBe(false);
    expect(await tryAutoUnlock()).toBe(true);
    expect(getLocalAccount()?.address).toBe(account.address);
    expect(passkeyMocks.derivePasskeySecret).not.toHaveBeenCalled();
  });

  it("does not auto-unlock a legacy passkey wallet (LockGate still gates it)", async () => {
    await createWalletWithPasskey("legacy-user");
    lockWallet();
    expect(await tryAutoUnlock()).toBe(false);
    expect(isWalletUnlocked()).toBe(false);
  });
});
