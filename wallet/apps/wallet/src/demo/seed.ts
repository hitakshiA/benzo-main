/**
 * Seed data for DEMO MODE, the fake-but-realistic state the wallet boots into:
 * a private + public balance, a handful of contacts, and a mixed activity feed.
 * All amounts are USDC base units (6 decimals). Nothing here is fetched.
 */
import type { ActivityRow, Contact, Session } from "../lib/api";
import { getDemoAccountSummary, DEMO_DISPLAY_NAME, DEMO_HANDLE } from "./account";

// ~$4,820.50 shielded, ~$180.00 public.
export const DEMO_PRIVATE_BASE_UNITS = "4820500000";
export const DEMO_PUBLIC_BASE_UNITS = "180000000";

// A raw 0x address deliberately left "not set up" for private payments, so the
// recipient-registration pre-check state (Send → "Not set up") is demoable.
export const DEMO_UNREGISTERED_ADDRESS = "0x7Fc9E2b1A0d4C3b5E6f80912a3B4C5D6e7F80912";

export const DEMO_SESSION: Session = {
  profile: { handle: DEMO_HANDLE, name: DEMO_DISPLAY_NAME },
  handle: DEMO_HANDLE,
  live: true,
  mode: "live",
  missing: [],
  prover: { available: ["local"], mode: "local", location: "local" },
};

// Contacts live in localStorage (lib/contacts) so the Send chips, the Contacts
// screen, and the store all read one source. The unregistered wallet is seeded
// as a contact too, so it can be tapped to demo the "not set up" flow.
export const DEMO_CONTACTS: Contact[] = [
  { handle: "@mansi", name: "Mansi", tone: "accent" },
  { handle: "@alex", name: "Alex Chen", tone: "amber" },
  { handle: "@sam", name: "Sam", tone: "neutral" },
  { handle: "@priya", name: "Priya", tone: "accent" },
  { handle: "@dev", name: "Dev Patel", tone: "amber" },
  { handle: DEMO_UNREGISTERED_ADDRESS, name: "Unregistered wallet", tone: "neutral" },
];

const CONTACTS_LS_KEY = "benzo.contacts.local.v1";

/** Idempotently write the demo contacts into the same store lib/contacts reads. */
export function seedContactsIntoLocalStorage(): void {
  try {
    localStorage.setItem(CONTACTS_LS_KEY, JSON.stringify(DEMO_CONTACTS));
  } catch {
    /* storage unavailable, Send falls back to no chips */
  }
}

const HOUR = 3600;
const DAY = 86_400;

interface SeedRow {
  ago: number; // seconds before now
  type: string;
  name: string;
  note: string;
  amount: string;
  direction: "in" | "out";
  status: ActivityRow["status"];
  tone?: ActivityRow["tone"];
}

// Newest first. Mixed sent / received / gift / add-cash / cash-out.
const SEED_ROWS: SeedRow[] = [
  { ago: 2 * HOUR, type: "receive", name: "Mansi", note: "Dinner split", amount: "120000000", direction: "in", status: "settled", tone: "accent" },
  { ago: 5 * HOUR, type: "send", name: "Alex Chen", note: "Concert tickets", amount: "45000000", direction: "out", status: "settled", tone: "amber" },
  { ago: 20 * HOUR, type: "gift", name: "Priya", note: "🎁 Happy birthday!", amount: "25000000", direction: "in", status: "settled", tone: "accent" },
  { ago: 1 * DAY + 3 * HOUR, type: "send", name: "Sam", note: "Coffee ☕", amount: "18500000", direction: "out", status: "settled", tone: "neutral" },
  { ago: 2 * DAY, type: "receive", name: "Dev Patel", note: "Design work", amount: "300000000", direction: "in", status: "settled", tone: "amber" },
  { ago: 2 * DAY + 6 * HOUR, type: "gift", name: "Mansi", note: "🎁 Congrats on the new place!", amount: "50000000", direction: "out", status: "settled", tone: "accent" },
  { ago: 3 * DAY, type: "shield", name: "Added cash", note: "From linked bank", amount: "200000000", direction: "in", status: "settled" },
  { ago: 4 * DAY, type: "send", name: "Alex Chen", note: "Rent share", amount: "60000000", direction: "out", status: "settled", tone: "amber" },
  { ago: 5 * DAY, type: "receive", name: "Sam", note: "Lunch", amount: "15000000", direction: "in", status: "settled", tone: "neutral" },
  { ago: 6 * DAY, type: "send", name: "Freelance client", note: "Invoice #204 payout", amount: "75000000", direction: "out", status: "settled", tone: "neutral" },
  { ago: 8 * DAY, type: "unshield", name: "Cash out", note: "To bank account", amount: "100000000", direction: "out", status: "settled" },
  { ago: 10 * DAY, type: "receive", name: "Priya", note: "Groceries", amount: "40000000", direction: "in", status: "settled", tone: "accent" },
];

/** Build the seeded activity feed with timestamps relative to now. */
export function buildSeedHistory(): ActivityRow[] {
  const now = Math.floor(Date.now() / 1000);
  return SEED_ROWS.map((r, i) => ({
    id: `demo-${i}-${now - r.ago}`,
    type: r.type,
    name: r.name,
    note: r.note,
    amount: r.amount,
    direction: r.direction,
    status: r.status,
    timestamp: now - r.ago,
    txHash: `0x${(i + 1).toString(16).padStart(2, "0").repeat(32)}`,
    tone: r.tone,
  }));
}
