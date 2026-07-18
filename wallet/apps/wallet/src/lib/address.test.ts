import { describe, expect, it } from "vitest";
import { isValidEvmAddress, normalizeEvmAddress, shortAddress } from "./address";

const REAL = [
  "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
];

describe("EVM address helpers", () => {
  it("accepts real Avalanche-style EVM addresses", () => {
    for (const a of REAL) expect(isValidEvmAddress(a)).toBe(true);
  });

  it("rejects wrong-shape inputs", () => {
    expect(isValidEvmAddress("@alice")).toBe(false);
    expect(isValidEvmAddress("")).toBe(false);
    expect(isValidEvmAddress("0xabc")).toBe(false);
    expect(isValidEvmAddress("0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });

  it("trims surrounding whitespace before validating and normalizing", () => {
    expect(isValidEvmAddress(`  ${REAL[0].toLowerCase()}  `)).toBe(true);
    expect(normalizeEvmAddress(`  ${REAL[0].toLowerCase()}  `)).toBe(REAL[0]);
  });
});

describe("shortAddress", () => {
  it("truncates long addresses to 0x0000...0000 form", () => {
    expect(shortAddress(REAL[0])).toBe("0x00f6…14D6");
  });

  it("leaves short strings untouched", () => {
    expect(shortAddress("@bob")).toBe("@bob");
  });
});
