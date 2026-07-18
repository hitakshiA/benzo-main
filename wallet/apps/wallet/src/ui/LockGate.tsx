import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Lock, LockOpen, Fingerprint, KeyRound } from "lucide-react";
import { Input, Button } from "./primitives";
import { EASE, spring } from "./motion";
import { unlockWallet, unlockWalletWithPasskey } from "../lib/localWallet";

export function LockGate({ onUnlock }: { onUnlock: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [success, setSuccess] = useState(false);
  const [walletType, setWalletType] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    const type = localStorage.getItem("benzo.wallet.type");
    setWalletType(type || "passkey");
  }, []);

  // On a successful unlock the lock morphs OPEN and the gate lifts away, revealing
  // Home underneath, no "Verifying…" copy. Hold briefly so the morph reads, then
  // hand off to the shell (immediately under reduced motion).
  function completeUnlock() {
    setSuccess(true);
    window.setTimeout(onUnlock, reduce ? 0 : 460);
  }

  async function unlockWithPasskey() {
    setBusy(true);
    setFailed(false);
    setErrorMsg(null);
    try {
      await unlockWalletWithPasskey();
      completeUnlock();
    } catch (e) {
      setBusy(false);
      setFailed(true);
      setErrorMsg((e as Error).message.includes("cancel") ? "Unlock cancelled." : "Could not unlock with passkey.");
    }
  }

  async function unlockWithPassphrase() {
    if (!passphrase) return;
    setBusy(true);
    setFailed(false);
    setErrorMsg(null);
    try {
      await unlockWallet(passphrase);
      completeUnlock();
    } catch {
      setBusy(false);
      setFailed(true);
      setErrorMsg("Incorrect passcode.");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05, transition: { duration: 0.4, ease: EASE } }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-hidden bg-canvas"
      data-testid="lock-gate"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: success && !reduce ? 1.08 : 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 18 }}
        className={`flex h-20 w-20 items-center justify-center rounded-full transition-colors ${success ? "bg-pos/15 text-pos" : "bg-accent/12 text-accent"}`}
        data-testid={success ? "lock-open" : "lock-closed"}
      >
        <AnimatePresence mode="wait" initial={false}>
          {success ? (
            <motion.span
              key="open"
              initial={reduce ? false : { scale: 0.6, opacity: 0, rotate: -14 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={spring}
            >
              <LockOpen size={34} />
            </motion.span>
          ) : (
            <motion.span key="closed" exit={reduce ? undefined : { scale: 0.6, opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}>
              <Lock size={34} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="px-8 text-center w-full max-w-[280px]">
        <h2 className="font-display text-xl">{success ? "Unlocked" : "Benzo is locked"}</h2>
        {!success ? (
          <p className="mt-1.5 text-[14px] text-muted">
            {walletType === "passphrase"
              ? "Enter your passcode to unlock your wallet."
              : "Unlock with your device passkey to continue."}
          </p>
        ) : null}
        {failed && errorMsg ? (
          <p className="mt-2 text-[13px] text-danger" data-testid="lock-failed">
            {errorMsg}
          </p>
        ) : null}
      </div>

      {success ? null : walletType === "passphrase" ? (
        <div className="w-full max-w-[280px] space-y-4 px-4">
          <Input
            type="password"
            placeholder="Enter passcode"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlockWithPassphrase()}
            data-testid="lock-passcode-input"
            autoFocus
          />
          <Button
            full
            loading={busy}
            onClick={unlockWithPassphrase}
            disabled={busy || !passphrase}
            data-testid="lock-unlock-passcode"
          >
            <KeyRound size={18} />
            Unlock
          </Button>
        </div>
      ) : (
        <button
          onClick={unlockWithPasskey}
          disabled={busy}
          data-testid="lock-unlock"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white shadow-[var(--shadow-glow)] transition outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60"
        >
          <Fingerprint size={18} />
          Unlock
        </button>
      )}
    </motion.div>
  );
}
