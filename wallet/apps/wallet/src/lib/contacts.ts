import { type Contact } from "./api";
import { decodeRecipient } from "./recipient";

/** localStorage key for the device-local contacts (exported so tests key off the
 *  single source of truth instead of re-hardcoding the string). */
export const CONTACTS_LS_KEY = "benzo.contacts.local.v1";
const LS = CONTACTS_LS_KEY;

export function normAddress(a: string): string {
  const t = a.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t;
  if (t.startsWith("bzr_") && decodeRecipient(t) !== null) return t;
  return "";
}

export function listLocal(): Contact[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "[]");
    return Array.isArray(raw) ? raw.filter((c) => c && c.handle) : [];
  } catch {
    return [];
  }
}

function writeLocal(cs: Contact[]): void {
  try {
    localStorage.setItem(LS, JSON.stringify(cs));
  } catch {
    /* ignore */
  }
}

export function saveContact(address: string, name: string): Contact[] {
  const addr = normAddress(address);
  if (!addr) return listLocal();
  const cs = listLocal().filter((c) => c.handle !== addr);
  cs.unshift({ handle: addr, name: name.trim() || addr });
  writeLocal(cs);
  return cs;
}

export function removeContact(address: string): Contact[] {
  const addr = normAddress(address);
  const cs = listLocal().filter((c) => c.handle !== addr);
  writeLocal(cs);
  return cs;
}

export function isSaved(address: string): boolean {
  const addr = normAddress(address);
  return listLocal().some((c) => c.handle === addr);
}

/**
 * Update a locally-saved contact in place, keyed by its exact stored handle.
 * Unlike `saveContact` (address/receive-code gated), this also handles `@handle`
 * contacts, so the contact-detail editor can rename or re-point any row.
 */
export function upsertLocalContact(prevHandle: string, handle: string, name: string): Contact[] {
  const nextHandle = handle.trim();
  if (!nextHandle) return listLocal();
  const cs = listLocal().filter((c) => c.handle !== prevHandle && c.handle !== nextHandle);
  cs.unshift({ handle: nextHandle, name: name.trim() || nextHandle });
  writeLocal(cs);
  return cs;
}

/** Remove a locally-saved contact by its exact stored handle (`@handle` too). */
export function removeLocalContact(handle: string): Contact[] {
  const cs = listLocal().filter((c) => c.handle !== handle);
  writeLocal(cs);
  return cs;
}

/**
 * Merge the user's locally-saved contacts with any contacts the BFF returned,
 * deduped by handle. Local wins (they're the user's own edits/renames); BFF
 * entries not already saved locally are appended. In the local-first wallet
 * `bff` is usually empty, but a running BFF must not be silently dropped.
 */
export function mergeContacts(bff: Contact[]): Contact[] {
  const local = listLocal();
  const seen = new Set(local.map((c) => c.handle));
  return [...local, ...bff.filter((c) => c && c.handle && !seen.has(c.handle))];
}
