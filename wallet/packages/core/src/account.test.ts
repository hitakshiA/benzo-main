import { describe, expect, it } from "vitest";
import {
  accountFromClaimSecret,
  accountFromSignedMessage,
  signWithEvmPrivateKey,
  verifyEvmSignature,
} from "./account.js";

const secret = new Uint8Array(32).fill(7);

describe("accountFromClaimSecret", () => {
  it("is deterministic per (secret, app)", () => {
    const a = accountFromClaimSecret(secret, "consumer");
    const b = accountFromClaimSecret(secret, "consumer");
    expect(a.address).toBe(b.address);
    expect(a.eercDecryptionKey).toBe(b.eercDecryptionKey);
    expect([...a.mvkSecret]).toEqual([...b.mvkSecret]);
  });

  it("consumer keeps the default domain", () => {
    const legacy = accountFromClaimSecret(secret);
    const explicit = accountFromClaimSecret(secret, "consumer");
    expect(legacy.address).toBe(explicit.address);
    expect(legacy.spendSk).toBe(explicit.spendSk);
  });

  it("separates consumer and business claim domains", () => {
    const consumer = accountFromClaimSecret(secret, "consumer");
    const business = accountFromClaimSecret(secret, "business");
    expect(business.address).not.toBe(consumer.address);
    expect(business.eercDecryptionKey).not.toBe(consumer.eercDecryptionKey);
  });
});

describe("EVM account signatures", () => {
  it("derives a stable EVM account and verifies its message signature", async () => {
    const account = accountFromSignedMessage(new Uint8Array(32).fill(9));
    const signature = await signWithEvmPrivateKey(account.evmPrivateKey, "hello benzo");
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    await expect(verifyEvmSignature(account.address, "hello benzo", signature)).resolves.toBe(true);
    await expect(verifyEvmSignature(account.address, "tampered", signature)).resolves.toBe(false);
  });
});
