import { createSiweMessage } from "viem/siwe";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { CHAIN_ID } from "./network";
import { handleAvailableOnChain, normalizeHandle } from "./handleRegistry";

export type ProverKind = "local";

export interface Session {
  profile: { handle: string; name: string };
  handle?: string;
  kycTier?: number;
  live: boolean;
  mode: "live" | "unavailable";
  missing: string[];
  prover: { available: ProverKind[]; mode: "local"; location: "local" };
}
export interface Balance {
  baseUnits: string;
  live: boolean;
  source?: "chain" | "ledger";
  syncing?: boolean;
}
export interface ActivityRow {
  id: string;
  type: string;
  name: string;
  note: string;
  amount: string;
  direction: "in" | "out";
  status: "settled" | "pending" | "proving" | "arriving" | "failed";
  timestamp: number;
  logIndex?: number;
  txHash?: string;
  tone?: "accent" | "amber" | "neutral";
  unverified?: boolean;
}
export interface ActivityLink {
  label?: string | null;
  objectId?: string | null;
  objectType?: string | null;
  txHash?: string | null;
}
export interface ActivityHint {
  blockNumber?: bigint;
  eventName: string;
  fromAddr: string | null;
  links: ActivityLink[];
  logIndex?: number;
  timestamp?: number;
  toAddr: string | null;
  txHash?: Hex;
}
export interface Contact {
  handle: string;
  name: string;
  tone?: "accent" | "amber" | "neutral";
}
export interface SettleResult {
  status: "settled" | "failed";
  txHash?: string;
  provingMs?: number;
  prover: ProverKind;
  amount: string;
  onChain: boolean;
  proofPublics?: string[];
  nullifier?: string;
  requestId?: string;
  error?: string;
}

export interface SendPhaseEvent {
  phase: "building" | "proving" | "submitting" | "confirmed" | "failed";
  provingMs?: number;
  txHash?: string;
  onChain?: boolean;
  error?: string;
}

export interface InviteResult {
  link: string;
  localId: string;
  claimAccountPub: string;
  amount: string;
  expiresAt: number;
  onChain: boolean;
  proofPublics?: string[];
}
export interface InviteSummary {
  localId: string;
  amount: string;
  note?: string;
  link: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "claimed" | "refunded" | "expired";
}
export interface DeleteAccountResult {
  deleted: boolean;
}

type ApiUser = {
  address: string;
  id: string;
  roles: string[];
};

