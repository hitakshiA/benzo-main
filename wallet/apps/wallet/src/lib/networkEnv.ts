/**
 * Network-env model, the wallet's trust vocabulary for the active chain, mirrored
 * from the console's `NETWORK_ENV`. This is the single place that decides how a
 * network is *presented* for safety: what it's called, whether it holds real
 * money, and which tone (amber vs green) it earns.
 *
 * Hard rule (A1): a testnet must never look like real money. Fuji + BenzoNet are
 * amber "test funds"; only C-Chain mainnet is the green "real funds" affordance.
 * Keep this in sync with the color contract in index.css (amber = testnet/warning,
 * green/pos = live/verified).
 */
import type { DeploymentNetwork } from "@benzo/config";
import { useNetwork } from "./networkContext";

/** Trust tone → drives the pill/status color. Only `live` (mainnet) is green. */
export type NetworkEnvTone = "test" | "live" | "permissioned";

export interface NetworkEnv {
  network: DeploymentNetwork;
  /** Compact trust name for the header pill / status ("Fuji Testnet"). */
  name: string;
  /** One-line funds context ("Test funds only"). */
  funds: string;
  /** True for anything that is NOT real-money mainnet. */
  isTestnet: boolean;
  /** amber for testnet/permissioned, green (pos) for mainnet. */
  tone: NetworkEnvTone;
  /** Denomination/context line under the hero balance. */
  denomination: string;
  /** Inline asset symbol for amounts ("USDC"). */
  asset: string;
}

export const NETWORK_ENV: Record<DeploymentNetwork, NetworkEnv> = {
  fuji: {
    network: "fuji",
    name: "Fuji Testnet",
    funds: "Test funds only",
    isTestnet: true,
    tone: "test",
    denomination: "Test USDC · Fuji Testnet · No real value",
    asset: "USDC",
  },
  avalanche: {
    network: "avalanche",
    name: "Avalanche",
    funds: "Mainnet · real funds",
    isTestnet: false,
    tone: "live",
    denomination: "USDC · Avalanche",
    asset: "USDC",
  },
  benzonet: {
    network: "benzonet",
    name: "Permissioned L1",
    funds: "Test funds only",
    isTestnet: true,
    tone: "permissioned",
    denomination: "Test USDC · Permissioned L1 · No real value",
    asset: "USDC",
  },
};

/** Tailwind classes for a tone-colored status chip/pill (amber vs green). */
export const NETWORK_TONE_CHIP: Record<NetworkEnvTone, string> = {
  test: "bg-amber/12 text-[#9a6b12]",
  permissioned: "bg-amber/12 text-[#9a6b12]",
  live: "bg-pos/12 text-pos",
};

/** A tiny status dot color per tone (amber/green). */
export const NETWORK_TONE_DOT: Record<NetworkEnvTone, string> = {
  test: "bg-amber",
  permissioned: "bg-amber",
  live: "bg-pos",
};

export function getNetworkEnv(network: DeploymentNetwork): NetworkEnv {
  return NETWORK_ENV[network];
}

/** Reactive env for the active network. Safe with no NetworkProvider mounted
 *  (useNetwork falls back to the module's active network). */
export function useNetworkEnv(): NetworkEnv {
  return getNetworkEnv(useNetwork().network);
}
