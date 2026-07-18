/**
 * Home - the single focal screen. One compact balance (Helvetica Now, counts up),
 * the ambient Private chip, a row of quick actions, and a plain-English activity
 * preview. No tx hashes, gas, or "connect wallet". A blocking banner appears only
 * when the BFF isn't live.
 *
 * Send lives on the central nav FAB, so it is NOT repeated as a glowing pill here
 * (critique #52, dedupe Send). The quick-action row carries the affordances the
 * FAB doesn't: Receive, Request, and the Benzo differentiator, Prove.
 */
import { ArrowDownLeft, ArrowUpRight, HandCoins, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useWallet } from "../lib/store";
import { Screen, Stagger } from "../ui/motion";
import { TopBar } from "../ui/chrome";
import { BalanceHero, BalanceDenomination } from "../ui/money";
import { PrivateChip } from "../ui/privacy";
import { Card } from "../ui/primitives";
import { COPY } from "../lib/copy";
import { ActivityItem } from "../ui/ActivityItem";

function QuickAction({
  label,
  icon,
  onClick,
  testid,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  testid: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -3 }}
      onClick={onClick}
      data-testid={testid}
      // ~96px tall, inside the 88-104px band the critique asks for. Equal-weight
      // secondary cards; the purple glow belongs to the nav Send FAB alone.
      className="flex h-24 flex-1 flex-col items-center justify-center gap-2 rounded-[20px] bg-card text-[13px] font-semibold text-ink shadow-[0_6px_18px_rgba(25,40,55,0.05)] transition outline-none hover:shadow-[0_8px_22px_rgba(25,40,55,0.09)] focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas text-accent">{icon}</span>
      {label}
    </motion.button>
  );
}

export function Home() {
  const nav = useNavigate();
  const location = useLocation();
  const justSent = Boolean((location.state as { justSent?: boolean } | null)?.justSent);
  const { balance, history, loading, hidden, toggleHidden, session } = useWallet();
  const chainUnavailable = !!session && !session.live;

  return (
    <Screen>
      <TopBar hidden={hidden} onToggleHide={toggleHidden} />

      {chainUnavailable ? (
        <div role="alert" className="mx-5 mb-1 rounded-xl bg-amber/12 px-3 py-2 text-[12px] font-medium text-[#9a6b12]" data-testid="chain-unavailable-banner">
          Live chain connection unavailable. Balance and money actions are blocked until the app reconnects.
        </div>
      ) : null}

      <Stagger className="px-5">
        {/* Balance hero - the focal card, de-inflated (p-5, one ink figure). */}
        <Stagger.Item index={0}>
          <Card className="relative overflow-hidden p-5">
            <div className="text-[13px] font-medium text-muted">Private balance</div>
            <BalanceHero baseUnits={balance?.baseUnits ?? "0"} hidden={hidden} loading={loading} arrived={justSent} />
            {/* Denomination / "not real money" context, load-bearing on testnet. */}
            <BalanceDenomination className="mt-1" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PrivateChip label={COPY.privateOnChain} />
              {balance?.syncing ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber/12 px-2.5 py-1 text-[11.5px] font-semibold text-[#9a6b12]"
                  data-testid="balance-syncing"
                  title="Showing the encrypted wallet ledger while the chain index catches up."
                >
                  Syncing chain
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!chainUnavailable) nav("/shield?mode=shield");
                }}
                disabled={chainUnavailable}
                data-testid="home-make-private"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white shadow-[var(--shadow-glow)] transition outline-none hover:brightness-110 disabled:cursor-not-allowed disabled:bg-ink/[0.06] disabled:text-muted disabled:shadow-none disabled:hover:brightness-100 focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <ArrowDownLeft size={15} /> Make private
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!chainUnavailable) nav("/shield?mode=unshield");
                }}
                disabled={chainUnavailable}
                data-testid="home-cash-out"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-canvas px-3 py-2 text-[13px] font-semibold text-ink transition outline-none hover:bg-ink/[0.05] disabled:cursor-not-allowed disabled:bg-ink/[0.06] disabled:text-muted focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ArrowUpRight size={15} /> Cash out
              </button>
            </div>
          </Card>
        </Stagger.Item>

        {/* Quick actions, Send is the nav FAB, so it is not duplicated here. */}
        <Stagger.Item index={1}>
          <div className="mt-4 flex gap-2.5">
            <QuickAction label="Receive" testid="action-receive" icon={<ArrowDownLeft size={18} />} onClick={() => nav("/deposit")} />
            <QuickAction label="Request" testid="action-request" icon={<HandCoins size={18} />} onClick={() => nav("/request")} />
            <QuickAction label="Prove" testid="action-prove" icon={<ShieldCheck size={18} />} onClick={() => nav("/share-proof")} />
          </div>
        </Stagger.Item>

        {/* Activity preview */}
        <Stagger.Item index={2}>
          <Card className="mt-4 px-4 pb-2 pt-4">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Recent</div>
              <button onClick={() => nav("/activity")} className="rounded text-[12px] font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40">
                See all
              </button>
            </div>
            {loading ? (
              <div className="space-y-3 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton h-[42px] w-[42px] rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton h-3.5 w-28 rounded" />
                      <div className="skeleton h-3 w-20 rounded" />
                    </div>
                    <div className="skeleton h-4 w-14 rounded" />
                  </div>
                ))}
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-7 text-center">
                <div className="text-sm font-semibold text-ink">Receive money to get going</div>
                <div className="max-w-[240px] text-[13px] text-muted">
                  Once there's money in your wallet, your payments show up here - private to you.
                </div>
                <button
                  onClick={() => nav("/deposit")}
                  data-testid="empty-receive"
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[var(--shadow-glow)] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <ArrowDownLeft size={14} /> Receive
                </button>
              </div>
            ) : (
              history.slice(0, 3).map((row, i, a) => <ActivityItem key={row.id} row={row} hidden={hidden} last={i === a.length - 1} />)
            )}
          </Card>
        </Stagger.Item>
        <div className="h-6" />
      </Stagger>
    </Screen>
  );
}
