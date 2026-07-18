import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Hex, verifyMessage } from "viem";
import { fromHex, toHex } from "./crypto/bytes.js";

const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const SECP256K1_ORDER =
  115792089237316195423570985008687907852837564279074904382605163141518161494337n;

export interface BenzoRecipient {
  address?: Hex;
  spendPub: bigint;
  viewPub: Uint8Array;
  mvkScalar?: bigint;
  label?: string;
}

export interface BenzoAccount {
  label: string;
  address: Hex;
  evmAddress: Hex;
  evmPrivateKey: Hex;
  eercDecryptionKey: string;
  spendSk: bigint;
  spendPub: bigint;
  mvkSecret: Uint8Array;
  mvkPub: Uint8Array;
  mvkScalar: bigint;
  viewSecret: Uint8Array;
  viewPub: Uint8Array;
}

export type ClaimAppScope = "consumer" | "business";
export type SignMessage = (message: string) => Promise<Uint8Array | Hex> | Uint8Array | Hex;

export const NOTE_KEY_MESSAGE = "BENZO-EERC-KEY-v1";

function randomBytes(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("secure random source unavailable");
  }
  return cryptoApi.getRandomValues(new Uint8Array(length));
}

function bytes(input: Uint8Array | string): Uint8Array {
  return typeof input === "string" ? fromHex(input) : input;
}

function deriveBytes(ikm: Uint8Array, info: string, length = 32): Uint8Array {
  return new Uint8Array(hkdf(sha256, ikm, undefined, info, length));
}

function scalarFromBytes(input: Uint8Array, modulus: bigint): bigint {
  return BigInt(`0x${toHex(input)}`) % modulus;
}

function privateKeyFromSeed(seed: Uint8Array): Hex {
  const raw = scalarFromBytes(seed, SECP256K1_ORDER - 1n) + 1n;
  return `0x${raw.toString(16).padStart(64, "0")}`;
}

function eercKeyFromSeed(seed: Uint8Array): string {
  return toHex(seed).slice(0, 64).padStart(64, "0");
}

function pubBytes(seed: Uint8Array, domain: string): Uint8Array {
  return deriveBytes(seed, `benzo/eerc/${domain}`, 32);
}

export function createAccount(
  opts: {
    label?: string;
    seed?: Uint8Array;
    spendSk?: bigint;
    mvkSecret?: Uint8Array;
    viewSecret?: Uint8Array;
    evmPrivateKey?: Hex;
    eercDecryptionKey?: string;
  } = {},
): BenzoAccount {
  const seed = opts.seed ?? randomBytes(32);
  const privateKey = opts.evmPrivateKey ?? privateKeyFromSeed(deriveBytes(seed, "benzo/eerc/evm-private-key"));
  const account = privateKeyToAccount(privateKey);
  const spendSk =
    opts.spendSk ?? scalarFromBytes(deriveBytes(seed, "benzo/eerc/spend-scalar"), BN254_FIELD_MODULUS);
  const mvkSecret = opts.mvkSecret ?? deriveBytes(seed, "benzo/eerc/mvk-secret");
  const viewSecret = opts.viewSecret ?? deriveBytes(seed, "benzo/eerc/view-secret");
  const eercDecryptionKey =
    opts.eercDecryptionKey ?? eercKeyFromSeed(deriveBytes(seed, "benzo/eerc/decryption-key"));
  const address = getAddress(account.address) as Hex;

  return {
    label: opts.label ?? "benzo-account",
    address,
    evmAddress: address,
    evmPrivateKey: privateKey,
    eercDecryptionKey,
    spendSk,
    spendPub: scalarFromBytes(pubBytes(seed, "spend-pub"), BN254_FIELD_MODULUS),
    mvkSecret,
    mvkPub: pubBytes(mvkSecret, "mvk-pub"),
    mvkScalar: scalarFromBytes(mvkSecret, BN254_FIELD_MODULUS),
    viewSecret,
    viewPub: pubBytes(viewSecret, "view-pub"),
  };
}

export function accountFromClaimSecret(secret: Uint8Array, app: ClaimAppScope = "consumer"): BenzoAccount {
  const sep = app === "consumer" ? "" : `${app}/`;
  return createAccount({
    label: app === "consumer" ? "claim" : `claim-${app}`,
    seed: deriveBytes(secret, `benzo/claim/${sep}eerc-seed`),
  });
}

export function accountFromSignedMessage(signature: Uint8Array | Hex, label = "wallet"): BenzoAccount {
  return createAccount({
    label,
    seed: deriveBytes(bytes(signature), "benzo/notekey/eerc-seed"),
  });
}

export async function loginWithSigner(signMessage: SignMessage, label = "wallet"): Promise<BenzoAccount> {
  const sig = await signMessage(NOTE_KEY_MESSAGE);
  return accountFromSignedMessage(sig, label);
}

export async function signWithEvmPrivateKey(privateKey: Hex, message: Uint8Array | string): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signMessage({
    message: typeof message === "string" ? message : { raw: toHex(message) as Hex },
  });
}

export async function verifyEvmSignature(address: string, message: Uint8Array | string, signature: Hex): Promise<boolean> {
  try {
    return await verifyMessage({
      address: getAddress(address),
      message: typeof message === "string" ? message : { raw: toHex(message) as Hex },
      signature,
    });
  } catch {
    return false;
  }
}

export function shortEvmAddress(address: string, n = 4): string {
  const t = address.trim();
  return t.length > n * 2 + 2 ? `${t.slice(0, n + 2)}…${t.slice(-n)}` : t;
}
