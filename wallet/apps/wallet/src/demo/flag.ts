/**
 * DEMO MODE, a build-time, login-free, no-chain walkthrough of every wallet
 * flow with seeded fake data (so anyone can open a URL and click through the
 * animations without onboarding, a passkey, a backend, or a testnet).
 *
 * Activated ONLY when the app is built with `VITE_DEMO_MODE=1`. In every normal
 * build `import.meta.env.VITE_DEMO_MODE` is undefined, so `DEMO_MODE` folds to a
 * compile-time `false`, every `if (DEMO_MODE)` branch is dead-code eliminated,
 * and the demo modules tree-shake away, the production wallet is unchanged.
 */
export const DEMO_MODE: boolean =
  (import.meta.env as Record<string, string | undefined>).VITE_DEMO_MODE === "1";
