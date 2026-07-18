import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BalanceHero } from "./money";
import { OnChainDetails } from "./OnChainDetails";
import { PrivateChip, ProvableChip } from "./privacy";
import { Button, Card } from "./primitives";
import { ActivityItem } from "./ActivityItem";
import type { ActivityRow } from "../lib/api";

describe("BalanceHero", () => {
  it("renders the formatted balance (accessible label)", () => {
    render(<BalanceHero baseUnits="1240500000" hidden={false} />);
    expect(screen.getByLabelText("$1,240.50")).toBeInTheDocument();
  });
  it("masks the balance when hidden", () => {
    render(<BalanceHero baseUnits="1240500000" hidden />);
    expect(screen.getByLabelText("Balance hidden")).toBeInTheDocument();
    expect(screen.queryByLabelText("$1,240.50")).not.toBeInTheDocument();
  });
  it("shows a skeleton while loading", () => {
    render(<BalanceHero baseUnits="0" hidden={false} loading />);
    expect(screen.getByLabelText("Loading balance")).toBeInTheDocument();
  });
});

describe("privacy chrome", () => {
  it("PrivateChip is ambient (default copy)", () => {
    render(<PrivateChip />);
    expect(screen.getByText(/private on-chain/i)).toBeInTheDocument();
  });
  it("ProvableChip surfaces the proof badge", () => {
    render(<ProvableChip />);
    expect(screen.getByText("Provable")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("fires onClick and renders children", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByText("Send"));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("is disabled while loading", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText("Go"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Card", () => {
  it("stays a plain non-interactive div without onClick", () => {
    render(<Card>hello</Card>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("is a focusable, keyboard-operable button when clickable", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>tap</Card>);
    const card = screen.getByRole("button");
    expect(card).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(card, { key: "Enter" }); // Enter activates on keydown
    fireEvent.keyDown(card, { key: " " }); // Space on keydown only prevents scroll…
    fireEvent.keyUp(card, { key: " " }); // …and activates on keyup (native button)
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(3);
  });
});

describe("ActivityItem", () => {
  const base: ActivityRow = {
    id: "a1", type: "receive", name: "Ravi Mehta", note: "Paid you · Design work",
    amount: "200000000", direction: "in", status: "settled", timestamp: Math.floor(Date.now() / 1000) - 60,
  };
  it("renders a person row with a positive amount", () => {
    render(<MemoryRouter><ActivityItem row={base} /></MemoryRouter>);
    expect(screen.getByText("Ravi Mehta")).toBeInTheDocument();
    expect(screen.getByText("+$200.00")).toBeInTheDocument();
  });
  it("shows an in-flight status pill for transfer-out rows", () => {
    render(<MemoryRouter><ActivityItem row={{ ...base, type: "unshield", name: "Transfer out", direction: "out", status: "arriving" }} /></MemoryRouter>);
    expect(screen.getByText(/Arriving/)).toBeInTheDocument();
    expect(screen.getByText("−$200.00")).toBeInTheDocument();
  });
  it("redacts row amounts when balances are hidden", () => {
    render(<MemoryRouter><ActivityItem row={base} hidden /></MemoryRouter>);
    expect(screen.getByLabelText("Amount hidden")).toBeInTheDocument();
    expect(screen.queryByText("+$200.00")).not.toBeInTheDocument();
  });
  it("shows failed outgoing attempts without a debit sign", () => {
    render(<MemoryRouter><ActivityItem row={{ ...base, type: "send", name: "Alex", direction: "out", status: "failed" }} /></MemoryRouter>);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("$200.00")).toBeInTheDocument();
    expect(screen.queryByText("−$200.00")).not.toBeInTheDocument();
  });
});

describe("OnChainDetails", () => {
  const txHash = "928c3535ab8833e4c59514b4628c1d580c59aea0cf7595f347824c249b5db61d";

  it("labels public wallet sends as public Avalanche settlement, not ZK proof", () => {
    render(<OnChainDetails txHash={txHash} onChain kind="public" />);

    fireEvent.click(screen.getByTestId("onchain-toggle"));

    expect(screen.getByText("Public Avalanche USDC payment")).toBeInTheDocument();
    expect(screen.getByText("recipient and amount are visible on-chain")).toBeInTheDocument();
    expect(screen.getByText(/normal public USDC payment/i)).toBeInTheDocument();
    expect(screen.queryByText(/Groth16/i)).not.toBeInTheDocument();
    expect(screen.queryByText("eERC contract")).not.toBeInTheDocument();
    expect(screen.queryByText("Registrar")).not.toBeInTheDocument();
    expect(screen.queryByText(/zero-knowledge guarantee/i)).not.toBeInTheDocument();
  });

  it("labels shield as a converter deposit with a public edge amount", () => {
    render(<OnChainDetails txHash={txHash} onChain kind="shield" prover="local" provingMs={10120} />);

    fireEvent.click(screen.getByTestId("onchain-toggle"));

    expect(screen.getByText("eERC DEPOSIT")).toBeInTheDocument();
    expect(screen.getByText("the deposit amount at the public edge")).toBeInTheDocument();
    expect(screen.getByText("eERC contract")).toBeInTheDocument();
    expect(screen.getByText("Registrar")).toBeInTheDocument();
    expect(screen.getByText(/Converter deposits are public at the edge/i)).toBeInTheDocument();
    expect(screen.getByText("Local wallet · 10.12s")).toBeInTheDocument();
    expect(screen.queryByText(/Groth16 \/ BN254 · eERC DEPOSIT/i)).not.toBeInTheDocument();
  });

  it("keeps ZK proof details for unshield withdraws", () => {
    render(<OnChainDetails txHash={txHash} onChain kind="unshield" prover="local" provingMs={8120} />);

    fireEvent.click(screen.getByTestId("onchain-toggle"));

    expect(screen.getByText("Groth16 / BN254 · eERC WITHDRAW")).toBeInTheDocument();
    expect(screen.getByText("you own enough encrypted balance to make this amount public")).toBeInTheDocument();
    expect(screen.getByText("Local prover · 8.12s")).toBeInTheDocument();
  });
});
