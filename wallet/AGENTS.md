# benzo-wallet — agent guide

The **Benzo wallet**: the consumer app for private payments on Avalanche. Users
hold and send **private USDC** (shielded via eERC), see their balance decrypt
client-side, send to contacts or `@handles`, and share gift links — a normal
money-app feel, private by default.

This repo is **frontend only**. The backend + contracts + infra live in
[`Miny-Labs/benzo`](https://github.com/Miny-Labs/benzo). Do not add backend code
here.

## Stack (pinned)
- **Vite + React 19 + TypeScript**, **Tailwind CSS v4** (`@tailwindcss/vite`).
- **wagmi v2 + viem v2** for wallet connection + chain calls.
- **`@avalabs/eerc-sdk@1.x`** for eERC (client-side Groth16 proving via snarkjs;
  serve each circuit's `.wasm`+`.zkey` from `public/` and pass as `circuitURLs`).
- Chain defs + deployed addresses come from **`@benzo/config`** (published from
  the benzo repo — until it's on a registry, vendor the needed constants and
  leave a `TODO(@benzo/config)` so we can swap to the package).
- Node ≥ 22, pnpm. Biome for lint/format.

## Backend it talks to (benzo `services/api`)
- **SIWE auth** (sign-in-with-Ethereum): nonce → sign → session cookie.
- **eERC**: register (one deterministic key per address/chain), read encrypted
  balance, build+submit private transfers (proofs run in-browser).
- **Handles / contacts / invites / gift links**, activity feed.
- The API base URL is env-driven (`VITE_API_BASE_URL`).
- RPC: BenzoNet is reached through the tokened Caddy edge
  (`https://rpc.benzo.space/wallet/<token>`); Fuji C-Chain via its public RPC.
  Chain choice is env-driven.

## Brand (from benzo-landing)
- Ethos: **discreet · warm · dependable — privacy is calm, not loud.**
- Primary violet **#7342E2**; paper **#F2F2EE**; ink **#212C39**; dark panel
  "the vault" **#161E2D** (never pure black); success green **#38AA75**.
- Font **Hanken Grotesk** (300–800). Logo: the Benzo "B"/arrow mark (assets to
  be added to `public/`).

## Pipeline (same as benzo)
- One issue per PR. Codex builds; a human runs verification gates, commits
  (Codex can't write `.git` — end with the proposed commit msg + `git add`
  list), opens the PR, triages Greptile/CodeRabbit, merges on green.
- Verify: `pnpm build`, `pnpm lint`, `pnpm test` (Vitest), and a Playwright
  smoke where UI matters. **UI issues MUST commit screenshots** (1440×900 +
  390×844) to `.github/pr-assets/issue-N/` for visual review.
- Never commit `.env`, secrets, or generated `.wasm`/`.zkey` proving artifacts.
