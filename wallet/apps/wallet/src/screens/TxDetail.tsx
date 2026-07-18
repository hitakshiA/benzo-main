/**
 * TxDetail (C3) - the per-payment receipt every money app has (Wise / Cash App
 * parity). Reached at /activity/:id; reads the row straight from the already-loaded
 * history, so it is fully client-side - no extra backend call.
 *
 * A SPECIFIC title ("Payment received"), the amount + counterparty, a compact
 * status row with the real time, a full metadata block (from / amount / asset /
 * date / network / note / privacy / proof / copyable reference / fee), and two
 * plain buttons - view the on-chain proof, and share a receipt behind a pre-share
 * disclosure preview that spells out exactly what the recipient learns (#56).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Copy, ExternalLink, FileSearch, ShieldCheck } from "lucide-react";
import { copyTextToClipboard } from "../lib/clipboard";
import { useWallet } from "../lib/store";
import { fmtUsdc, fullDateTime } from "../lib/format";
import { useNetworkEnv } from "../lib/networkEnv";
import { COPY } from "../lib/copy";
import { Screen } from "../ui/motion";
import { ScreenHeader } from "../ui/chrome";
import { Avatar, Button, EmptyState, Sheet, useToast } from "../ui/primitives";
import { PrivateChip, ProvableChip } from "../ui/privacy";
import { explorerTxUrl } from "../ui/send/SendCeremony";
import type { ActivityRow } from "../lib/api";

const isDeposit = (row: ActivityRow) => row.type === "shield" || row.type === "cashIn";
const isWithdraw = (row: ActivityRow) => row.type === "unshield" || row.type === "cashOut";

/** Prefix-agnostic short form for a reference, a 0x tx hash, a bare hex hash, or
 *  a local id. Unlike shortAddress it never assumes a 2-char "0x" prefix, so a
 *  non-EVM id isn't sliced at the wrong offset. */
function shortReference(ref: string): string {
  return ref.length > 16 ? `${ref.slice(0, 8)}…${ref.slice(-6)}` : ref;
}

/** Did the row's owner actually pay a network fee? A plain incoming transfer is
 *  free to the recipient, but a deposit (shield/cashIn, direction "in") and
 *  anything outgoing pay gas. Fee ≠ direction. */
function paidNetworkFee(row: ActivityRow): boolean {
  if (isDeposit(row)) return true;
  return row.direction === "out";
}

function isFailedLikeRow(row: ActivityRow): boolean {
  if (row.status === "failed") return true;
  if (row.txHash) return false;
  const note = row.note ?? "";
  return /couldn'?t send|could not send|couldn'?t add|could not add|failed|not submitted|no on-chain settlement/i.test(note);
}

/** A SPECIFIC, plain-English title for this receipt, never a generic "Details". */
function titleFor(row: ActivityRow, failed: boolean): string {
  if (failed) return "Payment failed";
  if (isDeposit(row)) return "Money added";
  if (isWithdraw(row)) return "Transfer out";
  if (row.direction === "in") return row.status === "settled" ? "Payment received" : "Payment arriving";
  return row.status === "settled" ? "Payment sent" : "Sending payment";
}

/** Compact status label for the status row. */
function statusLabel(row: ActivityRow, failed: boolean): { label: string; cls: string } {
  if (failed) return { label: "Failed", cls: "text-danger bg-danger/12" };
  switch (row.status) {
    case "settled":
      return { label: "Settled", cls: "text-pos bg-pos/12" };
    case "proving":
      return { label: "Sending…", cls: "text-accent bg-accent/10" };
    case "arriving":
      return { label: "Arriving", cls: "text-amber bg-amber/12" };
    default:
      return { label: "Pending", cls: "text-amber bg-amber/12" };
  }
}

