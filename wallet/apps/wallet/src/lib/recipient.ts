import { type BenzoRecipient } from "@benzo/core";
import { isValidEvmAddress, normalizeEvmAddress } from "./address";

export type RecipientKind = "private" | "address" | "invite";

export function encodeRecipient(rec: BenzoRecipient): string {
  const payload = {
    a: rec.address,
    s: rec.spendPub.toString(16),
    v: Array.from(rec.viewPub, (x) => x.toString(16).padStart(2, "0")).join(""),
    m: rec.mvkScalar ? rec.mvkScalar.toString(16) : undefined,
    l: rec.label,
  };
  return "bzr_" + btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function decodeRecipient(str: string): BenzoRecipient | null {
  try {
    if (!str.startsWith("bzr_")) return null;
    const base64 = str.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const payload = JSON.parse(json) as { a?: string; s: string; v: string; m?: string; l?: string };
    const viewPub = new Uint8Array(payload.v.length / 2);
    for (let i = 0; i < viewPub.length; i++) {
      viewPub[i] = parseInt(payload.v.slice(i * 2, i * 2 + 2), 16);
    }
    return {
      address: payload.a && isValidEvmAddress(payload.a) ? normalizeEvmAddress(payload.a) as `0x${string}` : undefined,
      spendPub: BigInt("0x" + payload.s),
      viewPub,
      mvkScalar: payload.m ? BigInt("0x" + payload.m) : undefined,
      label: payload.l,
    };
  } catch {
    return null;
  }
}

export function looksLikeEvmAddressInput(to: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(to.trim()) && to.trim().length >= 10;
}

export function looksLikeHandle(to: string): boolean {
  return /^@?[a-z0-9_]{3,20}$/i.test(to.trim());
}

export function classifyRecipientInput(to: string): RecipientKind {
  const t = to.trim();
  if (looksLikeEvmAddressInput(t)) {
    return isValidEvmAddress(t) ? "address" : "invite";
  }
  if (t.startsWith("bzr_")) {
    return decodeRecipient(t) !== null ? "private" : "invite";
  }
  if (looksLikeHandle(t)) return "private";
  return "invite";
}
