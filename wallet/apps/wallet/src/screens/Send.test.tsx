import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Send } from "./Send";
import { CONTACTS_LS_KEY } from "../lib/contacts";

const walletState = vi.hoisted(() => ({
  session: {
    profile: { handle: "tester", name: "Tester" },
    handle: "tester",
    kycTier: 1,
    live: true,
    mode: "live",
    missing: [],
    prover: { available: ["local"], mode: "local", location: "local" },
  },
  balance: { baseUnits: "1001000000", live: true },
  publicBalance: {
    baseUnits: "0",
    address: "0x2222222222222222222222222222222222222222",
    asset: "USDC",
    issuer: "",
    live: true,
  },
  history: [],
  contacts: [],
  loading: false,
  error: null,
  hidden: false,
  toggleHidden: vi.fn(),
  deviceVerified: false,
  refresh: vi.fn(async () => true),
  refreshBalance: vi.fn(async () => undefined),
}));

const streamMocks = vi.hoisted(() => ({
  run: vi.fn(),
  reset: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  isRegisteredOnEerc: vi.fn(),
}));

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/handleRegistry", () => ({
  isRegisteredOnEerc: registryMocks.isRegisteredOnEerc,
}));

vi.mock("../lib/lock", () => ({
  requireUnlock: vi.fn(async () => true),
  shouldLockOnSend: vi.fn(() => false),
}));

vi.mock("../lib/useSendStream", () => ({
  useSendStream: () => ({
    state: { phase: "idle" },
    receipt: null,
    run: streamMocks.run,
    reset: streamMocks.reset,
  }),
}));

function seedContacts() {
  localStorage.setItem(
    CONTACTS_LS_KEY,
    JSON.stringify([
      { handle: "@mansi", name: "Mansi", tone: "accent" },
      { handle: "@alex", name: "Alex Chen", tone: "amber" },
      { handle: "@sam", name: "Sam", tone: "neutral" },
      { handle: "@priya", name: "Priya", tone: "accent" },
    ]),
  );
}

describe("Send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    walletState.balance = { baseUnits: "1001000000", live: true };
    walletState.refresh.mockResolvedValue(true);
    walletState.refreshBalance.mockResolvedValue(undefined);
    registryMocks.isRegisteredOnEerc.mockResolvedValue(true);
    streamMocks.run.mockResolvedValue({
      status: "settled",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      prover: "local",
      amount: "2500000",
      onChain: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens and dismisses the compliance step-up sheet before balance checks", async () => {
    walletState.balance = { baseUnits: "0", live: true };

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1001" } });

    expect(screen.getByTestId("send-overcap-hint")).toHaveTextContent("Sends over $1,000");
    expect(screen.queryByTestId("send-low-private")).not.toBeInTheDocument();

    const submit = screen.getByTestId("send-submit");
    expect(submit).toBeEnabled();
    expect(submit).toHaveTextContent("Verify · $1,001.00");

    fireEvent.click(submit);
    expect(await screen.findByTestId("send-stepup")).toBeInTheDocument();
    expect(screen.getByText("Verify to send more")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stepup-later"));
    await waitFor(() => expect(screen.queryByTestId("send-stepup")).not.toBeInTheDocument());
  });

  it("sends a direct EVM address through the private send ceremony path", async () => {
    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByTestId("send-memo"), { target: { value: "rent" } });

    expect(screen.getByTestId("send-kind")).toHaveTextContent("Private send to this wallet address");
    fireEvent.click(screen.getByTestId("send-submit"));
    fireEvent.click(await screen.findByTestId("send-confirm"));

    await waitFor(() =>
      expect(streamMocks.run).toHaveBeenCalledWith(
        "0x1111111111111111111111111111111111111111",
        "2.5",
        "rent",
        "local",
        false,
        undefined,
      ),
    );
    expect(registryMocks.isRegisteredOnEerc).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111");
    await waitFor(() => expect(walletState.refresh).toHaveBeenCalled());
  });

  it("blocks a private send to an address that hasn't set up private payments", async () => {
    registryMocks.isRegisteredOnEerc.mockResolvedValue(false);

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByTestId("send-submit"));
    fireEvent.click(await screen.findByTestId("send-confirm"));

    expect(await screen.findByTestId("send-unregistered")).toBeInTheDocument();
    expect(screen.getByText("Not set up for private payments")).toBeInTheDocument();
    expect(streamMocks.run).not.toHaveBeenCalled();
  });

  it("rejects an invalid amount without starting a send", () => {
    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.0000001" } });

    expect(screen.getByTestId("send-amount-error")).toHaveTextContent("USDC has at most 6 decimals");
    expect(screen.getByTestId("send-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("send-submit"));

    expect(streamMocks.run).not.toHaveBeenCalled();
  });

  it("blocks private sends when the single balance is too low", () => {
    walletState.balance = { baseUnits: "1000000", live: true };

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2.5" } });

    expect(screen.getByTestId("send-low-private")).toHaveTextContent("Not enough private USDC");
    expect(screen.getByTestId("send-submit")).toBeDisabled();
    expect(streamMocks.run).not.toHaveBeenCalled();
  });

  it("shows only the top few saved contacts as quick chips", () => {
    seedContacts();

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    const chips = screen.getByTestId("send-quick-contacts");
    expect(within(chips).getAllByRole("button")).toHaveLength(3);
    expect(within(chips).getByText("@mansi")).toBeInTheDocument();
    expect(within(chips).queryByText("@priya")).not.toBeInTheDocument();
  });

  it("filters saved contacts into a dropdown and selecting one fills the recipient", () => {
    seedContacts();

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    const input = screen.getByTestId("send-handle");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pri" } });

    const dropdown = screen.getByTestId("send-contact-dropdown");
    expect(within(dropdown).getByText("Priya")).toBeInTheDocument();
    expect(within(dropdown).queryByText("Mansi")).not.toBeInTheDocument();

    fireEvent.click(within(dropdown).getByTestId("send-contact-option"));

    // The `@` adornment shows the handle is understood, and it classifies private.
    expect(screen.getByTestId("send-handle-at")).toBeInTheDocument();
    expect(screen.getByTestId("send-kind")).toHaveTextContent("Send privately");
    expect(screen.queryByTestId("send-contact-dropdown")).not.toBeInTheDocument();
  });

  it("treats a typed bare word as an @handle (adornment + private classification)", () => {
    seedContacts();

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Send />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("send-handle"), { target: { value: "mansi" } });

    expect(screen.getByTestId("send-handle-at")).toBeInTheDocument();
    expect(screen.getByTestId("send-kind")).toHaveTextContent("Send privately");
  });
});
