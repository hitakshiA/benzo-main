import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ShareProof } from "./ShareProof";

vi.mock("../lib/proverPolicy", () => ({
  proverPlan: () => ({ onDevice: true, reason: "This proof is generated on your device." }),
}));

const proveMock = vi.hoisted(() => vi.fn(async () => ({ onChain: true })));
vi.mock("../lib/benzoClient", () => ({
  proveBalanceClientSide: proveMock,
}));

// Pin the network env to Fuji so the testnet asset label / warning path (env.isTestnet,
// env.asset) is deterministically exercised instead of leaning on ambient default state.
vi.mock("../lib/networkEnv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/networkEnv")>();
  return { ...actual, useNetworkEnv: () => actual.getNetworkEnv("fuji") };
});

function renderProof() {
  render(
    <MemoryRouter>
      <ShareProof />
    </MemoryRouter>,
  );
}

describe("Create proof of funds", () => {
  it("is a dedicated flow with a live pre-create disclosure preview", () => {
    renderProof();
    expect(screen.getByRole("heading", { name: "Create proof of funds" })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("proof-recipient"), { target: { value: "Grant Thornton" } });

    const disclosure = screen.getByTestId("proof-disclosure-text");
    expect(disclosure).toHaveTextContent("Grant Thornton");
    expect(disclosure).toHaveTextContent(/at least/i);
    expect(disclosure).toHaveTextContent("5,000.00 USDC");
    expect(disclosure).toHaveTextContent(/not.*see your exact balance/i);
  });

  it("reflects expiry + re-share choices in the disclosure", () => {
    renderProof();
    fireEvent.click(screen.getByTestId("proof-expiry-30d"));
    fireEvent.click(screen.getByTestId("proof-reshare-toggle"));
    expect(screen.getByTestId("proof-disclosure")).toHaveTextContent(/can be re-shared/i);
    expect(screen.getByTestId("proof-disclosure")).toHaveTextContent(/expires in 30 days/i);
  });

  it("creates the proof on device and confirms the threshold", async () => {
    renderProof();
    fireEvent.click(screen.getByTestId("proof-generate"));
    expect(proveMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("proof-success")).toBeInTheDocument());
    expect(screen.getByTestId("proof-success")).toHaveTextContent("at least 5,000.00 USDC");
  });
});
