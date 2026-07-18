import "./polyfills";
import { StrictMode, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { WalletProvider } from "./lib/store";
import { NetworkProvider, useNetwork } from "./lib/networkContext";
import { createQueryClient, createWagmiConfig } from "./lib/wagmi";
import { ToastProvider } from "./ui/primitives";
import { DEMO_MODE } from "./demo/flag";
import { DemoWalletProvider } from "./demo/DemoWalletProvider";
import "./index.css";

// In DEMO MODE the seeded, no-network store stands in for the real one; both
// supply the same context to `useWallet()`. Folds to `WalletProvider` (and
// tree-shakes the demo import) in every normal build.
const Wallet = DEMO_MODE ? DemoWalletProvider : WalletProvider;

// The wagmi config + query cache are bound to a single chain, so they're rebuilt
// whenever the active network changes. The app shell above/below stays mounted -
// the reactive balance path swaps chains through lib/network's live bindings.
function Web3Providers({ children }: { children: ReactNode }) {
  const { network } = useNetwork();
  const wagmiConfig = useMemo(() => createWagmiConfig(network), [network]);
  const queryClient = useMemo(() => createQueryClient(), [network]);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <NetworkProvider>
        <Web3Providers>
          <MotionConfig reducedMotion="user">
            <BrowserRouter>
              <Wallet>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </Wallet>
            </BrowserRouter>
          </MotionConfig>
        </Web3Providers>
      </NetworkProvider>
    </StrictMode>,
  );
}
