import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, AUTH_CHANGED_EVENT, type ActivityHint, type ActivityRow, type Balance, type Contact, type Session } from "./api";
import { readShieldedBalanceClientSide, readPublicBalanceClientSide } from "./benzoClient";
import { getLocalAccount, isWalletUnlocked, getLocalAccountSummary } from "./localWallet";
import { listLocalHistory } from "./history";
import { listLocal } from "./contacts";
import { applyActivityHints, mergeActivityRows, readEercActivityClientSide } from "./eercActivity";
import { subscribeNetwork } from "./network";

export interface PublicBalance {
  baseUnits: string;
  address: string;
  asset: string;
  issuer: string;
  live: boolean;
}

export interface WalletState {
  session: Session | null;
  balance: Balance | null;
  publicBalance: PublicBalance | null;
  history: ActivityRow[];
  contacts: Contact[];
  loading: boolean;
  error: string | null;
  hidden: boolean;
  toggleHidden: () => void;
  deviceVerified: boolean;
  refresh: () => Promise<boolean>;
  refreshBalance: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

// Exposed so the DEMO-mode provider (src/demo) can supply the same context to
// the same `useWallet()` consumers. Unused by the normal build.
export { Ctx as WalletContext };

// The direct-RPC activity scan must stay usable when the BFF is slow or down, so
// the /activity hints call is only ever allowed to hold up the local scan by a
// short, bounded amount before we fall back to no hints.
const ACTIVITY_HINTS_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [publicBalance, setPublicBalance] = useState<PublicBalance | null>(null);
  const [history, setHistory] = useState<ActivityRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => localStorage.getItem("benzo.hidden") === "1");
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [authenticated, setAuthenticated] = useState(() => isWalletUnlocked());

  const toggleHidden = useCallback(() => {
    setHidden((h) => {
      const next = !h;
      localStorage.setItem("benzo.hidden", next ? "1" : "0");
      return next;
    });
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!isWalletUnlocked()) return;
    try {
      const pBalVal = await readPublicBalanceClientSide();
      const summary = getLocalAccountSummary();
      if (pBalVal && summary && summary.address) {
        setPublicBalance({
          baseUnits: pBalVal,
          address: summary.address,
          asset: "USDC",
          issuer: "",
          live: true,
        });
      }
      const sBalVal = await readShieldedBalanceClientSide();
      if (sBalVal) {
        setBalance({
          baseUnits: sBalVal,
          live: true,
          source: "chain",
        });
        setDeviceVerified(true);
      }
      
      const local = listLocalHistory();
      const account = getLocalAccount();
      // Bound the BFF hints call so a slow/hanging indexer cannot delay the
      // offline-capable RPC scan; on timeout we just scan without hints.
      const hints = await withTimeout(
        api.activityHints(),
        ACTIVITY_HINTS_TIMEOUT_MS,
        [] as ActivityHint[],
      ).catch(() => [] as ActivityHint[]);
      let chainHistory: ActivityRow[] = [];
      if (account) {
        chainHistory = await readEercActivityClientSide(account, { hints }).catch((err) => {
          console.warn("Failed to refresh eERC activity from RPC:", err);
          return [] as ActivityRow[];
        });
      }
      // A logout can land while the hints/RPC scan are in flight. Writing the
      // resolved result now would repaint the previous account's activity after
      // it was cleared, so drop the stale result once the wallet is locked.
      if (!isWalletUnlocked()) return;
      setHistory(mergeActivityRows(applyActivityHints(local, hints), chainHistory));

      setError(null);
    } catch (e) {
      console.error("refreshBalance error:", e);
      setError((e as Error)?.message ?? "Failed to refresh balance");
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!isWalletUnlocked()) {
        setSession(null);
        setBalance(null);
        setPublicBalance(null);
        setHistory([]);
        setContacts([]);
        setLoading(false);
        return false;
      }
      // The "session" is derived locally from the device account, no backend
      // round-trip, no fabricated hosted profile. It never claims a KYC tier the
      // user hasn't earned; the prover genuinely runs on-device. A backend index,
      // if ever needed, is authenticated lazily per-request (see lib/api).
      const summary = getLocalAccountSummary();
      if (summary && summary.address) {
        const addr = summary.address;
        setSession({
          profile: { handle: addr, name: `${addr.slice(0, 6)}…${addr.slice(-4)}` },
          handle: addr,
          live: true,
          mode: "live",
          missing: [],
          prover: { available: ["local"], mode: "local", location: "local" },
        });
      }
      await refreshBalance();
      const remoteContacts = await api.contacts().catch(() => []);
      setContacts([...remoteContacts, ...listLocal()]);
      setLoading(false);
      return true;
    } catch (e) {
      setError((e as Error)?.message ?? "Failed to load wallet state");
      setLoading(false);
      return false;
    }
  }, [refreshBalance]);

  useEffect(() => {
    if (!authenticated) {
      setSession(null);
      setBalance(null);
      setPublicBalance(null);
      setHistory([]);
      setContacts([]);
      setError(null);
      setLoading(false);
      return;
    }

    void refresh();

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) void refreshBalance();
    }, 15_000);

    return () => {
      clearInterval(interval);
    };
  }, [authenticated, refresh, refreshBalance]);

  useEffect(() => {
    const onAuthChanged = () => setAuthenticated(isWalletUnlocked());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  // Switching networks re-points every client-side read at a different chain +
  // address bundle, so re-load balance and history from the newly active network.
  useEffect(() => subscribeNetwork(() => {
    if (isWalletUnlocked()) void refresh();
  }), [refresh]);

  return (
    <Ctx.Provider value={{ session, balance, publicBalance, history, contacts, loading, error, hidden, toggleHidden, deviceVerified, refresh, refreshBalance }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used within WalletProvider");
  return v;
}
