/**
 * The DEMO-mode wallet store. Provides the exact same context as the real
 * WalletProvider (so every `useWallet()` consumer is untouched), but the state
 * comes from the seeded in-memory demo store instead of the chain/backend. It
 * makes no network calls: `refresh`/`refreshBalance` just re-read the demo
 * snapshot. Swapped in for the real provider at the main.tsx seam.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { WalletContext, type WalletState } from "../lib/store";
import { listLocal } from "../lib/contacts";
import { getDemoSnapshot, subscribeDemo } from "./state";

export function DemoWalletProvider({ children }: { children: ReactNode }) {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => localStorage.getItem("benzo.hidden") === "1");

  // Re-render when a scripted send mutates the demo store (balance + activity).
  useEffect(() => subscribeDemo(() => force((n) => n + 1)), []);

  const toggleHidden = useCallback(() => {
    setHidden((h) => {
      const next = !h;
      localStorage.setItem("benzo.hidden", next ? "1" : "0");
      return next;
    });
  }, []);

  const snapshot = getDemoSnapshot();
  const value: WalletState = {
    session: snapshot.session,
    balance: snapshot.balance,
    publicBalance: snapshot.publicBalance,
    history: snapshot.history,
    contacts: listLocal(),
    loading: false,
    error: null,
    hidden,
    toggleHidden,
    deviceVerified: true,
    refresh: async () => {
      force((n) => n + 1);
      return true;
    },
    refreshBalance: async () => {
      force((n) => n + 1);
    },
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
