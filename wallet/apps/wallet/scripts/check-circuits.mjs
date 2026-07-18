#!/usr/bin/env node
// Coupling check: verify the staged public/circuits/ zkeys match the target
// network's verifiers by sha256 (issue #79). Run in CI/pre-deploy so a build can
// never ship the wrong (dev↔mainnet) circuit set.
//
// Usage:
//   node scripts/check-circuits.mjs --network fuji
//   --network fuji|avalanche   (default: VITE_CHAIN_ENV / CHAIN_ENV, else fuji)
//
// Exit codes: 0 = staged set matches (or nothing staged — see below); 1 = mismatch.
// When public/circuits/ is empty (normal local dev, or a deploy that proxies
// circuits via the /circuits/* rewrite instead of bundling them), the check
// no-ops with a warning rather than failing.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OPS, PUBLIC_CIRCUITS_DIR, resolveNetwork, verifyDir } from "./circuits-lib.mjs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const network = resolveNetwork(argValue("--network"));
  const anyStaged = OPS.some((op) => existsSync(join(PUBLIC_CIRCUITS_DIR, `${op}.zkey`)));
  if (!anyStaged) {
    console.warn(
      `check-circuits: public/circuits/ has no zkeys staged — skipping the ${network} coupling check ` +
        "(local dev, or this deploy proxies /circuits/* instead of bundling). Run stage-circuits to bundle.",
    );
    return;
  }

  const result = verifyDir(PUBLIC_CIRCUITS_DIR, network);
  if (!result.ok) {
    for (const m of result.mismatches) {
      console.error(`  ✗ ${m.op}.zkey sha256 ${m.got}\n      expected ${m.want} for ${network}`);
    }
    for (const op of result.missing) console.error(`  ✗ ${op}.zkey is staged for some ops but missing`);
    throw new Error(
      `Staged circuits do not match the ${network} verifiers. Proofs would revert InvalidProof() on-chain. ` +
        "Re-stage the correct set (Fuji = DEV, Avalanche = CEREMONY).",
    );
  }
  const skipped = result.skipped.length ? ` (skipped un-pinned: ${result.skipped.join(", ")})` : "";
  console.log(`✓ staged circuits match the ${network} verifiers — ${result.checked} zkey hashes verified${skipped}.`);
}

try {
  main();
} catch (err) {
  console.error(`check-circuits: ${err.message}`);
  process.exit(1);
}
