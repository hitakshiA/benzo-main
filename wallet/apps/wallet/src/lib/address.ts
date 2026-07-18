import { getAddress, isAddress } from "viem";

export function isValidEvmAddress(addr: string): boolean {
  return isAddress(addr.trim(), { strict: false });
}

export function normalizeEvmAddress(addr: string): string {
  return getAddress(addr.trim());
}

export function shortAddress(addr: string, n = 4): string {
  const t = addr.trim();
  return t.length > n * 2 + 2 ? `${t.slice(0, n + 2)}…${t.slice(-n)}` : t;
}
