import type { DeploymentNetwork } from "@benzo/config";
import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { resolveNetworkConfig } from "./network";

/** Build a wagmi config bound to a single network, rebuilt whenever the user switches. */
export function createWagmiConfig(network: DeploymentNetwork) {
  const { chain, rpcUrl } = resolveNetworkConfig(network);
  // No injected/browser-extension connector: this is a self-custody wallet that
  // signs with its OWN embedded key, never window.ethereum. Mounting `injected()`
  // made wagmi probe window.ethereum and collide with MetaMask/other extensions
  // (the "Cannot set property ethereum" console errors) for no benefit.
  return createConfig({
    chains: [chain],
    connectors: [],
    transports: {
      [chain.id]: http(rpcUrl),
    },
    ssr: false,
  });
}

/** A fresh query cache per network so reads from the previous chain don't bleed through. */
export function createQueryClient(): QueryClient {
  return new QueryClient();
}
