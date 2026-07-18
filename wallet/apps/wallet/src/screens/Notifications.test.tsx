import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "../lib/api";
import { Notifications } from "./Notifications";

const state = vi.hoisted(() => ({
  history: [] as ActivityRow[],
  session: { live: true } as { live: boolean } | null,
  loading: false,
}));
vi.mock("../lib/store", () => ({ useWallet: () => state }));

function renderNotifications() {
  render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>,
  );
}

describe("Notifications states", () => {
  it("shows loading skeletons instead of 'all caught up' while history loads", () => {
    state.history = [];
    state.loading = true;
    renderNotifications();
    expect(screen.getByTestId("notifs-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("notifs-empty")).not.toBeInTheDocument();
  });

  it("shows the empty state once loaded with no history", () => {
    state.history = [];
    state.loading = false;
    renderNotifications();
    expect(screen.getByTestId("notifs-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("notifs-loading")).not.toBeInTheDocument();
  });
});
