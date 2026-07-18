/**
 * @benzo/wallet, on-device key custody for a Benzo wallet.
 *
 * A `Keychain` seals the wallet's secrets (EVM key, eERC key, MVK
 * seed) into a `KVStore` (IndexedDB in the browser, in-memory in Node/tests),
 * unlocked by a passkey PRF or a passphrase.
 */
export * from "./kvstore.js";
export * from "./seal.js";
export * from "./wrapping-key.js";
export * from "./keychain.js";
