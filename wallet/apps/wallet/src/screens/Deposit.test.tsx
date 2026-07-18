import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Deposit } from "./Deposit";
import * as net from "../lib/network";

const ADDRESS = "0x27f3a1b2c3d4e5f60718293a4b5c6d7e8f90285Be";

vi.mock("../lib/localWallet", () => ({
  getLocalAccountSummary: vi.fn(() => ({ address: ADDRESS, spendPub: "1", mvkPub: "aa" })),
}));

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../lib/store", () => ({
  useWallet: () => ({ session: { live: true } }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderDeposit() {
  return render(
    <MemoryRouter initialEntries={["/deposit"]}>
      <Deposit />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("Deposit / Receive", () => {
  let original: ReturnType<typeof net.getActiveNetwork>;
  beforeEach(() => {
    original = net.getActiveNetwork();
    net.setActiveNetwork("fuji");
  });
  afterEach(() => net.setActiveNetwork(original));

  it("is a top-level tab with no back button and a testnet warning", () => {
    renderDeposit();
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    expect(screen.getByTestId("receive-warning")).toHaveTextContent(/Testnet only/i);
    expect(screen.getByTestId("receive-subtitle")).toHaveTextContent(/Test USDC/);
  });

  it("shows a shortened address and reveals the full one on tap", () => {
    renderDeposit();
    const btn = screen.getByTestId("deposit-address");
    expect(btn).toHaveTextContent("…");
    expect(btn).not.toHaveTextContent(ADDRESS);
    fireEvent.click(btn);
    expect(screen.getByTestId("deposit-address")).toHaveTextContent(ADDRESS);
  });

  it("states the honest deposit-privacy behaviour, not an auto-private promise", () => {
    renderDeposit();
    expect(screen.getByTestId("receive-privacy")).toHaveTextContent(/arrives\s+public/i);
    expect(screen.queryByText("Received balance stays private")).not.toBeInTheDocument();
  });

  it("offers a make-private action from Receive", () => {
    renderDeposit();
    const makePrivate = screen.getByTestId("deposit-make-private");
    expect(makePrivate).toHaveTextContent("Make private");
    fireEvent.click(makePrivate);
    expect(screen.getByTestId("location")).toHaveTextContent("/shield?mode=shield");
  });
});
