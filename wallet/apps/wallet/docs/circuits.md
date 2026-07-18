# eERC circuit artifacts — per-network profiles

The wallet proves eERC operations **client-side** with snarkjs, loading each
circuit's `.wasm` + `.zkey` from `/circuits/<op>.{wasm,zkey}` (ops:
`registration`, `mint`, `transfer`, `withdraw`, `burn`). A per-op override
`VITE_EERC_<OP>_<WASM|ZKEY>_URL` wins when set.

## The artifacts are network-coupled

The deployed Groth16 verifiers are **not** the same build on every network:

| Network | Verifier build | Circuit set to ship |
|---|---|---|
| **Fuji** (43113) | **DEV** — deterministic `contributions:0` trusted setup | dev `.zkey` |
| **Avalanche mainnet** (43114) | **CEREMONY** — multi-party phase-2 output | ceremony `.zkey` |
| BenzoNet L1 | CEREMONY | ceremony `.zkey` (aliases `avalanche` here) |

A `.zkey` only verifies against the verifier built from the **same** setup, so
serving ceremony zkeys to Fuji (or dev zkeys to mainnet) makes **every** on-chain
proof revert `InvalidProof()`. (Confirmed on-chain: Fuji's registration verifier
bytecode embeds the dev vkey constants; mainnet/BenzoNet embed the ceremony vkey.)

`public/circuits/` is gitignored (the artifacts are large and network-specific),
so the correct set must be supplied at deploy time.

## Two deploy models

1. **Proxy (current Fuji deploy).** `vercel.json` rewrites `/circuits/*` to the
   Fuji host, which serves the **dev** set. Nothing is bundled; `public/circuits/`
   stays empty. Simplest, but depends on that host being up.
2. **Bundle.** Stage the right set into `public/circuits/` so it ships in the
   static output. Use this when you don't want the runtime `/circuits` dependency
   (e.g. a mainnet build):

   ```bash
   EERC_CIRCUITS_SRC_DIR=/path/to/avalanche/circuits \
     pnpm --filter @benzo/wallet-app stage:circuits --network avalanche
   ```

   `stage-circuits` copies the 5 ops' `wasm`+`zkey` and then **verifies each
   zkey's sha256** against `scripts/circuits.hashes.json` for that network — a
   wrong/mixed set fails the stage (and `public/circuits/` is removed) instead of
   failing on-chain. Run the same guard standalone in CI/pre-deploy:

   ```bash
   pnpm --filter @benzo/wallet-app check:circuits --network avalanche
   ```

   With nothing staged (model 1), `check:circuits` no-ops with a warning.

The expected hashes live in [`scripts/circuits.hashes.json`](../scripts/circuits.hashes.json);
regenerate a network's block with `sha256sum <op>.zkey`.

## Mainnet (Avalanche C-Chain) config swap checklist

Moving a build from Fuji to Avalanche mainnet means swapping **all** of:

- [ ] **Chain**: `VITE_CHAIN_ENV=avalanche` (drives chainId `43114`, RPC, explorer).
- [ ] **RPC**: `VITE_RPC_URL` / the avalanche RPC (defaults from `@benzo/config`).
- [ ] **Contracts**: `EncryptedERC` / `Registrar` / `USDC` / `HandleRegistry`
      addresses (default from `@benzo/config`; override via `VITE_EERC_*` /
      `VITE_USDC_TOKEN_ADDRESS` if needed).
- [ ] **Circuits**: the **ceremony** `.zkey` set — either point the `/circuits/*`
      rewrite at a host serving ceremony artifacts, or `stage:circuits --network
      avalanche`. Then `check:circuits --network avalanche` must pass.

Getting the circuits wrong is the silent one: addresses/RPC surface obvious errors,
but a dev↔mainnet zkey mismatch only shows up as `InvalidProof()` at send time —
which is exactly what the coupling check exists to catch before shipping.
