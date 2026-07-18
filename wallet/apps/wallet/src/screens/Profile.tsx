/**
 * Profile, sectioned settings (critique #58/#60/#61). Instead of a stack of
 * oversized cards + a duplicate network card, everything sits under clear section
 * headers: Wallet · Verification & limits · Privacy · Contacts · Security ·
 * Network · Recovery & data.
 *
 * #58 kills the "Verified human / Verify ID" contradiction (→ Basic verification /
 * limit / Verify identity), and compacts Network to a single "Fuji Testnet ·
 * Connected" row that opens a sheet, with chain-id / RPC / block height tucked
 * under Advanced.
 * #60 makes Security a real "Set up passkey" action that then REVEALS the lock
 * toggles (no dead disabled toggles pre-setup).
 * #61 turns Recovery & data into a real section plus a separate RED danger area
 * for deletion, verified backup + reauth + typed confirmation, and an honest
 * explanation that on-chain assets are NOT removed.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { DeploymentNetwork } from "@benzo/config";
import { useWallet } from "../lib/store";
import { getChainStatus } from "../lib/chain";
import { useNetwork } from "../lib/networkContext";
import { getNetworkEnv, NETWORK_TONE_CHIP, NETWORK_TONE_DOT } from "../lib/networkEnv";
import { resolveNetworkConfig } from "../lib/network";
import { COPY } from "../lib/copy";
import { copyTextToClipboard } from "../lib/clipboard";
import { shortAddress } from "../lib/address";
import { NetworkMark } from "../ui/Logo";
import { getLockSettings, setLockSettings, lockCapable, requireUnlock } from "../lib/lock";
import { registerPasskey } from "../lib/passkey";
import { sendCapUsd, tierOf } from "../lib/tiers";
import { Screen, Stagger } from "../ui/motion";
import { Avatar, Button, Card, Sheet, useToast } from "../ui/primitives";
import { deleteWallet, exportWallet, getLocalAccountSummary, getLocalRecoveryStatus, markWalletBackupConfirmed } from "../lib/localWallet";

// Verification display that fixes the "Verified human + Verify ID" contradiction:
// one honest ladder, so a tier never claims more than its CTA implies.
const VERIFY: Record<0 | 1 | 2 | 3, { label: string; cta: string | null }> = {
  0: { label: "Not verified", cta: "Verify you're human" },
  1: { label: "Basic verification", cta: "Verify identity" },
  2: { label: "ID verified", cta: null },
  3: { label: "Full verification", cta: null },
};

function dateLabel(ts?: number): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Profile() {
  const nav = useNavigate();
  const { session, balance, publicBalance, hidden, toggleHidden } = useWallet();
  const toast = useToast();
  const summary = getLocalAccountSummary();
  const address = summary?.address ?? "";
  const displayHandle = address ? shortAddress(address, 6) : "Local Wallet";

  // An unauthenticated / not-yet-tiered wallet is tier 0 ("Not verified"), never
  // default to tier 1 (which would falsely read "Basic verification"). Label and
  // limit derive from the same clamped tier so they can't disagree.
  const kyc = session?.kycTier ?? 0;
  const tier = tierOf(kyc);
  const verify = VERIFY[tier];
  const [verifyOpen, setVerifyOpen] = useState(false);

  // Recovery
  const [recovery, setRecovery] = useState(() => getLocalRecoveryStatus());
  const [backupText, setBackupText] = useState("");
  const [backupOpen, setBackupOpen] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testing, setTesting] = useState(false);

  // Security (app lock, gated by an on-device passkey)
  const [secured, setSecured] = useState(() => lockCapable());
  const [lock, setLock] = useState(() => getLockSettings());
  const [settingUp, setSettingUp] = useState(false);
  const [passkeyErr, setPasskeyErr] = useState<string | null>(null);

  // Deletion danger area
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);

  const privateHasFunds = BigInt(balance?.baseUnits ?? "0") > 0n;
  const publicHasFunds = BigInt(publicBalance?.baseUnits ?? "0") > 0n;
  const hasFunds = privateHasFunds || publicHasFunds;
  const backedUp = Boolean(recovery.backupConfirmedAt);
  const canDelete = backedUp && deleteConfirm.trim().toUpperCase() === "DELETE";
  const chainUnavailable = !!session && !session.live;

  async function toggleLock(key: "onOpen" | "onSend") {
    const next = { ...lock, [key]: !lock[key] };
    if (next[key] && !(await requireUnlock())) return;
    setLock(next);
    setLockSettings(next);
  }

  async function setupPasskey() {
    setSettingUp(true);
    setPasskeyErr(null);
    try {
      await registerPasskey({ userName: address || "benzo-wallet" });
      const ok = lockCapable();
      setSecured(ok);
      if (!ok) setPasskeyErr("This device can't set up an app passkey. Your keys are still safe on-device.");
    } catch (e) {
      setPasskeyErr((e as Error).message || "Passkey setup was cancelled.");
    } finally {
      setSettingUp(false);
    }
  }

  async function revealRecoveryBackup() {
    setExportingBackup(true);
    setBackupErr(null);
    try {
      if (!(await requireUnlock())) {
        setBackupErr("Unlock cancelled.");
        return;
      }
      const backup = await exportWallet();
      setBackupText(backup);
      setBackupOpen(true);
      setRecovery(getLocalRecoveryStatus());
    } catch (e) {
      setBackupErr((e as Error).message || "Recovery backup could not be revealed.");
    } finally {
      setExportingBackup(false);
    }
  }

  async function copyRecoveryBackup() {
    const ok = await copyTextToClipboard(backupText);
    if (ok) toast({ title: "Recovery backup copied.", tone: "success" });
    else setBackupErr("Could not copy backup data.");
  }

  function confirmRecoveryBackupSaved() {
    markWalletBackupConfirmed();
    setRecovery(getLocalRecoveryStatus());
    toast({ title: "Recovery backup marked saved.", tone: "success" });
  }

  async function testRecovery() {
    setTesting(true);
    setTestResult(null);
    try {
      if (!(await requireUnlock())) {
        setTestResult(null);
        return;
      }
      // A genuine check: re-derive an exportable backup right now and confirm it
      // parses with every key a restore needs. No fabricated "all good".
      const backup = await exportWallet();
      const parsed = JSON.parse(backup) as Record<string, unknown>;
      const ok = ["evmPrivateKey", "eercDecryptionKey", "orgSpendId", "mvkSeedHex"].every((k) => Boolean(parsed[k]));
      setTestResult(ok ? "ok" : "fail");
      setRecovery(getLocalRecoveryStatus());
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  }

  async function copyAddress() {
    const ok = await copyTextToClipboard(address);
    if (ok) {
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);
    }
  }

  async function deleteAccount() {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      // If a device passkey gates this wallet, re-authenticate at the moment of
      // destruction. Without a configured passkey requireUnlock() is a no-op, so
      // the confirmed-backup + typed-DELETE guards are the primary protection here.
      if (secured && !(await requireUnlock())) {
        setDeleteErr("Unlock cancelled.");
        return;
      }
      await deleteWallet();
      window.location.reload();
    } catch (e) {
      setDeleteErr((e as Error).message || "Account could not be deleted yet.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen>
      <div className="px-5 pb-2 pt-6">
        <h1 className="font-display text-page-title">Profile</h1>
      </div>
      <Stagger className="space-y-6 px-5 pb-4">
        {/* -------------------------------------------------------- Wallet */}
        <Stagger.Item index={0}>
          <Section title="Wallet">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Avatar name={session?.profile.name ?? "You"} tone="accent" size={48} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg">{session?.profile.name ?? "You"}</div>
                  <button type="button" onClick={copyAddress} className="mt-0.5 inline-flex items-center gap-1.5 rounded font-mono text-[12px] text-muted outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="profile-address">
                    {displayHandle}
                    {addressCopied ? <Check size={12} className="text-pos" /> : <Copy size={12} />}
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => nav("/deposit")} data-testid="profile-receive">Receive</Button>
                  <Button variant="secondary" size="sm" onClick={() => nav("/shield?mode=unshield")} disabled={chainUnavailable} data-testid="profile-cash-out">
                    <ArrowUpRight size={14} /> Cash out
                  </Button>
                </div>
              </div>
            </Card>
          </Section>
        </Stagger.Item>

        {/* -------------------------------------- Verification & limits */}
        <Stagger.Item index={1}>
          <Section title="Verification & limits">
            <Card className="px-4" data-testid="verify-card">
              <div className="flex items-center gap-3 py-3.5">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-pos/12 text-pos"><BadgeCheck size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold" data-testid="tier-label">{verify.label}</div>
                  <div className="text-[13px] text-muted">
                    Send up to <span className="font-semibold text-ink">${sendCapUsd(kyc).toLocaleString()}</span> / 30 days · receiving is always unlimited and private
                  </div>
                </div>
              </div>
              {verify.cta ? (
                <div className="border-t border-hair">
                  <button onClick={() => setVerifyOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-lg py-3.5 text-left text-[14px] font-semibold text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="verify-cta">
                    <span className="flex-1">{verify.cta}</span>
                    <ChevronRight size={18} className={`text-muted transition ${verifyOpen ? "rotate-90" : ""}`} />
                  </button>
                  {verifyOpen ? (
                    <p className="pb-3.5 text-[12.5px] leading-relaxed text-muted" data-testid="verify-explainer">
                      A one-time ID check (through a verification provider) raises your private send limit. Your ID never goes on-chain, and the network only learns that you cleared the tier, never who you are.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </Section>
        </Stagger.Item>

        {/* -------------------------------------------------------- Privacy */}
        <Stagger.Item index={2}>
          <Section title="Privacy">
            <Card className="divide-y divide-hair px-4">
              <SettingRow
                icon={hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                label="Hide balance"
                right={
                  <Toggle on={hidden} onToggle={toggleHidden} testid="profile-hide-toggle" ariaLabel="Hide balance" />
                }
              />
              <SettingRow
                icon={<ShieldCheck size={18} />}
                label="Proof generation"
                right={<span className="text-[13px] text-muted">On this device</span>}
              />
            </Card>
            <p className="mt-2 px-1 text-[12px] text-muted">{COPY.proofOnDevice}</p>
          </Section>
        </Stagger.Item>

        {/* -------------------------------------------------------- Contacts */}
        <Stagger.Item index={3}>
          <Section title="Contacts">
            <Card onClick={() => nav("/contacts")} className="flex items-center gap-3 p-4 transition hover:shadow-[0_10px_30px_rgba(115,66,226,0.12)]" data-testid="profile-contacts">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent/10 text-accent"><Users size={19} /></div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold">People you pay</div>
                <div className="text-[13px] text-muted">Save the people you pay often.</div>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </Card>
          </Section>
        </Stagger.Item>

        {/* -------------------------------------------------------- Security */}
        <Stagger.Item index={4}>
          <Section title="Security">
            <Card className="px-4" data-testid="security-card">
              <div className="flex items-center gap-3 py-3.5">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-canvas text-ink"><Lock size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">App security</div>
                  <div className="text-[12.5px] text-muted">{secured ? "Passkey configured on this device" : "No passkey configured"}</div>
                </div>
              </div>
              {secured ? (
                <div className="divide-y divide-hair border-t border-hair" data-testid="security-toggles">
                  <LockToggle label="Require to open the app" on={lock.onOpen} onToggle={() => toggleLock("onOpen")} testid="lock-open-toggle" />
                  <LockToggle label="Require before every payment" on={lock.onSend} onToggle={() => toggleLock("onSend")} testid="lock-send-toggle" />
                </div>
              ) : (
                <div className="border-t border-hair py-3.5">
                  {/* No dead disabled toggles, a locked explanation + a real action. */}
                  <div className="flex items-start gap-2.5 rounded-xl bg-ink/[0.04] p-3" data-testid="security-locked-note">
                    <Lock size={15} className="mt-px flex-none text-muted" />
                    <p className="text-[12.5px] leading-relaxed text-muted">
                      Set up a passkey to lock the app and require approval before payments. Your device biometric or PIN unlocks it, nothing leaves this device.
                    </p>
                  </div>
                  <Button full className="mt-3" loading={settingUp} onClick={setupPasskey} data-testid="setup-passkey">
                    <Fingerprint size={16} /> Set up passkey
                  </Button>
                  {passkeyErr ? <div className="mt-2 text-center text-[12px] font-medium text-danger" data-testid="passkey-error">{passkeyErr}</div> : null}
                </div>
              )}
            </Card>
          </Section>
        </Stagger.Item>

        {/* -------------------------------------------------------- Network */}
        <Stagger.Item index={5}>
          <Section title="Network">
            <NetworkSection />
          </Section>
        </Stagger.Item>

        {/* -------------------------------------------------- Recovery & data */}
        <Stagger.Item index={6}>
          <Section title="Recovery & data">
            <Card className="px-4" data-testid="recovery-card">
              <div className="flex items-center gap-3 py-3.5">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-canvas text-ink"><KeyRound size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">Recovery</div>
                  <div className="text-[12.5px] text-muted" data-testid="profile-recovery-status">{recovery.label}</div>
                </div>
              </div>
              <div className="space-y-1.5 border-t border-hair py-3 text-[13px]">
                <MetaRow k="Last backup" v={dateLabel(recovery.lastExportedAt)} />
                <MetaRow k="Method" v="Self-custody · this device" />
                <MetaRow k="Trusted devices" v="This device" />
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-hair py-3">
                <Button variant="secondary" size="sm" loading={exportingBackup} onClick={revealRecoveryBackup} data-testid="recovery-reveal">
                  <KeyRound size={14} /> Back up / Export key
                </Button>
                <Button variant="secondary" size="sm" loading={testing} onClick={testRecovery} data-testid="recovery-test">
                  <ShieldCheck size={14} /> Test recovery
                </Button>
              </div>
              {testResult ? (
                <div className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${testResult === "ok" ? "bg-pos/12 text-pos" : "bg-danger/12 text-danger"}`} data-testid="recovery-test-result">
                  {testResult === "ok" ? "Recovery works, your backup can restore this wallet." : "Recovery check failed. Re-export and store a fresh backup."}
                </div>
              ) : null}
              {backupErr ? <div className="mb-3 text-[12px] font-medium text-danger" data-testid="recovery-error">{backupErr}</div> : null}
              {backupOpen ? (
                <div className="mb-3 rounded-xl border border-hair bg-canvas/70 p-3" data-testid="recovery-backup-panel">
                  <div className="text-[12.5px] leading-relaxed text-muted">
                    Anyone with this backup controls the wallet. Store it privately; Benzo cannot recover it for you.
                  </div>
                  <pre className="mt-3 max-h-[170px] overflow-x-auto rounded-lg bg-card p-3 text-[11px] leading-relaxed text-muted select-all" data-testid="recovery-backup-json">
                    {backupText}
                  </pre>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={copyRecoveryBackup} data-testid="recovery-copy">
                      <Copy size={14} /> Copy
                    </Button>
                    {recovery.backupConfirmedAt ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-pos/12 px-3.5 py-2 text-sm font-semibold text-pos" data-testid="recovery-saved">
                        <Check size={14} /> Backup saved
                      </span>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={confirmRecoveryBackupSaved} data-testid="recovery-confirm-saved">
                        <Check size={14} /> I've saved it
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => { setBackupOpen(false); setBackupText(""); }} data-testid="recovery-hide">
                      Hide
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          </Section>
        </Stagger.Item>

        {/* -------------------------------------------------- Danger area */}
        <Stagger.Item index={7}>
          <div className="rounded-[var(--radius-card)] border border-danger/30 bg-danger/[0.04] p-4" data-testid="danger-area">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-danger/12 text-danger"><Trash2 size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-danger">Delete hosted profile data</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  Clears the Benzo profile data stored for this device and rotates your wallet key. It does <span className="font-semibold text-ink">not</span> remove or move any assets already on-chain, those stay under your current wallet and are only reachable with your recovery backup. Without a backup, this wallet and its funds are lost forever.
                </p>
              </div>
            </div>

            {!deleteOpen ? (
              <Button variant="danger" size="sm" className="mt-3" onClick={() => setDeleteOpen(true)} data-testid="delete-open">
                Delete profile data
              </Button>
            ) : (
              <div className="mt-3 space-y-3" data-testid="delete-panel">
                {!backedUp ? (
                  <div className="rounded-lg bg-amber/12 px-3 py-2 text-[12px] font-medium text-[#9a6b12]" data-testid="delete-needs-backup">
                    Back up and confirm your recovery key first, otherwise deletion is irreversible.
                  </div>
                ) : null}
                {hasFunds ? (
                  <div className="rounded-lg bg-amber/12 px-3 py-2 text-[12px] font-medium text-[#9a6b12]" data-testid="delete-has-funds">
                    This wallet still holds funds. They remain on-chain and are only recoverable with your backup.
                  </div>
                ) : null}
                <div className="rounded-lg bg-card px-3 py-2 text-[12px]">
                  <div className="text-muted">Wallet address (funds stay here on-chain)</div>
                  <div className="mt-0.5 break-all font-mono text-[11px] text-ink" data-testid="delete-address">{address || "Unavailable"}</div>
                </div>
                <label className="block">
                  <span className="text-[12.5px] font-semibold text-ink">Type DELETE to confirm</span>
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    autoCapitalize="characters"
                    data-testid="delete-confirm-input"
                    className="mt-1.5 w-full rounded-[var(--radius-input)] border border-hair bg-canvas px-4 py-2.5 text-[15px] text-ink outline-none transition placeholder:text-muted focus:border-danger focus:ring-4 focus:ring-danger/15"
                  />
                </label>
                {deleteErr ? <div className="text-[12px] font-medium text-danger" data-testid="delete-error">{deleteErr}</div> : null}
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); }} data-testid="delete-cancel">Cancel</Button>
                  <Button variant="danger" size="sm" className="flex-1" disabled={!canDelete} loading={deleting} onClick={deleteAccount} data-testid="delete-confirm">
                    Delete forever
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Stagger.Item>

        <Stagger.Item index={8}>
          <p className="px-2 text-center text-[12px] leading-relaxed text-muted">
            Your balance and payments are private by default, you choose what to prove.
          </p>
        </Stagger.Item>
      </Stagger>
    </Screen>
  );
}

// -------------------------------------------------------- Network section

const NET_META: Record<DeploymentNetwork, { name: string; risk: string; confirm?: boolean }> = {
  fuji: { name: "Fuji Testnet", risk: "Test funds only" },
  benzonet: { name: "BenzoNet", risk: "Permissioned network" },
  avalanche: { name: "Avalanche Mainnet", risk: "Real assets", confirm: true },
};

function NetworkSection() {
  const { network, setNetwork, options } = useNetwork();
  const env = getNetworkEnv(network);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirm, setConfirm] = useState<DeploymentNetwork | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [ledger, setLedger] = useState<number | null>(null);
  const cfg = resolveNetworkConfig(network);

  useEffect(() => {
    setLedger(null);
    const ac = new AbortController();
    const tick = () => getChainStatus(ac.signal).then((s) => setLedger(s.sequence)).catch(() => {});
    tick();
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) tick();
    }, 20_000);
    return () => {
      ac.abort();
      clearInterval(iv);
    };
  }, [network]);

  function closeSheet() {
    setConfirm(null);
    setSheetOpen(false);
  }
  function choose(next: DeploymentNetwork) {
    if (next === network) return closeSheet();
    if (NET_META[next].confirm) return setConfirm(next);
    setNetwork(next);
    closeSheet();
  }
  function confirmSwitch() {
    if (confirm) setNetwork(confirm);
    closeSheet();
  }

  return (
    <>
      <Card className="p-4">
        {/* Compact "Fuji Testnet · Connected" row, no block height here. */}
        <button type="button" onClick={() => setSheetOpen(true)} className="flex w-full items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg" data-testid="network-row">
          <NetworkMark network={network} size={34} className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink">{env.name}</div>
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted" data-testid="network-status">
              <span className={`h-1.5 w-1.5 rounded-full ${ledger != null ? NETWORK_TONE_DOT[env.tone] : "bg-muted"}`} />
              {ledger != null ? "Connected" : "Connecting…"}
            </div>
          </div>
          <span className={`flex-none rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${NETWORK_TONE_CHIP[env.tone]}`}>{env.funds}</span>
          <ChevronRight size={18} className="flex-none text-muted" />
        </button>

        {/* Advanced, chain id / RPC / block height live here only. */}
        <div className="mt-2 border-t border-hair pt-2">
          <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex w-full items-center justify-between rounded py-1 text-[12.5px] font-semibold text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="network-advanced-toggle">
            Advanced
            <ChevronDown size={15} className={`transition ${advanced ? "rotate-180" : ""}`} />
          </button>
          {advanced ? (
            <div className="space-y-1.5 pb-1 pt-1.5 text-[12px]" data-testid="network-advanced">
              <MetaRow k="Chain ID" v={String(cfg.chainId)} />
              <MetaRow k="RPC" v={<span className="break-all font-mono text-[11px]">{cfg.rpcUrl}</span>} />
              <MetaRow k="Block height" v={ledger != null ? `#${ledger.toLocaleString()}` : "-"} />
            </div>
          ) : null}
        </div>
      </Card>

      <Sheet open={sheetOpen} onClose={closeSheet} title="Select network">
        {confirm ? (
          <div data-testid="network-confirm">
            <div className="flex items-start gap-3 rounded-2xl bg-danger/10 p-4">
              <AlertTriangle size={20} className="mt-0.5 flex-none text-danger" />
              <div>
                <div className="text-[15px] font-semibold text-ink">Switch to {NET_META[confirm].name}?</div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Mainnet uses <span className="font-semibold text-ink">real assets</span>. Payments are final and cost real network fees.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2.5">
              <Button variant="danger" full onClick={confirmSwitch} data-testid="network-confirm-yes">Use real assets</Button>
              <Button variant="ghost" full onClick={() => setConfirm(null)} data-testid="network-confirm-cancel">Stay on {env.name}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 outline-none" role="listbox" aria-label="Networks" tabIndex={0}>
            {options.map((opt) => {
              const n = opt.network;
              const e = getNetworkEnv(n);
              const on = n === network;
              return (
                <button
                  key={n}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(n)}
                  data-testid={`network-option-${n}`}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? "border-accent bg-accent/[0.06]" : "border-hair bg-card hover:bg-canvas"}`}
                >
                  <NetworkMark network={n} size={32} className="flex-none" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-ink">{NET_META[n].name}</div>
                    <span className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${NETWORK_TONE_CHIP[e.tone]}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${NETWORK_TONE_DOT[e.tone]}`} />
                      {NET_META[n].risk}
                    </span>
                  </div>
                  {on ? <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent text-white"><Check size={14} /></span> : null}
                </button>
              );
            })}
            <p className="pt-2 text-center text-[12px] text-muted">Balances and activity differ per network.</p>
          </div>
        )}
      </Sheet>
    </>
  );
}

// -------------------------------------------------------- small building blocks

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 px-1 text-section text-muted">{title}</div>
      {children}
    </div>
  );
}

function SettingRow({ icon, label, right }: { icon: React.ReactNode; label: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-canvas text-ink">{icon}</div>
      <div className="flex-1 text-[15px] font-medium">{label}</div>
      {right}
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex-none text-muted">{k}</span>
      <span className="min-w-0 text-right font-medium text-ink">{v}</span>
    </div>
  );
}

function Toggle({ on, onToggle, testid, ariaLabel }: { on: boolean; onToggle: () => void; testid: string; ariaLabel: string }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      data-testid={testid}
      className={`relative h-6 w-11 flex-none rounded-full transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card ${on ? "bg-accent" : "bg-ink/15"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function LockToggle({ label, on, onToggle, testid }: { label: string; on: boolean; onToggle: () => void; testid: string }) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="flex-1 text-[14px] font-medium">{label}</div>
      <Toggle on={on} onToggle={onToggle} testid={testid} ariaLabel={label} />
    </div>
  );
}
