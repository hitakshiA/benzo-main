/**
 * Shared screen chrome: the Home top bar (logo + network pill + eye + bell) and
 * the sub-screen header (optional back chevron + title). The network affordance is
 * a compact PILL (name + Avalanche mark), not a globe, a globe reads as
 * language/web, not "which chain". See ui/NetworkPill.
 */
import { Bell, ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { IconButton } from "./primitives";
import { NetworkPill } from "./NetworkPill";
import { HideToggle } from "./privacy";
import { useWallet } from "../lib/store";
import { unreadCount } from "../lib/notifications";

export function TopBar({ hidden, onToggleHide }: { hidden: boolean; onToggleHide: () => void }) {
  const nav = useNavigate();
  const { history } = useWallet();
  const unread = unreadCount(history);
  return (
    <div className="safe-top flex items-center justify-between px-5 pb-2">
      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
        <Logo size={30} className="text-ink" />
      </motion.div>
      <div className="flex items-center gap-2">
        <NetworkPill />
        <HideToggle hidden={hidden} onToggle={onToggleHide} />
        <IconButton badge={unread > 0} aria-label="Notifications" onClick={() => nav("/notifications")} data-testid="bell">
          <Bell size={18} />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * Sub-screen header. `back` (default true) shows the chevron for pushed screens
 * (Send flow, tx-detail, contact-detail); top-level tabs (Activity, Receive) pass
 * `back={false}` so they don't sprout a back button that would pop off the tab.
 * `right` slots an optional trailing control (e.g. an action).
 */
export function ScreenHeader({
  title,
  onBack,
  back = true,
  right,
}: {
  title: string;
  onBack?: () => void;
  back?: boolean;
  right?: ReactNode;
}) {
  const nav = useNavigate();
  return (
    <div className="safe-top flex items-center gap-2 px-5 pb-1">
      {back ? (
        <IconButton onClick={() => (onBack ? onBack() : nav(-1))} aria-label="Back">
          <ChevronLeft size={20} />
        </IconButton>
      ) : null}
      <h1 className="font-display text-page-title">{title}</h1>
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}