const env = import.meta.env as unknown as Record<string, string | undefined>;
const API_BASE_URL = (env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const IDEMPOTENCY_PREFIX = "benzo.idempotency.wallet.v1:";
const SIWE_ADDRESS_KEY = "benzo.siweAddress";
const READ_TIMEOUT_MS = 15_000;

export const AUTH_CHANGED_EVENT = "benzo:auth-changed";

export function apiHref(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export function authHeaders(): Record<string, string> {
  return {};
}

// The backend session, when one is ever established, is a plain SIWE sign-in
// keyed by the wallet's own EVM address (never a hosted/Google login). It is
// OPTIONAL: reads run client-side against the chain, so an absent SIWE address
// only means "no backend augmentation", never "wallet locked".
export function currentSiweAddress(): string | null {
  return localStorage.getItem(SIWE_ADDRESS_KEY);
}

export function storeSiweAddress(address: string): void {
  if (isAddress(address, { strict: false })) {
    localStorage.setItem(SIWE_ADDRESS_KEY, getAddress(address).toLowerCase());
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export function clearSiweAddress(): void {
  localStorage.removeItem(SIWE_ADDRESS_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function siweAddressLooksWellFormed(credential = currentSiweAddress()): boolean {
  return !!credential && isAddress(credential, { strict: false });
}

function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (const ch of input) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function randomIdempotencyKey(): string {
  const uuid = crypto.randomUUID?.();
  if (uuid) return `idem_${uuid}`;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `idem_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function idempotencyKey(path: string, init?: RequestInit): { key: string; clear: () => void } | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const body = typeof init?.body === "string" ? init.body : "";
  const storageKey = `${IDEMPOTENCY_PREFIX}${shortHash(`${method}:${path}:${body}`)}`;
  let key = localStorage.getItem(storageKey);
  if (!key) {
    key = randomIdempotencyKey();
    localStorage.setItem(storageKey, key);
  }
  return { key, clear: () => localStorage.removeItem(storageKey) };
}

export function prepareApiRequest(path: string, init?: RequestInit): {
  url: string;
  init: RequestInit;
  clearIdempotency?: () => void;
  authToken: string | null;
} {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const idem = idempotencyKey(path, init);
  if (idem) headers.set("Idempotency-Key", idem.key);
  return {
    url: apiHref(path),
    init: { ...init, credentials: "include", headers },
    clearIdempotency: idem?.clear,
    authToken: currentSiweAddress(),
  };
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const prepared = prepareApiRequest(path, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const timeoutController = method === "GET" ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const requestInit = timeoutController
    ? { ...prepared.init, signal: timeoutController.signal }
    : prepared.init;
  let res: Response | undefined;
  try {
    if (timeoutController) timeout = setTimeout(() => timeoutController.abort(), READ_TIMEOUT_MS);
    res = await fetch(prepared.url, requestInit);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* ignore */
      }
      if (res.status === 401) {
        // A backend 401 is a non-event for a self-custody wallet: keys, balance,
        // and private send are local/on-chain, so we just log and move on. No
        // auth bus, no eject, the wallet never authenticates to a backend to
        // exist. (Log only the method; a path segment can carry a secret token.)
        console.warn(
          `Benzo API returned 401 (${method}); ignoring, the device wallet works offline.`,
        );
      }
      throw new Error(detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error("This is taking too long. Please try again.");
    }
    throw e;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (res && res.status < 500) prepared.clearIdempotency?.();
  }
}

function sessionFromUser(user: ApiUser): Session {
  const handle = user.address;
  return {
    profile: { handle, name: `${user.address.slice(0, 6)}…${user.address.slice(-4)}` },
    handle,
    live: true,
    mode: "live",
    missing: [],
    prover: { available: ["local"], mode: "local", location: "local" },
  };
}

function mapActivityHint(row: Record<string, unknown>): ActivityHint | null {
  const txHash = typeof row.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(row.txHash)
    ? (row.txHash as Hex)
    : undefined;
  const eventName = typeof row.eventName === "string" ? row.eventName : "";
  if (!eventName || !txHash) return null;
  const blockTime = typeof row.blockTime === "string" ? Date.parse(row.blockTime) : undefined;
  const blockNumber = typeof row.blockNumber === "string" && /^\d+$/.test(row.blockNumber)
    ? BigInt(row.blockNumber)
    : undefined;
  const links = Array.isArray(row.links) ? row.links.filter(isActivityLink) : [];
  return {
    blockNumber,
    eventName,
    fromAddr: typeof row.fromAddr === "string" ? row.fromAddr : null,
    links,
    logIndex: typeof row.logIndex === "number" ? row.logIndex : undefined,
    timestamp: blockTime ? Math.floor(blockTime / 1000) : undefined,
    toAddr: typeof row.toAddr === "string" ? row.toAddr : null,
    txHash,
  };
}

function isActivityLink(value: unknown): value is ActivityLink {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export const api = {
  signInWithSiwe: async (
    address: Address,
    signMessage: (message: string) => Promise<Hex>,
  ): Promise<{ user: ApiUser }> => {
    const normalized = getAddress(address);
    const nonce = await http<{ expiresAt: string; nonce: string }>(`/auth/nonce?address=${encodeURIComponent(normalized)}`);
    const apiUrl = API_BASE_URL
      ? new URL(API_BASE_URL, typeof window !== "undefined" ? window.location.origin : "http://localhost")
      : new URL(typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const message = createSiweMessage({
      address: normalized,
      chainId: CHAIN_ID,
      domain: apiUrl.host,
      nonce: nonce.nonce,
      statement: "Sign in to Benzo Wallet.",
      uri: typeof window !== "undefined" ? window.location.origin : apiUrl.origin,
      version: "1",
    });
    const signature = await signMessage(message);
    const result = await http<{ user: ApiUser }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    });
    storeSiweAddress(normalized);
    return result;
  },
  logout: async () => {
    const result = await http<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" });
    clearSiweAddress();
    return result;
  },
  session: async () => {
    const { user } = await http<{ user: ApiUser }>("/auth/me");
    return sessionFromUser(user);
  },
  deleteAccount: async (): Promise<DeleteAccountResult> => {
    await api.logout();
    return { deleted: true };
  },
  activityHints: async () => {
    const result = await http<{ activity: Array<Record<string, unknown>>; nextCursor: string | null }>("/activity");
    return result.activity.flatMap((row) => {
      const hint = mapActivityHint(row);
      return hint ? [hint] : [];
    });
  },
  contacts: async () => {
    const result = await http<{
      contacts: Array<{ address: string; alias: string | null; favorite: boolean; handle: string | null }>;
    }>("/contacts");
    return result.contacts.map((row) => ({
      handle: row.handle ? `@${row.handle}` : row.address,
      name: row.alias ?? row.handle ?? `${row.address.slice(0, 6)}…${row.address.slice(-4)}`,
    }));
  },
  // OPTIONAL fast-path / display-metadata cache only. HandleRegistry on Fuji is
  // the source of truth (see lib/handleRegistry.ts); never gate a send on this.
  resolveHandle: async (handle: string) => {
    const normalized = normalizeHandle(handle);
    return http<{ address: Address; registeredOnEerc: boolean; source: string }>(`/resolve/${encodeURIComponent(normalized)}`);
  },
  // Availability reads the on-chain registry, not the BFF.
  handleAvailable: (h: string) => handleAvailableOnChain(h),
  // OPTIONAL backend augment (indexing / off-chain metadata). The authoritative
  // registration is the client-side on-chain claim in lib/handleRegistry.ts
  // (claimHandleOnChain), exposed via benzoClient.claimHandleClientSide, so
  // ownerOf(handle) == the user's own address rather than the ops key.
  claimHandle: async (handle: string) =>
    http<{ handle: string; address: Address; registeredOnEerc: boolean; source: string }>("/handles", {
      method: "POST",
      body: JSON.stringify({ handle: normalizeHandle(handle) }),
    }).then((result) => ({ handle: `@${result.handle}`, txHash: undefined, onChain: result.registeredOnEerc })),
};
