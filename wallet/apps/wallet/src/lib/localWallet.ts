import { accountFromSignedMessage, createAccount, type BenzoAccount } from "@benzo/core";
import { IndexedDbKVStore, Keychain, newSalt, passphraseWrappingKey, prfWrappingKey } from "@benzo/wallet";
import type { Hex } from "viem";
import { AUTH_CHANGED_EVENT } from "./api";
import { ensureGasFunded, registerEercAccount } from "./eerc";
import { isRegisteredOnEerc } from "./handleRegistry";
import { derivePasskeySecret, hasPasskey, registerPasskey } from "./passkey";
import { DEMO_MODE } from "../demo/flag";
import { getDemoAccount, getDemoAccountSummary } from "../demo/account";

export interface WalletSecrets {
  evmPrivateKey: Hex;
  eercDecryptionKey: string;
  orgSpendId: string;
  mvkSeedHex: string;
}

let activeKeychain: Keychain | null = null;
let activeAccount: BenzoAccount | null = null;

const WALLET_TYPE_KEY = "benzo.wallet.type";
const RECOVERY_STATE_KEY = "benzo.recovery.v1";

type WalletType = "passkey" | "passphrase" | "device";
type RecoveryBinding = "passkey-prf" | "manual-backup";

// A per-device secret (localStorage) HKDF-stretched into a wrapping key. This is
// the "device" wallet's opener: the keychain auto-unlocks on every load with NO
// prompt, no passkey scan, no passcode, the MetaMask-unlocked / Base feel.
// Tradeoff: the sealed key is reachable by anything with DOM access on this
// origin, so it's a testnet-grade default; a passcode/passkey can be layered on
// as an opt-in upgrade later.
const DEVICE_SECRET_KEY = "benzo.wallet.deviceSecret.v1";

