/**
 * One activity row - avatar, plain-English line, signed amount, and a soft status
 * pill for in-flight / failed states. Every row now carries a SEMANTIC type icon
 * (received / sent / deposit / withdraw / pending / failed) so the kind of money
 * movement is legible at a glance, not only from the +/− sign (critique #53).
 * No tx hashes, no chain words.
 */
import { motion } from "framer-motion";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronRight, Clock, Landmark } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivityRow } from "../lib/api";
import { activityRowTime } from "../lib/format";
import { AmountText } from "./money";
import { Avatar } from "./primitives";

const STATUS_PILL: Record<string, { label: string; cls: string } | undefined> = {
  arriving: { label: "Arriving · ~2 min", cls: "text-amber bg-amber/12" },
  proving: { label: "Sending…", cls: "text-accent bg-accent/10" },
  pending: { label: "Pending", cls: "text-amber bg-amber/12" },
  failed: { label: "Failed", cls: "text-danger bg-danger/12" },
};

const isDeposit = (row: ActivityRow) => row.type === "shield" || row.type === "cashIn";
const isWithdraw = (row: ActivityRow) => row.type === "unshield" || row.type === "cashOut";
const isSystemTransfer = (row: ActivityRow) => isDeposit(row) || isWithdraw(row);

/** Kind used for filtering + the semantic type badge. */
export function activityCategory(row: ActivityRow): "sent" | "received" | "deposit" {
  if (isDeposit(row)) return "deposit";
  return row.direction === "in" ? "received" : "sent";
}

/** The small semantic badge that overlays a person avatar (system rows already
 *  carry a semantic main icon). Failed / in-flight win over direction. */
function typeBadge(row: ActivityRow): { icon: ReactNode; cls: string } {
  if (row.status === "failed") return { icon: <AlertTriangle size={11} />, cls: "bg-danger text-white" };
  if (row.status === "proving" || row.status === "arriving" || row.status === "pending")
    return { icon: <Clock size={11} />, cls: "bg-amber text-white" };
  if (row.direction === "in") return { icon: <ArrowDownLeft size={11} />, cls: "bg-pos text-white" };
  return { icon: <ArrowUpRight size={11} />, cls: "bg-ink text-white" };
}

export function ActivityItem({ row, hidden, last }: { row: ActivityRow; hidden?: boolean; last?: boolean }) {
  const nav = useNavigate();
  const pill = STATUS_PILL[row.status];
  const amountDirection = row.status === "failed" ? undefined : row.direction;
  const badge = typeBadge(row);
  return (
    <motion.button
      type="button"
      onClick={() => nav(`/activity/${row.id}`)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.985 }}
      className={`group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-canvas/60 ${last ? "" : "border-b border-hair"}`}
      data-testid="activity-row"
    >
      <div className="relative flex-none">
        {isSystemTransfer(row) ? (
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isDeposit(row) ? "bg-[#e7e0fb] text-[#4a2fa0]" : "bg-[#fbf1dd] text-[#9a6b12]"}`}>
            <Landmark size={17} />
          </div>
        ) : (
          <Avatar name={row.name} tone={row.tone} size={40} />
        )}
        {/* Semantic type badge, direction, or failed / in-flight when relevant. */}
        <span className={`absolute -bottom-0.5 -right-0.5 flex h-[17px] w-[17px] items-center justify-center rounded-full ring-2 ring-card ${badge.cls}`}>
          {badge.icon}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{row.name}</span>
          {row.unverified ? (
            <span className="flex-none rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted" title="Not verified on-chain">Unverified</span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted">{row.note}</div>
        {pill ? (
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill.cls}`}>{pill.label}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <div className="flex flex-col items-end">
          {hidden ? (
            <span className="font-display text-base text-ink/70" aria-label="Amount hidden">
              ••••
            </span>
          ) : (
            <AmountText baseUnits={row.amount} direction={amountDirection} className="text-base" />
          )}
          <span className="mt-0.5 text-xs text-muted">{activityRowTime(row.timestamp)}</span>
        </div>
        <ChevronRight size={15} className="flex-none text-hair transition group-hover:text-muted" />
      </div>
    </motion.button>
  );
}
