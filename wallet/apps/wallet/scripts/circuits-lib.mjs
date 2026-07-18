// Shared helpers for the per-network circuit-artifact profiles (issue #79).
//
// The eERC verifiers are NETWORK-COUPLED: Fuji deploys the DEV (contributions:0)
// trusted setup, Avalanche mainnet deploys the multi-party CEREMONY output. A
// build that serves ceremony zkeys to Fuji (or dev zkeys to mainnet) makes every
// on-chain proof revert InvalidProof(). These helpers pin the correct set per
// network by sha256 so a mispairing fails the build instead of failing in prod.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OPS = ["registration", "mint", "transfer", "withdraw", "burn"];
export const ARTIFACTS = ["wasm", "zkey"];

const HERE = dirname(fileURLToPath(import.meta.url));
export const WALLET_ROOT = join(HERE, "..");
export const PUBLIC_CIRCUITS_DIR = join(WALLET_ROOT, "public", "circuits");
export const HASHES_PATH = join(HERE, "circuits.hashes.json");

/** Resolve the target network from an explicit arg, else the build env, else fuji. */
export function resolveNetwork(explicit) {
  const raw = (explicit ?? process.env.VITE_CHAIN_ENV ?? process.env.VITE_BENZO_NETWORK ?? process.env.CHAIN_ENV ?? "fuji")
    .toString()
    .trim()
    .toLowerCase();
  // benzonet uses the ceremony set, same as avalanche mainnet.
  if (raw === "benzonet") return "avalanche";
  if (raw !== "fuji" && raw !== "avalanche") {
    throw new Error(`Unknown network "${raw}" — expected fuji | avalanche (benzonet aliases avalanche).`);
  }
  return raw;
}

/** Expected { op -> sha256 } for a network, skipping the "_comment" key. */
export function expectedHashes(network) {
  const all = JSON.parse(readFileSync(HASHES_PATH, "utf8"));
  const block = all[network];
  if (!block) throw new Error(`No expected hashes for network "${network}" in circuits.hashes.json.`);
  return block;
}

export function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const PLACEHOLDER = /^TODO/i;

/**
 * Verify every zkey in `dir` matches the expected hash for `network`.
 * Returns { ok, checked, mismatches, missing, skipped }.
 * A hash of "TODO…" is a not-yet-pinned placeholder: skipped with a warning, not a failure.
 */
export function verifyDir(dir, network) {
  const expected = expectedHashes(network);
  const mismatches = [];
  const missing = [];
  const skipped = [];
  let checked = 0;
  for (const op of OPS) {
    const want = expected[op];
    if (!want || PLACEHOLDER.test(want)) {
      skipped.push(op);
      continue;
    }
    const zkey = join(dir, `${op}.zkey`);
    if (!existsSync(zkey)) {
      missing.push(op);
      continue;
    }
    const got = sha256(zkey);
    checked += 1;
    if (got !== want) mismatches.push({ op, want, got });
  }
  return { ok: mismatches.length === 0 && missing.length === 0, checked, mismatches, missing, skipped };
}
