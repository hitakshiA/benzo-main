/**
 * Reactive network selection. Lifts the active network (Fuji / BenzoNet / mainnet
 * C-Chain) into React state, persisted to localStorage and defaulting to the env
 * value. `setNetwork` re-resolves the module-level address bundle + RPC (see
 * lib/network.ts) so every client-side read swaps chains, and carries a per-network
 * presentation theme so the switch is *felt*, the ambient video + accent retint.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DeploymentNetwork } from "@benzo/config";
import { getActiveNetwork, setActiveNetwork } from "./network";

export interface NetworkTheme {
  /** Full chain name, e.g. for the "Mode" row. */
  label: string;
  /** Short switcher label. */
  short: string;
  /** Ambient-video scrim tint. */
  tint: string;
  /** Accent (drives every `bg-accent`/`text-accent` via the cascaded CSS var). */
  accent: string;
  accentSoft: string;
  /** Accent glow shadow for the FAB + active pill. */
  glow: string;
}

// Three visually distinct environments: brand purple (Fuji testnet), a developer
// teal (the BenzoNet L1), and an Avalanche crimson for mainnet, the "real funds"
// cue. Values mirror the OKLCH tokens in index.css.
export const NETWORK_THEME: Record<DeploymentNetwork, NetworkTheme> = {
  fuji: {
    label: "Avalanche Fuji",
    short: "Fuji",
    tint: "#f2f2ee",
    accent: "oklch(0.553 0.207 292)",
    accentSoft: "oklch(0.945 0.026 293)",
    glow: "0 4px 24px oklch(0.553 0.207 292 / 0.28)",
  },
  benzonet: {
    label: "BenzoNet",
    short: "BenzoNet",
    tint: "#e8f0f1",
    accent: "oklch(0.60 0.12 210)",
    accentSoft: "oklch(0.95 0.03 210)",
    glow: "0 4px 24px oklch(0.60 0.12 210 / 0.30)",
  },
  avalanche: {
    label: "Avalanche C-Chain",
    short: "Mainnet",
    tint: "#f4ece8",
    accent: "oklch(0.62 0.2 25)",
    accentSoft: "oklch(0.94 0.04 25)",
    glow: "0 4px 24px oklch(0.62 0.2 25 / 0.32)",
  },
};

// The consumer wallet ships only the PUBLIC Avalanche chains: Fuji to try it
// risk-free, C-Chain mainnet for real money. The permissioned BenzoNet L1 is a
// business network (validator/participant allowlists), it lives in the console.
export const NETWORK_OPTIONS: ReadonlyArray<{ network: DeploymentNetwork; label: string }> = [
  { network: "fuji", label: "Testnet" },
  { network: "avalanche", label: "Mainnet" },
];

export interface NetworkContextValue {
  network: DeploymentNetwork;
  setNetwork: (network: DeploymentNetwork) => void;
  theme: NetworkTheme;
  options: typeof NETWORK_OPTIONS;
}

const Ctx = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<DeploymentNetwork>(() => getActiveNetwork());
  const setNetwork = useCallback((next: DeploymentNetwork) => {
    // Re-resolve the module bundle + persist FIRST (subscribers, incl. the wallet
    // store's balance refresh, run off this), then re-render the tree.
    setActiveNetwork(next);
    setNetworkState(next);
  }, []);
  const value = useMemo<NetworkContextValue>(
    () => ({ network, setNetwork, theme: NETWORK_THEME[network], options: NETWORK_OPTIONS }),
    [network, setNetwork],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const v = useContext(Ctx);
  if (v) return v;
  // Fallback for isolated renders (focused unit tests) with no provider mounted:
  // reflect the module's active network so presentation stays consistent.
  const network = getActiveNetwork();
  return { network, setNetwork: setActiveNetwork, theme: NETWORK_THEME[network], options: NETWORK_OPTIONS };
}
