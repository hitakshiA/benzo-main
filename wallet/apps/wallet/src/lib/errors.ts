export const INVALID_USDC_AMOUNT_ERROR = "Enter a valid USDC amount.";
export const INSUFFICIENT_PRIVATE_USDC_ERROR = "Not enough private USDC. Receive money or use a smaller amount.";
export const INSUFFICIENT_PUBLIC_USDC_SHIELD_ERROR = "Not enough public USDC. Receive USDC or use a smaller amount.";
export const INSUFFICIENT_PUBLIC_USDC_ERROR = "Not enough USDC available for a gift link. Receive money or use a smaller amount.";

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  details?: unknown;
  message?: unknown;
  name?: unknown;
  shortMessage?: unknown;
};

function errorText(error: unknown, depth = 0): string {
  if (typeof error === "string") return error;
  // Depth guard: a self-referential `cause` chain (cause -> itself) would
  // otherwise recurse forever and overflow the stack inside error handling.
  if (!error || typeof error !== "object" || depth >= 6) return "";
  const e = error as ErrorLike;
  const parts = [e.shortMessage, e.message, e.details, e.code, errorText(e.cause, depth + 1)]
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .filter(Boolean);
  if (parts.length === 0 && typeof e.name === "string") parts.push(e.name);
  return parts.join(" ");
}

// EIP-1193 user-rejection is code 4001 (ethers uses "ACTION_REJECTED"). Match it
// as a DISCRETE code value, walking the cause chain, never as a substring of the
// assembled text, or a message like "block 4001 not found" would be mislabelled
// as a cancellation in a money flow.
function isUserRejection(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth >= 6) return false;
  const e = error as ErrorLike;
  if (e.code === 4001 || e.code === "4001" || e.code === "ACTION_REJECTED") return true;
  return isUserRejection(e.cause, depth + 1);
}

function isSafeMessage(message: string): boolean {
  return !!message && !/at\s+\S+\s+\(.+:\d+:\d+\)|execution reverted|contract function|\babi\b|internal json-rpc|stack/i.test(message);
}

export function mapError(error: unknown, fallback = "Something went wrong. Your money is safe - please try again."): string {
  if (isUserRejection(error)) return "Request cancelled.";
  const message = errorText(error).trim();
  const lower = message.toLowerCase();

  if (!message) return fallback;
  if (/user rejected|user denied|rejected the request|request rejected/.test(lower)) return "Request cancelled.";
  if (/insufficient funds|not enough avax|gas required exceeds|exceeds the balance/.test(lower)) return "Not enough AVAX for network fees.";
  if (/failed to fetch|networkerror|timeout|http 5\d\d|rate limit|rpc|gateway/.test(lower)) {
    return "Couldn't reach Avalanche right now. Please try again.";
  }
  if (/not registered|registration required|register.*eerc|eerc.*register/.test(lower)) {
    return "Finish wallet setup before sending private USDC.";
  }
  if (/groth16|proof|prover|witness|circuit|zkey|wasm/.test(lower)) {
    return "Couldn't build the private proof on this device. Please try again.";
  }

  return isSafeMessage(message) ? message : fallback;
}

/** Human-safe message for any thrown error. Kept for existing call sites. */
export function friendlyError(error: unknown, fallback = "Something went wrong. Your money is safe - please try again."): string {
  return mapError(error, fallback);
}