function deviceWrappingKey(): Uint8Array {
  let hex = localStorage.getItem(DEVICE_SECRET_KEY);
  if (!hex) {
    hex = toHex(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem(DEVICE_SECRET_KEY, hex);
  }
  return prfWrappingKey(fromHex(hex));
}

interface StoredRecoveryState {
  version: 1;
  walletType: WalletType;
  binding: RecoveryBinding;
  createdAt: number;
  lastExportedAt?: number;
  backupConfirmedAt?: number;
}

export interface LocalRecoveryStatus {
  bound: boolean;
  recoverable: boolean;
  status: "healthy" | "action-needed" | "locked";
  custody: "non-custodial";
  label: string;
  nextSteps: string[];
  createdAt?: number;
  lastExportedAt?: number;
  backupConfirmedAt?: number;
}

export interface PrivateBalanceActivation {
  alreadyRegistered: boolean;
  txHash?: Hex;
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function fromHex(s: string): Uint8Array {
  const clean = s.startsWith("0x") ? s.slice(2) : s;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function secretsFromAccount(account: BenzoAccount, seed: Uint8Array): WalletSecrets {
  return {
    evmPrivateKey: account.evmPrivateKey,
    eercDecryptionKey: account.eercDecryptionKey,
    orgSpendId: account.spendSk.toString(),
    mvkSeedHex: toHex(seed),
  };
}

function accountFromSecrets(secrets: WalletSecrets): BenzoAccount {
  return createAccount({
    eercDecryptionKey: secrets.eercDecryptionKey,
    evmPrivateKey: secrets.evmPrivateKey,
    seed: fromHex(secrets.mvkSeedHex),
    spendSk: BigInt(secrets.orgSpendId),
  });
}

function readRecoveryState(): StoredRecoveryState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOVERY_STATE_KEY) || "null") as StoredRecoveryState | null;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecoveryState(next: StoredRecoveryState): void {
  try {
    localStorage.setItem(RECOVERY_STATE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function currentWalletType(): WalletType | null {
  const stored = localStorage.getItem(WALLET_TYPE_KEY);
  return stored === "passkey" || stored === "passphrase" || stored === "device" ? stored : null;
}

function updateRecoveryState(patch: Partial<StoredRecoveryState> & Pick<StoredRecoveryState, "walletType" | "binding">): void {
  const previous = readRecoveryState();
  const base: StoredRecoveryState = previous ?? {
    version: 1,
    walletType: patch.walletType,
    binding: patch.binding,
    createdAt: Date.now(),
  };
  writeRecoveryState({
    ...base,
    ...patch,
  });
}

function markBackupExported(): void {
  const previous = readRecoveryState();
  const walletType = previous?.walletType ?? currentWalletType();
  if (!walletType) return;
  writeRecoveryState({
    version: 1,
    walletType,
    binding: previous?.binding ?? "manual-backup",
    createdAt: previous?.createdAt ?? Date.now(),
    backupConfirmedAt: previous?.backupConfirmedAt,
    lastExportedAt: Date.now(),
  });
}

export function markWalletBackupConfirmed(): void {
  const previous = readRecoveryState();
  const walletType = previous?.walletType ?? currentWalletType();
  if (!walletType) return;
  writeRecoveryState({
    version: 1,
    walletType,
    binding: previous?.binding ?? "manual-backup",
    createdAt: previous?.createdAt ?? Date.now(),
    lastExportedAt: previous?.lastExportedAt ?? Date.now(),
    backupConfirmedAt: Date.now(),
  });
}

export function getLocalRecoveryStatus(): LocalRecoveryStatus {
  const state = readRecoveryState();
  const walletType = currentWalletType() ?? state?.walletType ?? null;
  const passkeyBound = walletType === "passkey" && state?.binding === "passkey-prf" && hasPasskey();
  const backupAvailable = !!state?.backupConfirmedAt || !!state?.lastExportedAt;

  if (passkeyBound) {
    return {
      bound: true,
      recoverable: true,
      status: "healthy",
      custody: "non-custodial",
      label: "Synced passkey",
      nextSteps: [
        "This wallet can be recreated from your synced passkey. Keep an export as a second backup.",
      ],
      createdAt: state?.createdAt,
      lastExportedAt: state?.lastExportedAt,
      backupConfirmedAt: state?.backupConfirmedAt,
    };
  }

  if (backupAvailable) {
    return {
      bound: false,
      recoverable: true,
      status: "healthy",
      custody: "non-custodial",
      label: state?.backupConfirmedAt ? "Backup saved" : "Backup revealed",
      nextSteps: [
        "Restore on another device with your backup JSON. Benzo cannot recover it for you.",
      ],
      createdAt: state?.createdAt,
      lastExportedAt: state?.lastExportedAt,
      backupConfirmedAt: state?.backupConfirmedAt,
    };
  }

  if (!state && !walletType) {
    return {
      bound: false,
      recoverable: false,
      status: "locked",
      custody: "non-custodial",
      label: "Wallet locked",
      nextSteps: ["Unlock this wallet to check local recovery state."],
    };
  }

  return {
    bound: false,
    recoverable: false,
    status: "action-needed",
    custody: "non-custodial",
    label: "Device only",
    nextSteps: [
      "Reveal and save a backup JSON, or create a passkey wallet on a device with synced passkeys.",
    ],
    createdAt: state?.createdAt,
    lastExportedAt: state?.lastExportedAt,
    backupConfirmedAt: state?.backupConfirmedAt,
  };
}

function notifyWalletChanged(): void {
  if (typeof window !== "undefined") {
    // The channel the store listens on to (re)load balances/history when the
    // wallet unlocks or locks. No backend round-trip involved.
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export async function getStore(): Promise<IndexedDbKVStore> {
  return IndexedDbKVStore.open("benzo-wallet", "keychain");
}

export async function walletExists(): Promise<boolean> {
  const kv = await getStore();
  return Keychain.exists(kv);
}

export function getLocalAccount(): BenzoAccount | null {
  if (DEMO_MODE) return getDemoAccount();
  return activeAccount;
}

export function isWalletUnlocked(): boolean {
  if (DEMO_MODE) return true;
  return activeAccount !== null;
}

let eercRegistrationInFlight: Promise<PrivateBalanceActivation | null> | null = null;
// Once registration is confirmed for the ACTIVE session, later sends skip the
// redundant Registrar read (transferPrivateUsdc re-checks internally anyway).
// Reset on lock so a different account re-verifies against the chain.
let eercRegistrationConfirmed = false;

export async function activatePrivateBalance(): Promise<PrivateBalanceActivation | null> {
  const account = getLocalAccount();
  if (!account) return null;
  if (eercRegistrationConfirmed) return { alreadyRegistered: true };
  if (!eercRegistrationInFlight) {
    eercRegistrationInFlight = (async () => {
      if (await isRegisteredOnEerc(account.address)) {
        return { alreadyRegistered: true };
      }
      // A brand-new wallet has no AVAX; drip gas + USDC from the faucet before the
      // first on-chain register() so activation doesn't die on "insufficient funds".
      await ensureGasFunded(account.address);
      const txHash = await registerEercAccount(account);
      return { alreadyRegistered: !txHash, txHash };
    })()
      .then((result) => {
        eercRegistrationConfirmed = true;
        return result;
      })
      .finally(() => {
        eercRegistrationInFlight = null;
      });
  }
  return eercRegistrationInFlight;
}

// Default create path: one tap, no passkey/passcode prompt. Generates the seed
// and seals it under the device key so the wallet auto-opens on every load.
export async function createWalletAuto(): Promise<BenzoAccount> {
  const kv = await getStore();
  const masterSeed = crypto.getRandomValues(new Uint8Array(32));
  const account = accountFromSignedMessage(masterSeed);
  const secrets = secretsFromAccount(account, masterSeed);

  activeKeychain = await Keychain.create({ kv, wrappingKey: deviceWrappingKey(), secrets, overwrite: true });
  activeAccount = account;

  localStorage.setItem(WALLET_TYPE_KEY, "device");
  writeRecoveryState({ version: 1, walletType: "device", binding: "manual-backup", createdAt: Date.now() });
  notifyWalletChanged();
  return account;
}

export async function createWallet(passphrase: string): Promise<BenzoAccount> {
  const kv = await getStore();
  const salt = newSalt();
  await kv.set("benzo/keychain/v1/salt", salt);

  const wrappingKey = passphraseWrappingKey(passphrase, salt);
  const masterSeed = crypto.getRandomValues(new Uint8Array(32));
  const account = accountFromSignedMessage(masterSeed);
  const secrets = secretsFromAccount(account, masterSeed);

  activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
  activeAccount = account;

  localStorage.setItem(WALLET_TYPE_KEY, "passphrase");
  writeRecoveryState({
    version: 1,
    walletType: "passphrase",
    binding: "manual-backup",
    createdAt: Date.now(),
  });
  notifyWalletChanged();
  return account;
}

export async function createWalletWithPasskey(userName: string): Promise<BenzoAccount> {
  const kv = await getStore();
  await registerPasskey({ userName, displayName: userName });

  const masterSeed = await derivePasskeySecret();
  const wrappingKey = prfWrappingKey(masterSeed);
  const account = accountFromSignedMessage(masterSeed);
  const secrets = secretsFromAccount(account, masterSeed);

  activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
  activeAccount = account;

  localStorage.setItem(WALLET_TYPE_KEY, "passkey");
  writeRecoveryState({
    version: 1,
    walletType: "passkey",
    binding: "passkey-prf",
    createdAt: Date.now(),
  });
  notifyWalletChanged();
  return account;
}

export async function unlockWallet(passphrase: string): Promise<BenzoAccount> {
  const kv = await getStore();
  const salt = await kv.get("benzo/keychain/v1/salt");
  if (!salt) throw new Error("Wallet salt not found. Try importing your wallet.");

  const wrappingKey = passphraseWrappingKey(passphrase, salt);
  const kc = await Keychain.unlock({ kv, wrappingKey });
  const account = accountFromSecrets(kc.secrets);

  activeKeychain = kc;
  activeAccount = account;
  localStorage.setItem(WALLET_TYPE_KEY, "passphrase");
  notifyWalletChanged();
  return account;
}

export async function unlockWalletWithPasskey(): Promise<BenzoAccount> {
  const kv = await getStore();
  const prfOutput = await derivePasskeySecret();
  const wrappingKey = prfWrappingKey(prfOutput);

  const kc = await Keychain.unlock({ kv, wrappingKey });
  const account = accountFromSecrets(kc.secrets);

  activeKeychain = kc;
  activeAccount = account;
  localStorage.setItem(WALLET_TYPE_KEY, "passkey");
  notifyWalletChanged();
  return account;
}

// Silent unlock for "device" wallets, no prompt. Returns false for legacy
// passkey/passphrase wallets (they still open through the LockGate).
export async function tryAutoUnlock(): Promise<boolean> {
  if (isWalletUnlocked()) return true;
  if (currentWalletType() !== "device") return false;
  try {
    const kv = await getStore();
    const kc = await Keychain.unlock({ kv, wrappingKey: deviceWrappingKey() });
    activeKeychain = kc;
    activeAccount = accountFromSecrets(kc.secrets);
    notifyWalletChanged();
    return true;
  } catch {
    return false;
  }
}

export function lockWallet(): void {
  activeKeychain?.lock();
  activeKeychain = null;
  activeAccount = null;
  // Drop any in-flight/confirmed registration so a re-unlocked (possibly
  // different) account can never inherit the prior session's result.
  eercRegistrationInFlight = null;
  eercRegistrationConfirmed = false;
  notifyWalletChanged();
}

export async function exportWallet(): Promise<string> {
  if (!activeKeychain) throw new Error("Wallet is locked");
  markBackupExported();
  return JSON.stringify(activeKeychain.secrets, null, 2);
}

export async function importWallet(importedText: string, passphrase?: string): Promise<BenzoAccount> {
  const kv = await getStore();
  let secrets: WalletSecrets;

  const cleanText = importedText.trim();
  if (cleanText.startsWith("{")) {
    const parsed = JSON.parse(cleanText) as Partial<WalletSecrets> & { stellarSecret?: string };
    if (parsed.stellarSecret) {
      throw new Error("Stellar backups belong to the retired wallet. Import an Avalanche Benzo backup JSON.");
    }
    secrets = parsed as WalletSecrets;
  } else if (/^0x[0-9a-fA-F]{64}$/.test(cleanText)) {
    const seed = fromHex(cleanText);
    const account = createAccount({ evmPrivateKey: cleanText as Hex, seed });
    secrets = secretsFromAccount(account, seed);
  } else if (/^S[A-Z2-7]{55}$/.test(cleanText)) {
    throw new Error("Stellar secret keys are not valid for the Avalanche wallet.");
  } else {
    throw new Error("Invalid import format. Provide Avalanche Benzo backup JSON or a 0x EVM private key.");
  }

  if (passphrase) {
    const salt = newSalt();
    await kv.set("benzo/keychain/v1/salt", salt);
    const wrappingKey = passphraseWrappingKey(passphrase, salt);
    activeKeychain = await Keychain.create({ kv, wrappingKey, secrets, overwrite: true });
    localStorage.setItem(WALLET_TYPE_KEY, "passphrase");
    updateRecoveryState({ walletType: "passphrase", binding: "manual-backup" });
  } else {
    // No passcode -> seal under the device key so the imported wallet auto-opens
    // with no prompt (no passkey scan).
    activeKeychain = await Keychain.create({ kv, wrappingKey: deviceWrappingKey(), secrets, overwrite: true });
    localStorage.setItem(WALLET_TYPE_KEY, "device");
    updateRecoveryState({ walletType: "device", binding: "manual-backup" });
  }

  activeAccount = accountFromSecrets(secrets);
  notifyWalletChanged();
  return activeAccount;
}

export async function deleteWallet(): Promise<void> {
  const kv = await getStore();
  if (activeKeychain) {
    await activeKeychain.wipe();
  } else {
    const kc = await Keychain.unlock({ kv, wrappingKey: new Uint8Array(32) }).catch(() => null);
    if (kc) await kc.wipe();
    else await kv.delete("benzo/keychain/v1");
  }
  await kv.delete("benzo/keychain/v1/salt");
  localStorage.removeItem(WALLET_TYPE_KEY);
  localStorage.removeItem(RECOVERY_STATE_KEY);
  lockWallet();
}

export function getLocalAccountSummary() {
  if (DEMO_MODE) return getDemoAccountSummary();
  if (!activeAccount) return null;
  return {
    address: activeAccount.address,
    spendPub: activeAccount.spendPub.toString(),
    mvkPub: toHex(activeAccount.mvkPub),
  };
}
