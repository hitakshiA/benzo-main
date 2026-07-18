/**
 * NetworkPill, the header network affordance. A globe reads as "language / web",
 * not "which chain am I on", so the top bar shows a compact PILL instead: the
 * Avalanche mark + the network's trust name ("Fuji Testnet"), toned amber for a
 * testnet and green only for mainnet (see lib/networkEnv). Tapping it opens the
 * NetworkSheet, a bottom sheet with per-network risk labels + a mainnet confirm
 * (critique #55), and retints the shell.
 *
 * Reusable: drop `<NetworkPill />` anywhere a header needs the network affordance.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { NetworkMark } from "./Logo";
import { NetworkSheet } from "./NetworkSheet";
import { useNetwork } from "../lib/networkContext";
import { getNetworkEnv, NETWORK_TONE_CHIP } from "../lib/networkEnv";

export function NetworkPill() {
  const { network } = useNetwork();
  const env = getNetworkEnv(network);
  const [open, setOpen] = useState(false);

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.96 }}
        type="button"
        aria-label={`Network: ${env.name}. Switch network`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="home-network-pill"
        className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-accent/40 ${NETWORK_TONE_CHIP[env.tone]}`}
      >
        <NetworkMark network={network} size={18} className="flex-none" />
        <span className="max-w-[110px] truncate">{env.name}</span>
      </motion.button>

      <NetworkSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
