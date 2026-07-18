#!/usr/bin/env node
// Stage the correct per-network eERC circuit set into public/circuits/ (issue #79).
//
// public/circuits/ is gitignored (the .zkey/.wasm are large and network-coupled),
// so proofs 404 unless artifacts are staged at deploy. This copies the 5 ops'
// wasm+zkey from a source dir into public/circuits/, then verifies each zkey's
// sha256 against the committed circuits.hashes.json for the target network — so a
// dev↔mainnet mispairing fails HERE, not on-chain with InvalidProof().
//
// Usage:
//   EERC_CIRCUITS_SRC_DIR=/path/to/<network>/circuits \
//     node scripts/stage-circuits.mjs --network fuji
//
//   --network fuji|avalanche   (default: VITE_CHAIN_ENV / CHAIN_ENV, else fuji)
//   EERC_CIRCUITS_SRC_DIR      dir holding <op>.wasm + <op>.zkey for that network
//
// NOTE: the current Fuji deploy serves circuits via the vercel.json "/circuits/*"
// rewrite to the Fuji host, so staging is only needed when bundling artifacts into
// the static build instead of proxying them. See docs/circuits.md.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS, OPS, PUBLIC_CIRCUITS_DIR, resolveNetwork, verifyDir } from "./circuits-lib.mjs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const network = resolveNetwork(argValue("--network"));
  const srcDir = process.env.EERC_CIRCUITS_SRC_DIR;
  if (!srcDir) {
    throw new Error(
      "EERC_CIRCUITS_SRC_DIR is not set. Point it at the directory holding this network's " +
        "<op>.wasm + <op>.zkey (Fuji = DEV set, Avalanche = CEREMONY set).",
    );
  }
  if (!existsSync(srcDir)) throw new Error(`EERC_CIRCUITS_SRC_DIR does not exist: ${srcDir}`);

  // Never leave a stale/half set behind — start clean.
  rmSync(PUBLIC_CIRCUITS_DIR, { recursive: true, force: true });
  mkdirSync(PUBLIC_CIRCUITS_DIR, { recursive: true });

  for (const op of OPS) {
    for (const ext of ARTIFACTS) {
      const from = join(srcDir, `${op}.${ext}`);
      if (!existsSync(from)) {
        throw new Error(`Missing ${op}.${ext} in ${srcDir} — refusing to stage a partial set.`);
      }
      copyFileSync(from, join(PUBLIC_CIRCUITS_DIR, `${op}.${ext}`));
    }
  }

  const result = verifyDir(PUBLIC_CIRCUITS_DIR, network);
  if (!result.ok) {
    for (const m of result.mismatches) {
      console.error(`  ✗ ${m.op}.zkey sha256 ${m.got}\n      expected ${m.want} for ${network}`);
    }
    for (const op of result.missing) console.error(`  ✗ ${op}.zkey missing after copy`);
    rmSync(PUBLIC_CIRCUITS_DIR, { recursive: true, force: true });
    throw new Error(
      `Staged circuits do not match the ${network} verifiers — these are the WRONG artifacts for this network. ` +
        "Removed public/circuits/ so a mismatched set can't ship.",
    );
  }
  const skipped = result.skipped.length ? ` (skipped un-pinned: ${result.skipped.join(", ")})` : "";
  console.log(`✓ staged ${OPS.length} circuits for ${network} from ${srcDir}; ${result.checked} zkey hashes verified${skipped}.`);
}

try {
  main();
} catch (err) {
  console.error(`stage-circuits: ${err.message}`);
  process.exit(1);
}
