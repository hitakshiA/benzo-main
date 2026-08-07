import { describe, expect, it } from "vitest";
import { avalanche, avalancheFuji } from "viem/chains";
import { chainForNetwork, withRpcOverride } from "../src/index.js";

/**
 * The chains resolve their endpoint from import.meta.env at module load, which
 * Vite substitutes only in the browser build — under Node it is undefined and
 * the module falls back to the public defaults. So these cover the override
 * logic directly plus the fallbacks that apply in this (Node) context; that the
 * configured value reaches the browser bundle is verified at build time.
 */

function defaultRpc(chain: { rpcUrls: { default: { http: readonly string[] } } }) {
  return chain.rpcUrls.default.http[0];
}

describe("withRpcOverride", () => {
  it("replaces the default endpoint when one is configured", () => {
    expect(defaultRpc(withRpcOverride(avalancheFuji, "https://example.test/fuji"))).toBe(
      "https://example.test/fuji",
    );
  });

  it("keeps the public endpoint when no override is configured", () => {
    expect(defaultRpc(withRpcOverride(avalancheFuji, undefined))).toBe(
      defaultRpc(avalancheFuji),
    );
    // An empty env var reads as "" and must not blank out the endpoint.
    expect(defaultRpc(withRpcOverride(avalancheFuji, ""))).toBe(defaultRpc(avalancheFuji));
  });

  it("preserves chain id, explorer, and native currency", () => {
    const overridden = withRpcOverride(avalanche, "https://example.test/mainnet");

    // Spreading the chain must not drop the fields viem needs alongside the RPC,
    // or transactions sign against the wrong chain.
    expect(overridden.id).toBe(avalanche.id);
    expect(overridden.name).toBe(avalanche.name);
    expect(overridden.nativeCurrency).toEqual(avalanche.nativeCurrency);
    expect(overridden.blockExplorers?.default.url).toBe(avalanche.blockExplorers?.default.url);
  });

  it("does not mutate the chain it is given", () => {
    const before = defaultRpc(avalancheFuji);
    withRpcOverride(avalancheFuji, "https://example.test/fuji");

    // viem's chain objects are shared module singletons; mutating one would
    // leak the testnet endpoint into every other consumer.
    expect(defaultRpc(avalancheFuji)).toBe(before);
  });
});

describe("chain defaults", () => {
  it("points BenzoNet at the validator host", () => {
    expect(defaultRpc(chainForNetwork("benzonet"))).toBe("https://rpc.benzo.space");
  });

  it("keeps each network on its own chain id", () => {
    expect(chainForNetwork("fuji").id).toBe(43_113);
    expect(chainForNetwork("benzonet").id).toBe(68_420);
    expect(chainForNetwork("avalanche").id).toBe(43_114);
  });
});
