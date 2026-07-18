/**
 * The wallet shell - a phone frame (full-screen on mobile, a centered device on
 * desktop) with the cursor-interactive canvas living BEHIND the cards, animated
 * route transitions, and a tab bar with a sliding active indicator + center FAB.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Home as HomeIcon, QrCode, User } from "lucide-react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { VideoBackground } from "./ui/VideoBackground";
import { StageVideo } from "./ui/StageVideo";
import { LockGate } from "./ui/LockGate";
import { SendGlyph } from "./ui/icons";
import { ShellProvider, useShell } from "./ui/shell";
import { spring } from "./ui/motion";
import { Component, lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useNetwork } from "./lib/networkContext";
import { useWallet } from "./lib/store";
// Screens are lazy-loaded so each route ships as its own chunk, only the first
// view's code is parsed on load, the rest arrive on navigation. (Named exports,
// so each import() is mapped to a `default` for React.lazy.)
const Home = lazy(() => import("./screens/Home").then((m) => ({ default: m.Home })));
const Send = lazy(() => import("./screens/Send").then((m) => ({ default: m.Send })));
const Shield = lazy(() => import("./screens/Shield").then((m) => ({ default: m.Shield })));
const Request = lazy(() => import("./screens/Request").then((m) => ({ default: m.Request })));
const Activity = lazy(() => import("./screens/Activity").then((m) => ({ default: m.Activity })));
const TxDetail = lazy(() => import("./screens/TxDetail").then((m) => ({ default: m.TxDetail })));
const Deposit = lazy(() => import("./screens/Deposit").then((m) => ({ default: m.Deposit })));
const Profile = lazy(() => import("./screens/Profile").then((m) => ({ default: m.Profile })));
const Notifications = lazy(() => import("./screens/Notifications").then((m) => ({ default: m.Notifications })));
const Contacts = lazy(() => import("./screens/Contacts").then((m) => ({ default: m.Contacts })));
const ContactDetail = lazy(() => import("./screens/ContactDetail").then((m) => ({ default: m.ContactDetail })));
const ShareProof = lazy(() => import("./screens/ShareProof").then((m) => ({ default: m.ShareProof })));
const InviteExternal = lazy(() => import("./screens/InviteExternal").then((m) => ({ default: m.InviteExternal })));
const Claim = lazy(() => import("./screens/Claim").then((m) => ({ default: m.Claim })));
import { Onboarding } from "./screens/Onboarding";
import { walletExists, isWalletUnlocked, tryAutoUnlock } from "./lib/localWallet";
import { DEMO_MODE } from "./demo/flag";

const TABS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/activity", label: "Activity", icon: Clock },
  { to: "/deposit", label: "Receive", icon: QrCode },
  { to: "/profile", label: "Profile", icon: User },
] as const;

function BottomNav() {
  const loc = useLocation();
  const nav = useNavigate();
  const { session } = useWallet();
  const chainUnavailable = !!session && !session.live;
  const active = (to: string) => (to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to));
  return (
    <nav className="safe-nav relative flex items-end justify-between border-t border-hair bg-card pt-2.5" data-testid="bottom-nav">
      {TABS.slice(0, 2).map((t) => (
        <NavBtn key={t.to} {...t} on={active(t.to)} onClick={() => nav(t.to)} />
      ))}
      {/* center FAB → Send (the primary action) */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{ y: -2 }}
        onClick={() => {
          if (!chainUnavailable) nav("/send");
        }}
        disabled={chainUnavailable}
        aria-label="Send money"
        data-testid="fab-send"
        className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-[var(--shadow-glow)] outline-none disabled:cursor-not-allowed disabled:bg-ink/[0.08] disabled:text-muted disabled:shadow-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <SendGlyph size={24} className={chainUnavailable ? "text-muted" : "text-white"} />
      </motion.button>
      {TABS.slice(2).map((t) => (
        <NavBtn key={t.to} {...t} on={active(t.to)} onClick={() => nav(t.to)} />
      ))}
    </nav>
  );
}

function NavBtn({ label, icon: Icon, on, onClick }: { label: string; icon: typeof HomeIcon; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`relative flex flex-col items-center gap-1 rounded-lg px-1 py-0.5 text-[11px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? "text-accent" : "text-muted hover:text-ink"}`}
    >
      <Icon size={21} />
      {label}
      {on ? <motion.span layoutId="nav-dot" className="absolute -top-1.5 h-1 w-1 rounded-full bg-accent" transition={spring} /> : null}
    </button>
  );
}

