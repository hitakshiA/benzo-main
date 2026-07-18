import { describe, expect, it } from "vitest";
import { type BenzoRecipient } from "@benzo/core";
import { classifyRecipientInput, decodeRecipient, encodeRecipient } from "./recipient";

const VALID_EVM = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;

describe("recipient classification", () => {
  it("classifies EVM addresses", () => {
    expect(classifyRecipientInput(VALID_EVM)).toBe("address");
    expect(classifyRecipientInput(`  ${VALID_EVM.toLowerCase()}  `)).toBe("address");
    expect(classifyRecipientInput("0xabc1234567")).toBe("invite");
  });

  it("classifies bzr_ receive codes", () => {
    const rec: BenzoRecipient = {
      address: VALID_EVM,
      spendPub: 12345n,
      viewPub: new Uint8Array([1, 2, 3]),
      label: "Test",
    };
    const code = encodeRecipient(rec);
    expect(classifyRecipientInput(code)).toBe("private");
    expect(classifyRecipientInput("bzr_invalidcode")).toBe("invite");
  });

  it("classifies handles as private recipients and other inputs as invite text", () => {
    expect(classifyRecipientInput("@alice")).toBe("private");
    expect(classifyRecipientInput("alice")).toBe("private");
    expect(classifyRecipientInput("send me money")).toBe("invite");
    expect(classifyRecipientInput("")).toBe("invite");
  });

  it("roundtrips encode and decode", () => {
    const rec: BenzoRecipient = {
      address: VALID_EVM,
      spendPub: 9876543210n,
      viewPub: new Uint8Array(Array.from({ length: 32 }, (_, i) => i)),
      mvkScalar: 123n,
      label: "Contractor",
    };
    const code = encodeRecipient(rec);
    const decoded = decodeRecipient(code);
    expect(decoded).not.toBeNull();
    expect(decoded?.address).toBe(rec.address);
    expect(decoded?.spendPub).toBe(rec.spendPub);
    expect(decoded?.viewPub).toEqual(rec.viewPub);
    expect(decoded?.mvkScalar).toBe(rec.mvkScalar);
    expect(decoded?.label).toBe(rec.label);
  });
});
