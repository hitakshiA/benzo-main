import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

import { isSaved, listLocal, mergeContacts, normAddress, removeContact, saveContact } from "./contacts.js";

const ADDR1 = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6";
const ADDR2 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("contacts (local-first recipient management)", () => {
  beforeEach(() => mem.clear());

  it("normalizes EVM addresses", () => {
    expect(normAddress(ADDR1)).toBe(ADDR1);
    expect(normAddress(`  ${ADDR1}  `)).toBe(ADDR1);
    expect(normAddress("not-an-address")).toBe("");
    expect(normAddress("")).toBe("");
  });

  it("saves and de-dupes by address (latest wins, most-recent first)", () => {
    saveContact(ADDR1, "Alex Rivera");
    saveContact(ADDR2, "Bob");
    saveContact(ADDR1, "Alex R.");
    const cs = listLocal();
    expect(cs).toHaveLength(2);
    expect(cs[0]).toEqual({ handle: ADDR1, name: "Alex R." });
    expect(isSaved(ADDR1)).toBe(true);
  });

  it("refuses malformed local contacts", () => {
    saveContact("not-an-address", "Bad");
    expect(listLocal()).toHaveLength(0);
  });

  it("removes a saved contact", () => {
    saveContact(ADDR1, "Alex");
    removeContact(ADDR1);
    expect(isSaved(ADDR1)).toBe(false);
    expect(listLocal()).toHaveLength(0);
  });

  it("merges local + BFF contacts, local wins on conflicts, BFF-only appended", () => {
    saveContact(ADDR1, "My Alex");
    const bff = [
      { handle: ADDR1, name: "Alex Rivera" }, // conflicts with local, local wins
      { handle: ADDR2, name: "Cleo" }, // not saved locally, appended
    ];
    const merged = mergeContacts(bff);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ handle: ADDR1, name: "My Alex" });
    expect(merged.find((c) => c.handle === ADDR2)?.name).toBe("Cleo");
  });
});
