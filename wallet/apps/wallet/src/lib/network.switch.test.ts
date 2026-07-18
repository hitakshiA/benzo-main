import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The reactive layer on top of the deployment drift guard: selecting a network at
// runtime must swap the resolved eERC address bundle + chain, persist the choice,
// and notify subscribers, all without a reload.

const KEY = "benzo.network";

// A namespace import observes the module's ESM live bindings, exactly as the
// client-side balance/transfer path (eerc/gift/handle/api) does at call time.
async function loadFreshNetwork() {
  vi.resetModules();
  return import("./network");
}

describe("reactive network switching", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("defaults to the env network (Fuji) and its address bundle", async () => {
    const net = await loadFreshNetwork();
    expect(net.getActiveNetwork()).toBe("fuji");
    expect(net.ACTIVE_CHAIN.id).toBe(43113);
    expect(net.ENCRYPTED_ERC_ADDRESS).toBe("0x9E16eD3B799541B4929f7E2014904C65E81035b1");
    expect(net.USDC_TOKEN_ADDRESS).toBe("0x5425890298aed601595a70AB815c96711a31Bc65");
  });

  it("swaps the resolved eERC bundle + chain when switching to mainnet", async () => {
    const net = await loadFreshNetwork();
    const notified: string[] = [];
    net.subscribeNetwork((n) => notified.push(n));

    net.setActiveNetwork("avalanche");

    expect(net.getActiveNetwork()).toBe("avalanche");
    expect(net.getNetworkConfig().chainId).toBe(43114);
    // Live bindings the balance path reads track the switch immediately.
    expect(net.ACTIVE_CHAIN.id).toBe(43114);
    expect(net.RPC_URL).toBe("https://api.avax.network/ext/bc/C/rpc");
    expect(net.ENCRYPTED_ERC_ADDRESS).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");
    expect(net.USDC_TOKEN_ADDRESS).toBe("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
    expect(net.VERIFIER_ID).toBe("0x4A716026a0C1F7158165520B6DF2009fFeB79f01");
    expect(net.EXPLORER_BASE_URL).toBe("https://snowtrace.io");
    expect(notified).toEqual(["avalanche"]);
  });

  it("persists the selection and restores it on the next reload", async () => {
    const net = await loadFreshNetwork();
    net.setActiveNetwork("avalanche");
    expect(localStorage.getItem(KEY)).toBe("avalanche");
    expect(net.getStoredNetwork()).toBe("avalanche");

    // A fresh module import (page reload) must resolve the stored network.
    const reloaded = await loadFreshNetwork();
    expect(reloaded.getActiveNetwork()).toBe("avalanche");
    expect(reloaded.ACTIVE_CHAIN.id).toBe(43114);
    expect(reloaded.ENCRYPTED_ERC_ADDRESS).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");
  });

  it("switches back to Fuji cleanly", async () => {
    const net = await loadFreshNetwork();
    net.setActiveNetwork("avalanche");
    expect(net.ACTIVE_CHAIN.id).toBe(43114);
    net.setActiveNetwork("fuji");
    expect(net.getActiveNetwork()).toBe("fuji");
    expect(net.ACTIVE_CHAIN.id).toBe(43113);
    expect(net.USDC_TOKEN_ADDRESS).toBe("0x5425890298aed601595a70AB815c96711a31Bc65");
    expect(localStorage.getItem(KEY)).toBe("fuji");
  });

  it("ignores stored garbage and unknown networks, falling back to the env default", async () => {
    localStorage.setItem(KEY, "not-a-network");
    const net = await loadFreshNetwork();
    expect(net.getActiveNetwork()).toBe("fuji");
    expect(net.getStoredNetwork()).toBeNull();
    expect(net.setActiveNetwork("bogus" as never)).toBe("fuji");
    expect(net.getActiveNetwork()).toBe("fuji");
  });
});
