import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Claim } from "./Claim";

const walletState = vi.hoisted(() => ({
  refresh: vi.fn(async () => true),
  session: { profile: { handle: "tester", name: "Tester" }, handle: "tester" },
}));

const giftClaimStatusClientSide = vi.hoisted(() => vi.fn());
const claimLinkClientSide = vi.hoisted(() => vi.fn());

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/benzoClient", () => ({
  giftClaimStatusClientSide,
  claimLinkClientSide,
}));

// A well-formed on-chain gift claim secret (giftId + 64-hex ephemeral key).
const GIFT_SECRET = `g5.${"a".repeat(64)}`;

function claimRoute(link: string): string {
  return `/claim#${encodeURIComponent(link)}`;
}

describe("Claim", () => {
  beforeEach(() => {
    giftClaimStatusClientSide.mockReset();
    claimLinkClientSide.mockReset();
  });

  it("blocks expired claim links before attempting settlement", async () => {
    const expired = "benzo://claim?amount=10000000&app=consumer&exp=1#secret_expired";

    render(
      <MemoryRouter initialEntries={[claimRoute(expired)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-unavailable")).toHaveTextContent("This link expired");
    expect(screen.getByText("No money moved. Ask the sender to send a fresh link.")).toBeInTheDocument();
    expect(giftClaimStatusClientSide).not.toHaveBeenCalled();
    expect(claimLinkClientSide).not.toHaveBeenCalled();
  });

  it("rejects legacy backend claim tokens instead of calling claim redemption", async () => {
    const legacy = "benzo://claim?amount=10000000&app=consumer&exp=4000000000#secret_used";

    render(
      <MemoryRouter initialEntries={[claimRoute(legacy)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-unavailable")).toHaveTextContent("This claim link is no longer supported");
    expect(screen.getByText("Ask the sender to share a new Benzo gift link.")).toBeInTheDocument();
    expect(giftClaimStatusClientSide).not.toHaveBeenCalled();
    expect(claimLinkClientSide).not.toHaveBeenCalled();
  });

  it("checks an on-chain gift against the escrow", async () => {
    giftClaimStatusClientSide.mockResolvedValue({ status: "open", amount: "10000000", expiresAt: 4_000_000_000 });
    const gift = `benzo://claim?amount=10000000&app=consumer&exp=4000000000#${GIFT_SECRET}`;

    render(
      <MemoryRouter initialEntries={[claimRoute(gift)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-accept")).toBeInTheDocument();
    expect(giftClaimStatusClientSide).toHaveBeenCalledWith(GIFT_SECRET);
  });

  it("shows an already-claimed on-chain gift as unavailable from the escrow read", async () => {
    giftClaimStatusClientSide.mockResolvedValue({ status: "claimed", amount: "10000000", expiresAt: 4_000_000_000 });
    const gift = `benzo://claim?amount=10000000&app=consumer&exp=4000000000#${GIFT_SECRET}`;

    render(
      <MemoryRouter initialEntries={[claimRoute(gift)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-unavailable")).toHaveTextContent("This link was already claimed");
    expect(giftClaimStatusClientSide).toHaveBeenCalledWith(GIFT_SECRET);
    expect(claimLinkClientSide).not.toHaveBeenCalled();
  });
});

describe("Claim from a shared invite URL", () => {
  it("reads the link from the address bar at /l/claim", async () => {
    // Shared invites land on /l/claim with the secret in the fragment. The
    // fragment alone is not a parseable link, so the screen has to use the full
    // URL or every invite reads as broken.
    const url =
      "https://wallet.benzo.space/l/claim?amount=50000&asset=USDC&app=consumer#g5.deadbeef";
    window.history.pushState({}, "", "/l/claim?amount=50000&asset=USDC&app=consumer#g5.deadbeef");
    const spy = vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: url,
    } as Location);

    render(
      <MemoryRouter initialEntries={["/l/claim?amount=50000&asset=USDC&app=consumer#g5.deadbeef"]}>
        <Claim />
      </MemoryRouter>,
    );

    // A broken link renders the error state; a readable one does not.
    await waitFor(() => {
      expect(screen.queryByTestId("claim-error")).toBeNull();
    });
    spy.mockRestore();
  });
});
