import { usdcToBaseUnits } from "./format";
import { INSUFFICIENT_PUBLIC_USDC_ERROR } from "./errors";

export function inviteAmountToBaseUnits(amount: string): string {
  try {
    const value = usdcToBaseUnits(amount);
    return value > 0n ? value.toString() : "0";
  } catch {
    return "0";
  }
}

function parseBaseUnits(value?: string | null): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

// Gift links escrow edge USDC on-chain. Keep that funding detail out of the UI;
// callers surface a plain "not enough USDC" message.
export function validateFundedInviteAmount(amount: string, publicBalanceBaseUnits?: string | null): {
  amountOk: boolean;
  amountBaseUnits: string;
  insufficient: boolean;
  message: string | null;
} {
  const raw = amount.trim();
  const n = Number(raw);
  const amountOk = raw.length > 0 && Number.isFinite(n) && n > 0;
  const amountBaseUnits = inviteAmountToBaseUnits(raw);
  if (!amountOk) {
    return {
      amountOk: false,
      amountBaseUnits,
      insufficient: false,
      message: raw.length > 0 ? "Enter an amount above $0." : null,
    };
  }
  const insufficient = BigInt(amountBaseUnits) > parseBaseUnits(publicBalanceBaseUnits);
  return {
    amountOk,
    amountBaseUnits,
    insufficient,
    message: insufficient ? INSUFFICIENT_PUBLIC_USDC_ERROR : null,
  };
}
