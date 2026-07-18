import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentState } from "@benzo/ui/payment-state";
import { SendCeremony, type SendReceipt } from "./SendCeremony";

const receipt: SendReceipt = {
  amount: "2500000",
  recipient: "@mara",
  onChain: true,
  prover: "local",
  txHash: "0xabc",
  provingMs: 3200,
};

function renderCeremony(state: PaymentState) {
  return render(<SendCeremony state={state} receipt={receipt} onDone={vi.fn()} onRetry={vi.fn()} />);
}

describe("SendCeremony, centered 3D coin ceremony", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("materializes the working coin while proving (encrypt phase)", () => {
    renderCeremony({ phase: "proving" });
    expect(screen.getByTestId("ceremony-coin")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Preparing your private payment");
    expect(screen.queryByTestId("ceremony-receipt")).not.toBeInTheDocument();
  });

  it("honors the settle floor so an instant confirm never flashes past the working coin", () => {
    const { rerender } = renderCeremony({ phase: "submitting", txHash: "0xabc" });
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Waiting for confirmation");

    // The real machine races submitting -> confirmed almost instantly.
    rerender(<SendCeremony state={{ phase: "confirmed" }} receipt={receipt} onDone={vi.fn()} onRetry={vi.fn()} />);

    // Still settling: the coin is still working and the receipt is withheld until the floor elapses.
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Waiting for confirmation");
    expect(screen.queryByTestId("ceremony-receipt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("receipt-details-toggle")).not.toBeInTheDocument();

    // Once the settle floor (800ms) is honored, it lands on the verified receipt.
    act(() => {
      vi.advanceTimersByTime(SETTLE_FLOOR_MS + 50);
    });
    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Payment complete");
    expect(screen.getByTestId("ceremony-receipt")).toBeInTheDocument();
    expect(screen.getByTestId("ceremony-done")).toBeInTheDocument();
  });

  it("drops to a clear retry state on failure without the coin", () => {
    renderCeremony({ phase: "failed", error: "ledger rejected" });
    expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("ledger rejected");
    expect(screen.getByTestId("ceremony-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("ceremony-coin")).not.toBeInTheDocument();
  });

  it("uses shield-specific settle copy", () => {
    render(<SendCeremony state={{ phase: "submitting", txHash: "0xabc" }} receipt={{ ...receipt, kind: "shield" }} onDone={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByTestId("ceremony-title")).toHaveTextContent("Finalizing private balance");
    expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("confirming your shield");
  });

  it("does not call an unverified shield receipt private on-chain", () => {
    render(<SendCeremony state={{ phase: "confirmed" }} receipt={{ ...receipt, kind: "shield", onChain: false }} onDone={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByTestId("ceremony-receipt")).toHaveTextContent("Private balance update not verified on-chain");
    expect(screen.getByTestId("ceremony-receipt")).not.toHaveTextContent("Private on-chain");
  });
});

const SETTLE_FLOOR_MS = 800;