/**
 * Desktop = the phone floats on a wide screen, so the video lives BEHIND it
 * (StageVideo) and the phone keeps its own canvas grid. Mobile = the phone IS the
 * screen (nothing "behind" is visible), so the video lives INSIDE the phone
 * (VideoBackground). Re-evaluates live when the viewport crosses the `sm` line.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isDesktop;
}

/**
 * The mounted shell body: the scrollable route viewport + BottomNav. Lives inside
 * <ShellProvider> so a screen can call `useHideBottomNav()` to drop the nav for a
 * focused flow (Send: review → passkey → processing → success/failure). `main`
 * carries the `.pb-nav` inset so the nav (and its protruding FAB) never covers
 * content, Profile used to get clipped at the bottom.
 */
function Shell({ children }: { children: ReactNode }) {
  const { bottomNavHidden } = useShell();
  return (
    <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
      <main className="no-scrollbar flex-1 overflow-y-auto pb-nav">{children}</main>
      {bottomNavHidden ? null : <BottomNav />}
    </div>
  );
}

/**
 * `Suspense` handles the *pending* state of a lazy import, but NOT a failed one
 * (a stale chunk after a redeploy, or a network drop mid-load). Without this, an
 * import error would blank the whole shell. This boundary shows a reload path
 * instead so the wallet stays recoverable.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted">Couldn’t load this screen.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const loc = useLocation();
  const isDesktop = useIsDesktop();
  const { theme } = useNetwork();
  // DEMO MODE boots straight into an unlocked shell, no onboarding, no lock,
  // no passkey. (These initializers fold to `false/true/true` in normal builds.)
  const [onboarded, setOnboarded] = useState(DEMO_MODE);
  const [locked, setLocked] = useState(!DEMO_MODE);
  const [checking, setChecking] = useState(!DEMO_MODE);

  useEffect(() => {
    if (DEMO_MODE) return;
    async function checkWallet() {
      const exists = await walletExists();
      setOnboarded(exists);
      // The in-memory session never survives a refresh, so we re-open on load.
      // "device" wallets auto-open SILENTLY (no passkey/passcode prompt); legacy
      // passkey/passphrase wallets fall back to the LockGate.
      const unlocked = exists && !isWalletUnlocked() ? await tryAutoUnlock() : isWalletUnlocked();
      setLocked(!unlocked);
      setChecking(false);
    }
    checkWallet();
  }, []);

  function finishOnboarding() {
    setOnboarded(true);
    setLocked(false);
  }

  const showShell = onboarded && !locked;

  if (checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-canvas">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  // Send/Request/Share are presented as sheets over Home in real use, but each is
  // also a routable screen so deep-links + back work. The shell stays mounted.
  return (
    <div
      className="fixed inset-0 flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#dfe0dc] sm:bg-[radial-gradient(125%_85%_at_50%_-10%,#ecece7,#dcdcd5_55%,#d3d4cd)] sm:p-6"
      data-testid="app-root"
      data-network={theme.short}
      style={
        {
          // Retint the whole shell to the active network, every bg-accent /
          // text-accent / shadow-glow follows this cascaded override.
          "--color-accent": theme.accent,
          "--color-accent-soft": theme.accentSoft,
          "--shadow-glow": theme.glow,
        } as CSSProperties
      }
    >
      {/* desktop ambient: the looping video stage BEHIND the device (not inside it) */}
      {isDesktop ? <StageVideo /> : null}
      <div className="device relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden bg-canvas shadow-[0_40px_90px_rgba(25,40,55,0.28)] sm:h-[min(798px,calc(100dvh-48px))] sm:w-[min(380px,calc((100dvh-48px)/2.1))] sm:rounded-[44px] sm:p-2.5">
        <div className="relative flex flex-1 flex-col overflow-hidden sm:rounded-[34px]">
          {/* the app's background - the looping sky video, inside the phone on
              EVERY viewport (desktop + mobile). On desktop the StageVideo also
              plays behind the device; on mobile the phone is the whole screen. */}
          <VideoBackground tint={theme.tint} />
          <AnimatePresence>{onboarded && locked ? <LockGate onUnlock={() => setLocked(false)} /> : null}</AnimatePresence>
          <AnimatePresence>{!onboarded ? <Onboarding onDone={finishOnboarding} /> : null}</AnimatePresence>
          {showShell ? (
          <ShellProvider>
            <Shell>
              <RouteErrorBoundary>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  </div>
                }
              >
              <Routes location={loc} key={loc.pathname}>
                <Route path="/" element={<Home />} />
                <Route path="/send" element={<Send />} />
                <Route path="/shield" element={<Shield />} />
                <Route path="/request" element={<Request />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/activity/:id" element={<TxDetail />} />
                <Route path="/deposit" element={<Deposit />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/contacts/:handle" element={<ContactDetail />} />
                <Route path="/share-proof" element={<ShareProof />} />
                <Route path="/invite" element={<InviteExternal />} />
                <Route path="/claim" element={<Claim />} />
                <Route path="*" element={<Home />} />
              </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </Shell>
          </ShellProvider>
          ) : null}
        </div>
      </div>
    </div>
  );
}
