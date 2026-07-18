import { bytesToUtf8, utf8ToBytes } from "@noble/hashes/utils";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { KVStore } from "./kvstore.js";
import { openSecret, sealSecret } from "./seal.js";

export interface WalletSecrets {
  evmPrivateKey: Hex;
  eercDecryptionKey: string;
  orgSpendId: string;
  mvkSeedHex: string;
}

export interface EvmSignerPort {
  address(): Promise<Hex>;
  signMessage(message: string): Promise<Hex>;
}

const DEFAULT_KEY = "benzo/keychain/v1";

function encode(s: WalletSecrets): Uint8Array {
  for (const f of ["evmPrivateKey", "eercDecryptionKey", "orgSpendId", "mvkSeedHex"] as const) {
    if (!s[f]) throw new Error(`WalletSecrets missing "${f}"`);
  }
  return utf8ToBytes(JSON.stringify(s));
}

function decode(bytes: Uint8Array): WalletSecrets {
  const parsed = JSON.parse(bytesToUtf8(bytes)) as Partial<WalletSecrets> & {
    stellarSecret?: string;
  };
  if (parsed.stellarSecret && !parsed.evmPrivateKey) {
    throw new Error("Stellar backups cannot be imported into the Avalanche wallet.");
  }
  return parsed as WalletSecrets;
}

export class Keychain {
  private current: WalletSecrets | null;

  private constructor(
    private readonly kv: KVStore,
    private readonly storeKey: string,
    secrets: WalletSecrets,
  ) {
    this.current = secrets;
  }

  static async exists(kv: KVStore, storeKey = DEFAULT_KEY): Promise<boolean> {
    return (await kv.get(storeKey)) !== null;
  }

  static async create(opts: {
    kv: KVStore;
    wrappingKey: Uint8Array;
    secrets: WalletSecrets;
    storeKey?: string;
    overwrite?: boolean;
  }): Promise<Keychain> {
    const key = opts.storeKey ?? DEFAULT_KEY;
    if (!opts.overwrite && (await opts.kv.get(key))) {
      throw new Error("keychain already exists (pass overwrite:true to replace)");
    }
    await opts.kv.set(key, sealSecret(encode(opts.secrets), opts.wrappingKey));
    return new Keychain(opts.kv, key, opts.secrets);
  }

  static async unlock(opts: {
    kv: KVStore;
    wrappingKey: Uint8Array;
    storeKey?: string;
  }): Promise<Keychain> {
    const key = opts.storeKey ?? DEFAULT_KEY;
    const blob = await opts.kv.get(key);
    if (!blob) throw new Error("no keychain in this store");
    const plain = openSecret(blob, opts.wrappingKey);
    if (!plain) throw new Error("unlock failed: wrong passkey or passphrase");
    return new Keychain(opts.kv, key, decode(plain));
  }

  private require(): WalletSecrets {
    if (!this.current) throw new Error("keychain is locked");
    return this.current;
  }

  get secrets(): WalletSecrets {
    return { ...this.require() };
  }

  signer(): EvmSignerPort {
    const account = privateKeyToAccount(this.require().evmPrivateKey);
    return {
      address: async () => account.address,
      signMessage: (message: string) => account.signMessage({ message }),
    };
  }

  async rewrap(newWrappingKey: Uint8Array): Promise<void> {
    await this.kv.set(this.storeKey, sealSecret(encode(this.require()), newWrappingKey));
  }

  lock(): void {
    this.current = null;
  }

  async wipe(): Promise<void> {
    await this.kv.delete(this.storeKey);
    this.current = null;
  }
}
