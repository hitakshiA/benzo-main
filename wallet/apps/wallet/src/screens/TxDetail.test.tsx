import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "../lib/api";
import { TxDetail } from "./TxDetail";

const state = vi.hoisted(() => ({
  history: [] as ActivityRow[],
  hidden: false,
}));

vi.mock("../lib/store", () => ({
  useWallet: () => state,
}));

function renderDetail(row: ActivityRow) {
  state.history = [row];
  render(
    <MemoryRouter initialEntries={[`/activity/${row.id}`]}>
      <Routes>
        <Route path="/activity/:id" element={<TxDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TxDetail", () => {
  it("gives a verified private receive a specific title, status, and shareable receipt", () => {
    renderDetail({
      id: "h_1_tx",
      type: "receive",
      name: "Mansi",
      note: "Paid you",
      amount: "120000000",
      direction: "in",
      status: "settled",
      timestamp: 1782370212,
      txHash: "2261cc8862eba610a24b293f113864a297f5008885dfdcbc1c3f01c497955417",
      tone: "accent",
    });

    // Specific title, not "Details".
    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-status")).toHaveTextContent("Settled");
    expect(within(screen.getByTestId("txdetail-amount")).getByText("+120.00 USDC")).toBeInTheDocument();
    expect(screen.getByText("from")).toBeInTheDocument();
    // Copyable reference + a proof status.
    expect(screen.getByTestId("txdetail-reference")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-explorer")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-share")).toBeInTheDocument();
  });

  it("describes an outgoing private send without leaking a public label", () => {
    renderDetail({
      id: "h_send",
      type: "send",
      name: "Alex",
      note: "Dinner",
      amount: "5000000",
      direction: "out",
      status: "settled",
      timestamp: 1782926977,
      txHash: "fd9117d121b3d574b0f0899d25779f0784bb0743815089771e560c93f0736fae",
      tone: "neutral",
    });

    expect(screen.getByText("Payment sent")).toBeInTheDocument();
    // "Alex" appears in the counterparty line and the metadata "To" row.
    expect(screen.getAllByText("Alex").length).toBeGreaterThan(0);
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(within(screen.getByTestId("txdetail-amount")).getByText("−5.00 USDC")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-share")).toBeInTheDocument();
    expect(screen.queryByText(/public avalanche|made public|testnet reserve/i)).not.toBeInTheDocument();
  });

  it("does not present a failed private send as a debited or shareable transfer", () => {
    renderDetail({
      id: "h_failed_private",
      type: "send",
      name: "You sent",
      note: "Sent privately · Couldn't send right now. Your money is safe. Please try again.",
      amount: "5000000",
      direction: "out",
      status: "failed",
      timestamp: 1782926977,
      tone: "neutral",
    });

    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(within(screen.getByTestId("txdetail-amount")).getByText("5.00 USDC")).toBeInTheDocument();
    expect(screen.queryByText("−5.00 USDC")).not.toBeInTheDocument();
    expect(screen.getByText("attempted to")).toBeInTheDocument();
    expect(screen.getByTestId("txdetail-failed-note")).toBeInTheDocument();
    expect(screen.getByText("No on-chain transfer recorded")).toBeInTheDocument();
    expect(screen.queryByTestId("txdetail-share")).not.toBeInTheDocument();
    expect(screen.queryByTestId("txdetail-explorer")).not.toBeInTheDocument();
  });

  it("treats a legacy nonfailed row with failure copy and no tx as failed", () => {
    renderDetail({
      id: "h_legacy_failed_private",
      type: "send",
      name: "You sent",
      note: "Sent privately · Couldn't send right now. Your money is safe. Please try again.",
      amount: "5000000",
      direction: "out",
      status: "proving",
      timestamp: 1782926977,
      tone: "neutral",
    });

    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(within(screen.getByTestId("txdetail-amount")).getByText("5.00 USDC")).toBeInTheDocument();
    expect(screen.queryByText("−5.00 USDC")).not.toBeInTheDocument();
    expect(screen.getByTestId("txdetail-failed-note")).toBeInTheDocument();
    expect(screen.getByText("No on-chain transfer recorded")).toBeInTheDocument();
  });
});
