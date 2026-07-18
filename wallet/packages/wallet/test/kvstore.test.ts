/**
 * MemoryKVStore contract test, get/set/delete/keys and value isolation (a
 * mutation of a returned buffer must not corrupt the stored copy). The
 * IndexedDbKVStore shares the interface but needs a browser; it's covered by the
 * keychain round-trip in the app, not here.
 */
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { IndexedDbKVStore, MemoryKVStore } from "../src/kvstore.js";

/** Simulate an older build: a DB at version 1 that has some OTHER store but not ours. */
function createLegacyDb(dbName: string, legacyStore: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(legacyStore);
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe("MemoryKVStore", () => {
  it("round-trips, lists, and deletes keys", async () => {
    const kv = new MemoryKVStore();
    expect(await kv.get("a")).toBeNull();
    await kv.set("a", Uint8Array.of(1, 2, 3));
    await kv.set("b", Uint8Array.of(4));
    expect([...(await kv.keys())].sort()).toEqual(["a", "b"]);
    expect(await kv.get("a")).toEqual(Uint8Array.of(1, 2, 3));
    await kv.delete("a");
    expect(await kv.get("a")).toBeNull();
    expect(await kv.keys()).toEqual(["b"]);
  });

  it("isolates stored bytes from caller mutation", async () => {
    const kv = new MemoryKVStore();
    const v = Uint8Array.of(9, 9);
    await kv.set("k", v);
    v[0] = 0; // mutate the caller's copy after storing
    const got = await kv.get("k");
    expect(got).toEqual(Uint8Array.of(9, 9));
    got![1] = 0; // mutate the returned copy
    expect(await kv.get("k")).toEqual(Uint8Array.of(9, 9));
  });
});

describe("IndexedDbKVStore", () => {
  it("round-trips, lists, and deletes keys on a fresh DB", async () => {
    const kv = await IndexedDbKVStore.open("benzo-fresh", "keychain");
    expect(await kv.get("a")).toBeNull();
    await kv.set("a", Uint8Array.of(5, 6));
    await kv.set("b", Uint8Array.of(7));
    expect([...(await kv.keys())].sort()).toEqual(["a", "b"]);
    expect(await kv.get("a")).toEqual(Uint8Array.of(5, 6));
    await kv.delete("a");
    expect(await kv.get("a")).toBeNull();
    expect(await kv.keys()).toEqual(["b"]);
  });

  it("adds a missing store to a pre-existing DB instead of throwing (boot-hang regression)", async () => {
    // An earlier build left a benzo-wallet DB at version 1 holding only a
    // different store. Opening at a fixed version 1 used to skip onupgradeneeded,
    // leaving "keychain" absent so every transaction threw NotFoundError and boot
    // hung. open() must now version-bump to add the store.
    await createLegacyDb("benzo-legacy", "some-other-store");
    const kv = await IndexedDbKVStore.open("benzo-legacy", "keychain");
    await kv.set("k", Uint8Array.of(1, 2, 3));
    expect(await kv.get("k")).toEqual(Uint8Array.of(1, 2, 3));
    // Reopening still finds the store (no repeated upgrade churn).
    const again = await IndexedDbKVStore.open("benzo-legacy", "keychain");
    expect(await again.get("k")).toEqual(Uint8Array.of(1, 2, 3));
  });
});
