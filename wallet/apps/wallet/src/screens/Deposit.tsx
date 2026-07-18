/**
 * Receive - your Benzo wallet address + QR. A top-level tab (no back button). The
 * copy is network-honest: on a testnet it warns loudly that these are test funds,
 * and the privacy panel states the ACTUAL deposit behaviour, funds arrive as
 * public USDC and become private once shielded, never a false "auto-private"
 * promise (critique #54).
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Check, Copy, HandCoins, Share2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { copyTextToClipboard } from "../lib/clipboard";
import { getLocalAccountSummary } from "../lib/localWallet";
import { shortAddress } from "../lib/address";
import { useWallet } from "../lib/store";
import { useNetworkEnv } from "../lib/networkEnv";
import { Screen } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { useToast } from "../ui/primitives";

export function Deposit() {
  const nav = useNavigate();
  const env = useNetworkEnv();
  const toast = useToast();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "blocked">("idle");
  const [showFull, setShowFull] = useState(false);
  const address = getLocalAccountSummary()?.address ?? "";
  const assetLabel = env.isTestnet ? `Test ${env.asset}` : env.asset;
  const { session } = useWallet();
  const chainUnavailable = !!session && !session.live;

  async function copy() {
    if (!address) return;
    const ok = await copyTextToClipboard(address);
    // On a blocked clipboard, reveal the full address so there is something to
    // select and copy by hand (the guidance below points at it).
    if (!ok) setShowFull(true);
    setCopyState(ok ? "copied" : "blocked");
    setTimeout(() => setCopyState("idle"), ok ? 1500 : 3000);
  }

  async function share() {
    if (!address) return;
    const text = `My Benzo ${assetLabel} address on ${env.name}: ${address}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "My Benzo address", text });
        return;
      } catch (e) {
        // Tapping Cancel on the native share sheet rejects with AbortError, a
        // dismissal, not a failure, so bail out quietly with no copy/toast.
        if ((e as Error)?.name === "AbortError") return;
        // Any real failure (e.g. this payload can't be shared) falls through to copy.
      }
    }
    const ok = await copyTextToClipboard(address);
    toast({ title: ok ? "Address copied to share" : "Couldn't copy address", tone: ok ? "success" : "danger" });
  }

  return (
    <Screen>
      {/* Receive is a top-level tab (BottomNav), no back button. */}
      <ScreenHeader title="Receive" back={false} />
      <div className="px-5 pt-1">
        <p className="text-[14px] font-semibold text-ink" data-testid="receive-subtitle">
          Receive {assetLabel} <span className="text-muted">· {env.name}</span>
        </p>

        {/* Network-honest safety warning. */}
        <div
          className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-medium ${env.isTestnet ? "bg-amber/12 text-[#9a6b12]" : "bg-ink/[0.05] text-ink"}`}
          data-testid="receive-warning"
        >
          <AlertTriangle size={15} className="mt-px flex-none" />
          <span>
            {env.isTestnet
              ? "Testnet only. Do not send real USDC or assets from other networks, they cannot be recovered."
              : `Only send ${env.asset} on ${env.name}. Assets from other networks may be lost.`}
          </span>
        </div>

        <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl border border-hair bg-card p-5">
          {address ? (
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <QRCodeSVG value={address} size={148} level="M" />
            </div>
          ) : (
            <div className="flex h-[172px] w-[172px] flex-col items-center justify-center rounded-xl bg-canvas text-center" data-testid="deposit-address-missing">
              <div className="max-w-[150px] text-[12px] text-muted">Unlock your wallet to show your receive address.</div>
            </div>
          )}

          <div className="w-full">
            <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted">Your {env.asset} address</div>
            {/* Short by default; tap to reveal the full address. */}
            <button
              type="button"
              onClick={() => setShowFull((v) => !v)}
              disabled={!address}
              aria-label={showFull ? "Hide full address" : "Show full address"}
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl bg-canvas px-3 py-2.5 font-mono text-[13px] leading-tight text-ink transition outline-none hover:bg-canvas/70 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-accent/40"
              data-testid="deposit-address"
            >
              <span className="select-all break-all text-center [user-select:text]">{address ? (showFull ? address : shortAddress(address, 5)) : "Unavailable"}</span>
            </button>
            {address ? (
              <div className="mt-0.5 text-center text-[11px] text-muted">{showFull ? "Tap to shorten" : "Tap to show full address"}</div>
            ) : null}
          </div>

          {/* Copy · Share · Request · Make private */}
          <div className="grid w-full grid-cols-4 gap-2">
            <ActionBtn onClick={copy} disabled={!address} testid="deposit-copy" icon={copyState === "copied" ? <Check size={16} className="text-pos" /> : <Copy size={16} />} label={copyState === "copied" ? "Copied" : "Copy"} />
            <ActionBtn onClick={share} disabled={!address} testid="deposit-share" icon={<Share2 size={16} />} label="Share" />
            <ActionBtn onClick={() => nav("/request")} testid="deposit-request" icon={<HandCoins size={16} />} label="Request" />
            <ActionBtn onClick={() => nav("/shield?mode=shield")} disabled={!address || chainUnavailable} testid="deposit-make-private" icon={<ShieldCheck size={16} />} label="Make private" />
          </div>
          {copyState === "blocked" ? (
            <div role="status" aria-live="polite" className="w-full text-center text-[11.5px] font-semibold text-danger" data-testid="deposit-copy-status">
              Copy blocked. The full address is shown above, select it to copy manually.
            </div>
          ) : null}
        </div>

        {/* Info panel, asset, network, and the HONEST deposit-privacy behaviour
            (replaces the old floating "Received balance stays private" badge). */}
        <div className="mt-4 rounded-2xl border border-hair bg-card p-4" data-testid="receive-info">
          <InfoRow k="Asset" v={assetLabel} />
          <InfoRow k="Network" v={env.name} />
          <div className="mt-3 flex items-start gap-2 border-t border-hair pt-3">
            <ShieldCheck size={16} className="mt-px flex-none text-accent" />
            <div className="text-[12.5px] leading-relaxed text-muted" data-testid="receive-privacy">
              {env.asset} you receive arrives <span className="font-semibold text-ink">public</span> on {env.name}. Move it into your
              private balance to shield it, after that, your balance and payments stay private on-chain.
            </div>
          </div>
        </div>
        <div className="h-6" />
      </div>
    </Screen>
  );
}

function ActionBtn({ onClick, disabled, icon, label, testid }: { onClick: () => void; disabled?: boolean; icon: React.ReactNode; label: string; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="flex min-h-[74px] flex-col items-center justify-center gap-1.5 rounded-xl bg-canvas px-1 py-3 text-center text-[12px] font-semibold leading-tight text-ink transition outline-none hover:bg-ink/[0.05] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[13px]">
      <span className="text-muted">{k}</span>
      <span className="font-semibold text-ink">{v}</span>
    </div>
  );
}
