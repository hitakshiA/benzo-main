import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "../lib/api";
import { Activity } from "./Activity";

const now = Math.floor(Date.now() / 1000);
const rows: ActivityRow[] = [
  { id: "r1", type: "receive", name: "Mansi", note: "Paid you", amount: "1000000", direction: "in", status: "settled", timestamp: now - 120 },
  { id: "r2", type: "send", name: "Alex", note: "Dinner", amount: "5000000", direction: "out", status: "settled", timestamp: now - 240 },
  { id: "r3", type: "shield", name: "Made private", note: "Deposit", amount: "9000000", direction: "in", status: "settled", timestamp: now - 360 },
];

const state = vi.hoisted(() => ({ history: [] as ActivityRow[], loading: false, hidden: false }));
vi.mock("../lib/store", () => ({ useWallet: () => state }));

function renderActivity() {
  state.history = rows;
  render(
    <MemoryRouter>
      <Activity />
    </MemoryRouter>,
  );
}

describe("Activity filters", () => {
  it("shows all rows by default and no back button", () => {
    renderActivity();
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    expect(screen.getByText("Mansi")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Made private")).toBeInTheDocument();
  });

  it("filters to Sent, Received, and Deposits", () => {
    renderActivity();

    fireEvent.click(screen.getByTestId("activity-filter-sent"));
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.queryByText("Mansi")).not.toBeInTheDocument();
    expect(screen.queryByText("Made private")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("activity-filter-received"));
    expect(screen.getByText("Mansi")).toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.queryByText("Made private")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("activity-filter-deposit"));
    expect(screen.getByText("Made private")).toBeInTheDocument();
    expect(screen.queryByText("Mansi")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });

  it("searches by name or note", () => {
    renderActivity();
    fireEvent.change(screen.getByTestId("activity-search"), { target: { value: "din" } });
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.queryByText("Mansi")).not.toBeInTheDocument();
  });
});
