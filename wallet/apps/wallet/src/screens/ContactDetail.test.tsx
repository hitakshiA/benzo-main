import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactDetail } from "./ContactDetail";

const CONTACTS_LS_KEY = "benzo.contacts.local.v1";

const walletState = vi.hoisted(() => {
  const now = Math.floor(Date.now() / 1000);
  return {
    contacts: [] as unknown[],
    history: [
      { id: "h1", type: "receive", name: "Mansi", note: "Dinner split", amount: "120000000", direction: "in", status: "settled", timestamp: now - 100 },
      { id: "h2", type: "send", name: "Alex Chen", note: "Concert tickets", amount: "45000000", direction: "out", status: "settled", timestamp: now - 200 },
    ],
    hidden: false,
  };
});

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

function renderDetail(handle: string) {
  return render(
    <MemoryRouter initialEntries={[`/contacts/${encodeURIComponent(handle)}`]}>
      <Routes>
        <Route path="/contacts/:handle" element={<ContactDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ContactDetail", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      CONTACTS_LS_KEY,
      JSON.stringify([{ handle: "@mansi", name: "Mansi", tone: "accent" }]),
    );
  });
  afterEach(() => localStorage.clear());

  it("shows the contact and only the payment history with them", () => {
    renderDetail("@mansi");

    expect(screen.getAllByText("Mansi").length).toBeGreaterThan(0);
    const history = screen.getByTestId("contact-detail-history");
    expect(within(history).getByText("Dinner split")).toBeInTheDocument();
    expect(within(history).queryByText("Concert tickets")).not.toBeInTheDocument();
  });

  it("edits and persists the contact name", () => {
    renderDetail("@mansi");

    // View-first: reveal the fields via the Edit affordance before editing.
    fireEvent.click(screen.getByTestId("contact-detail-edit-toggle"));
    const save = screen.getByTestId("contact-detail-save");
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByTestId("contact-detail-name"), { target: { value: "Mansi Q" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    const stored = JSON.parse(localStorage.getItem(CONTACTS_LS_KEY) ?? "[]");
    expect(stored).toEqual([{ handle: "@mansi", name: "Mansi Q" }]);
    expect(screen.getAllByText("Mansi Q").length).toBeGreaterThan(0);
  });

  it("removes the contact from local storage after confirming", () => {
    renderDetail("@mansi");

    // Remove is a red, confirmed action now, the first tap only reveals the confirm.
    fireEvent.click(screen.getByTestId("contact-detail-remove"));
    expect(JSON.parse(localStorage.getItem(CONTACTS_LS_KEY) ?? "[]")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("contact-detail-remove-confirm-yes"));

    expect(JSON.parse(localStorage.getItem(CONTACTS_LS_KEY) ?? "[]")).toEqual([]);
  });

  it("handles an unknown contact gracefully", () => {
    renderDetail("@nobody");

    expect(screen.getByTestId("contact-detail-missing")).toBeInTheDocument();
  });
});
