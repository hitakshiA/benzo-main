/**
 * NetworkSheet, the network switcher as a bottom sheet (critique #55). Replaces
 * the cramped globe popover: each network shows a plain-English RISK label
 * (Test funds only / Permissioned network / Real assets), a checkmark on the
 * active one, and a note that balances + activity differ per network. Switching to
 * mainnet is gated behind an explicit "real assets" confirmation, and any network
 * that isn't deployed on this build is disabled with a "Coming soon" badge.
 *
 * Reusable: the header pill (ui/NetworkPill) and Profile's compact network row can
 * both drive it, `<NetworkSheet open onClose />`.
 */
import { useCallback, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { DeploymentNetwork } from "@benzo/config";
import { useNetwork } from "../lib/networkContext";
import { getNetworkEnv, NETWORK_TONE_CHIP, NETWORK_TONE_DOT } from "../lib/networkEnv";
import { resolveNetworkConfig } from "../lib/network";
import { NetworkMark } from "./Logo";
import { Button, Sheet } from "./primitives";

interface NetMeta {
  /** Trust name for the sheet row (spelled out mainnet, unlike the compact pill). */
  name: string;
  /** Plain-English risk label. */
  risk: string;
  /** Real-assets networks require an explicit confirmation before switching. */
  requiresConfirm?: boolean;
}

const META: Record<DeploymentNetwork, NetMeta> = {
  fuji: { name: "Fuji Testnet", risk: "Test funds only" },
  benzonet: { name: "BenzoNet", risk: "Permissioned network" },
  avalanche: { name: "Avalanche Mainnet", risk: "Real assets", requiresConfirm: true },
};

/** A network is selectable only if it actually has an eERC deployment on this build. */
function isReady(network: DeploymentNetwork): boolean {
  try {
    return Boolean(resolveNetworkConfig(network).encryptedErc);
  } catch {
    return false;
  }
}

export function NetworkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { network, setNetwork, options } = useNetwork();
  const [confirm, setConfirm] = useState<DeploymentNetwork | null>(null);

  // Stable across renders so Sheet's Escape-key effect (keyed on onClose) doesn't
  // tear down and re-bind its listener on every render.
  const close = useCallback(() => {
    setConfirm(null);
    onClose();
  }, [onClose]);

  function choose(next: DeploymentNetwork) {
    if (next === network) {
      close();
      return;
    }
    if (META[next].requiresConfirm) {
      setConfirm(next);
      return;
    }
    setNetwork(next);
    close();
  }

  function confirmSwitch() {
    if (confirm) setNetwork(confirm);
    close();
  }

  return (
    <Sheet open={open} onClose={close} title="Select network">
      {confirm ? (
        <div data-testid="network-sheet-confirm">
          <div className="flex items-start gap-3 rounded-2xl bg-danger/10 p-4">
            <AlertTriangle size={20} className="mt-0.5 flex-none text-danger" />
            <div>
              <div className="text-[15px] font-semibold text-ink">Switch to {META[confirm].name}?</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Mainnet uses <span className="font-semibold text-ink">real assets</span>. Payments are final and cost real
                network fees. Only continue if you mean to move real money.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            <Button variant="danger" full onClick={confirmSwitch} data-testid="network-sheet-confirm-yes">
              Use real assets
            </Button>
            <Button variant="ghost" full onClick={() => setConfirm(null)} data-testid="network-sheet-confirm-cancel">
              Stay on {getNetworkEnv(network).name}
            </Button>
          </div>
        </div>
      ) : (
        <div data-testid="network-sheet">
          <div className="space-y-2" role="group" aria-label="Networks">
            {options.map((opt) => {
              const n = opt.network;
              const meta = META[n];
              const env = getNetworkEnv(n);
              const on = n === network;
              const ready = isReady(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  disabled={!ready}
                  onClick={() => choose(n)}
                  data-testid={`network-sheet-${n}`}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-55 ${
                    on ? "border-accent bg-accent/[0.06]" : "border-hair bg-card hover:bg-canvas"
                  }`}
                >
                  <NetworkMark network={n} size={34} className="flex-none" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-ink">{meta.name}</div>
                    <span className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${NETWORK_TONE_CHIP[env.tone]}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${NETWORK_TONE_DOT[env.tone]}`} />
                      {meta.risk}
                    </span>
                  </div>
                  {on ? (
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent text-white" data-testid={`network-sheet-${n}-check`}>
                      <Check size={14} />
                    </span>
                  ) : !ready ? (
                    <span className="flex-none rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-semibold text-muted">Coming soon</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-center text-[12px] text-muted" data-testid="network-sheet-note">
            Balances and activity differ per network.
          </p>
        </div>
      )}
    </Sheet>
  );
}