export function TxDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const env = useNetworkEnv();
  const toast = useToast();
  const { history, hidden } = useWallet();
  const row = useMemo(() => history.find((r) => r.id === id), [history, id]);
  const [copied, setCopied] = useState(false);
  const [disclose, setDisclose] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Clear the copy-reset timer on unmount so it can't fire setState after the
  // user has navigated away from the receipt.
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (!row) {
    return (
      <Screen>
        <ScreenHeader title="Payment" />
        <div className="px-5 pt-10">
          <EmptyState icon={<FileSearch size={28} />} title="Payment not found" hint="It may still be loading. Head back to your activity." />
          <Button full className="mt-5" onClick={() => nav("/activity")}>
            Back to activity
          </Button>
        </div>
      </Screen>
    );
  }

  const failed = isFailedLikeRow(row);
  // Honest on-chain claim: a legacy local row never counts as "Verified on-chain",
  // even if it carries a txHash - otherwise we'd link a dead explorer tx.
  const onChain = !row.unverified && !!row.txHash;
  const status = statusLabel(row, failed);
  const sign = failed ? "" : row.direction === "in" ? "+" : "−";
  const amountColor = failed ? "text-ink" : row.direction === "in" ? "text-pos" : "text-ink";
  const counterpartyPrefix =
    failed && row.direction === "out" ? "attempted to" : row.direction === "in" ? "from" : "to";
  const reference = row.txHash ?? row.id;
  const amountLabel = fmtUsdc(row.amount);
  const whenLabel = fullDateTime(row.timestamp);
  const explorerUrl = onChain && row.txHash ? explorerTxUrl(row.txHash) : "";

  async function copyReference() {
    const ok = await copyTextToClipboard(reference);
    if (ok) {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } else {
      toast({ title: "Couldn't copy reference", tone: "danger" });
    }
  }

  async function shareReceipt() {
    setDisclose(false);
    const text = `Benzo payment receipt · ${sign}${amountLabel} · ${whenLabel}${explorerUrl ? `\n${explorerUrl}` : ""}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Benzo payment receipt", text });
        return;
      } catch {
        /* dismissed, fall through to copy */
      }
    }
    const ok = await copyTextToClipboard(text);
    toast({ title: ok ? "Receipt copied to share" : "Couldn't copy receipt", tone: ok ? "success" : "danger" });
  }

  return (
    <Screen>
      <ScreenHeader title={titleFor(row, failed)} />
      <div className="px-5 pt-2">
        {/* amount + who */}
        <div className="flex flex-col items-center pt-3 text-center">
          <Avatar name={row.name} tone={row.tone} size={56} />
          <div className="mt-3" data-testid="txdetail-amount">
            {hidden ? (
              <span className="font-display text-[34px] text-ink/70" aria-label="Amount hidden">••••••</span>
            ) : (
              <span className={`font-display text-[34px] ${amountColor}`}>
                {sign}
                {amountLabel}
              </span>
            )}
          </div>
          <div className="mt-1 max-w-full px-4 text-[14px] text-muted">
            {counterpartyPrefix} <span className="font-semibold text-ink">{row.name}</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${status.cls}`} data-testid="txdetail-status">
              {status.label}
            </span>
            <span className="text-[12px] text-muted">{whenLabel}</span>
          </div>
          <div className="mt-3">
            {failed ? <PrivateChip label="No on-chain transfer recorded" /> : <PrivateChip label={COPY.privateOnChain} />}
          </div>
          {row.unverified ? (
            <span className="mt-2 inline-flex items-center rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted" data-testid="txdetail-unverified" title="Not verified on-chain">
              Unverified
            </span>
          ) : null}
        </div>

        {failed ? (
          <div className="mt-6 rounded-[var(--radius-card)] bg-danger/[0.06] p-4 text-[13px] leading-relaxed text-ink" data-testid="txdetail-failed-note">
            This payment didn't go through. No money left your wallet and nothing was recorded on-chain, you can safely try again.
          </div>
        ) : null}

        {/* metadata */}
        <div className="mt-4 space-y-3 rounded-[var(--radius-card)] bg-card p-5 text-[13.5px] shadow-[var(--shadow-card)]" data-testid="txdetail-meta">
          <DRow k={row.direction === "in" ? "From" : "To"} v={<span className="font-semibold text-ink">{row.name}</span>} />
          <DRow k="Amount" v={`${sign}${amountLabel}`} />
          <DRow k="Asset" v={env.isTestnet ? `Test ${env.asset}` : env.asset} />
          <DRow k="Date & time" v={whenLabel} />
          <DRow k="Network" v={env.name} />
          {row.note ? <DRow k="Note" v={`"${row.note}"`} /> : null}
          <DRow
            k="Privacy"
            v={
              <span className={`inline-flex items-center gap-1.5 ${failed ? "text-muted" : "text-pos"}`}>
                <ShieldCheck size={14} /> {failed ? "No transfer" : "Private"}
              </span>
            }
          />
          <DRow k="Proof status" v={onChain ? <ProvableChip label="Verified on-chain" /> : <span className="text-muted">{failed ? "Not settled" : "On this device"}</span>} />
          <DRow
            k="Reference"
            v={
              <button type="button" onClick={copyReference} data-testid="txdetail-reference" className="inline-flex items-center gap-1.5 rounded font-mono text-[12px] text-ink outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40">
                {shortReference(reference)}
                {copied ? <Check size={13} className="text-pos" /> : <Copy size={13} className="text-muted" />}
              </button>
            }
          />
          <DRow k="Fee" v={<span className="text-muted">{paidNetworkFee(row) ? "Network fee (paid in AVAX)" : "None, you received"}</span>} />
        </div>

        {/* actions */}
        <div className="mt-5 flex flex-col gap-2.5 pb-8">
          {onChain ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="txdetail-explorer"
              className="flex items-center justify-center gap-2 rounded-full border border-hair bg-card py-3 text-[14px] font-semibold text-ink transition hover:bg-canvas"
            >
              <ExternalLink size={16} /> View on-chain proof
            </a>
          ) : null}
          {onChain && !failed ? (
            <Button variant="secondary" full onClick={() => setDisclose(true)} data-testid="txdetail-share">
              <ShieldCheck size={16} /> Share proof of payment
            </Button>
          ) : null}
        </div>
      </div>

      {/* Pre-share disclosure preview, exactly what the recipient learns, and what
          stays private, shown BEFORE anything is shared (#56). */}
      <Sheet open={disclose} onClose={() => setDisclose(false)} title="Share proof of payment">
        <p className="text-[13.5px] leading-relaxed text-muted">
          You're about to share a receipt for this payment. Here's exactly what it reveals.
        </p>
        <div className="mt-4 rounded-2xl bg-pos/[0.06] p-4" data-testid="txdetail-disclose-reveals">
          <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-pos">They will see</div>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink">
            <li>· The amount: {sign}{amountLabel}</li>
            <li>· The date: {whenLabel}</li>
            <li>· The on-chain settlement reference</li>
          </ul>
        </div>
        <div className="mt-3 rounded-2xl bg-ink/[0.04] p-4" data-testid="txdetail-disclose-hidden">
          <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">They will NOT see</div>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink">
            <li>· Your balance</li>
            <li>· Your other payments or contacts</li>
          </ul>
        </div>
        <p className="mt-3 text-[12px] text-muted">{COPY.proofPrivacy}</p>
        <div className="mt-4 flex flex-col gap-2.5">
          <Button full onClick={shareReceipt} data-testid="txdetail-disclose-confirm">
            Share receipt
          </Button>
          <Button variant="ghost" full onClick={() => setDisclose(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

function DRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex-none text-muted">{k}</span>
      <span className="min-w-0 break-words text-right font-medium text-ink">{v}</span>
    </div>
  );
}
