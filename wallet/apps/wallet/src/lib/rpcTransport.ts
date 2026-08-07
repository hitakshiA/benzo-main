import { http, type HttpTransportConfig, type Transport } from "viem";

/**
 * Avalanche answers eth_estimateGas with a balance-derived spend allowance
 * (roughly `balance / maxFeePerGas`) rather than the gas the call actually
 * needs, whenever the request carries EIP-1559 fee fields — which viem always
 * sends. The returned number therefore tracks the fee, not the work:
 *
 *   maxFeePerGas   50 gwei -> 6,496,878      (looks plausible, passes)
 *   maxFeePerGas   10 gwei -> 32,479,719     (at the 32M block limit)
 *   maxFeePerGas     204 wei -> 1.59e15      (rejected: exceeds block gas limit)
 *
 * Fuji's base fee normally sits around 25 gwei, which lands the allowance under
 * the block limit and lets transactions through — so this stays invisible until
 * the base fee drops. It fell to ~10 wei, viem derived a 204 wei maxFeePerGas,
 * and every send started failing with "exceeds block gas limit" despite no code
 * change on our side.
 *
 * Dropping the fee fields makes the node return a real estimate (~52k for an
 * ERC-20 transfer), so when an estimate comes back implausibly large, ask again
 * without them rather than clamping to a guessed constant.
 */

// Comfortably above any eERC operation (proof verification runs a few hundred k)
// and well under Avalanche's 32M block limit, so a real estimate never trips it.
const IMPLAUSIBLE_GAS = 15_000_000n;

type RpcArgs = { method: string; params?: unknown[] };

function stripFeeFields(params: unknown[] | undefined): unknown[] | undefined {
  if (!params?.length) return params;
  const [call, ...rest] = params;
  if (!call || typeof call !== "object") return params;
  const { maxFeePerGas, maxPriorityFeePerGas, gasPrice, ...clean } = call as Record<string, unknown>;
  if (maxFeePerGas === undefined && maxPriorityFeePerGas === undefined && gasPrice === undefined) {
    return params;
  }
  return [clean, ...rest];
}

/**
 * viem's http transport, with the estimateGas correction above applied. Use this
 * anywhere the wallet talks to a chain so every client shares the behaviour.
 */
export function rpcTransport(url?: string, config?: HttpTransportConfig): Transport {
  const inner = http(url, config);

  return (params) => {
    const transport = inner(params);
    const base = transport.request;

    const request = (async (args: RpcArgs, opts?: unknown) => {
      const result = await base(args as never, opts as never);
      if (args?.method !== "eth_estimateGas" || typeof result !== "string") return result;

      let estimate: bigint;
      try {
        estimate = BigInt(result);
      } catch {
        return result;
      }
      if (estimate <= IMPLAUSIBLE_GAS) return result;

      const cleaned = stripFeeFields(args.params);
      // Nothing to strip means the node genuinely wants this much gas; pass it
      // through and let the caller surface the failure.
      if (cleaned === args.params) return result;

      try {
        return await base({ ...args, params: cleaned } as never, opts as never);
      } catch {
        return result;
      }
    }) as typeof transport.request;

    return { ...transport, request };
  };
}
