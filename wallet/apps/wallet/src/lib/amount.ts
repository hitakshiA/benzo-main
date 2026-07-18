import { usdcToBaseUnits } from "./format";

export const INVALID_AMOUNT = "Enter an amount above $0.";

export interface ParsedUsdcAmount {
  valid: boolean;
  value: bigint;
  baseUnits: string;
  error: string | null;
}

export function parsePositiveUsdcAmount(amount: string): ParsedUsdcAmount {
  const raw = amount.trim();
  if (!raw) return { valid: false, value: 0n, baseUnits: "0", error: null };
  const clean = raw.replace(/[$,]/g, "");
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(clean)) {
    return { valid: false, value: 0n, baseUnits: "0", error: INVALID_AMOUNT };
  }
  try {
    const value = usdcToBaseUnits(raw);
    if (value <= 0n) return { valid: false, value: 0n, baseUnits: "0", error: INVALID_AMOUNT };
    return { valid: true, value, baseUnits: value.toString(), error: null };
  } catch (e) {
    return { valid: false, value: 0n, baseUnits: "0", error: (e as Error).message || INVALID_AMOUNT };
  }
}
