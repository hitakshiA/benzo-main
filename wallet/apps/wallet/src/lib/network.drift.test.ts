import { afterEach, describe, expect, it, vi } from "vitest";

// Drift guard: the wallet transacts client-side against the eERC deployment
// published by @benzo/config. If this shape drifts, the browser will build proofs
// and transactions for the wrong contract cluster.

const NETWORK_ENV_KEYS = [
  "VITE_CHAIN_ENV",
  "VITE_BENZO_NETWORK",
  "VITE_RPC_URL",
  "VITE_BENZONET_RPC_URL",
  "VITE_FUJI_RPC_URL",
  "VITE_AVALANCHE_RPC_URL",
  "VITE_EERC_ENCRYPTED_ERC_ADDRESS",
  "VITE_EERC_REGISTRAR_ADDRESS",
  "VITE_USDC_TOKEN_ADDRESS",
  "VITE_PRIVATE_GIFT_ESCROW_ADDRESS",
  "VITE_EERC_USDC_TOKEN_ID",
];

async function loadNetwork(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Clear any inherited network env via Vitest's tracked stub mechanism so
  // afterEach's unstubAllEnvs fully restores it (a direct import.meta.env delete
  // would bypass that and leak across tests).
  for (const key of NETWORK_ENV_KEYS) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./network");
}

describe("wallet deployment drift guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("wallet contract IDs expose the current Fuji eERC deployment", async () => {
    const { ACTIVE_CHAIN, DEPLOYMENT, NETWORK, VERIFIER_ID } = await loadNetwork({ VITE_CHAIN_ENV: "fuji" });

    expect(NETWORK).toBe("fuji");
    expect(ACTIVE_CHAIN.id).toBe(43113);
    expect(DEPLOYMENT.contracts.EncryptedERC).toBe("0x9E16eD3B799541B4929f7E2014904C65E81035b1");
    expect(DEPLOYMENT.contracts.Registrar).toBe("0x9a63FEa9851097DBAf3757b636217fdde50ABaF0");
    expect(DEPLOYMENT.contracts.tUSDC).toBe("0x5425890298aed601595a70AB815c96711a31Bc65");
    expect(DEPLOYMENT.contracts.verifiers.transfer).toBe("0x4bF3DBD3fF57943dC402ec1F280589E1032A32A5");
    expect(VERIFIER_ID).toBe(DEPLOYMENT.contracts.verifiers.transfer);
  });

  it("folds a benzonet build back to Fuji, the consumer wallet ships only public chains", async () => {
    // BenzoNet is the permissioned business L1 (console-only). The wallet must never
    // resolve to it, even if a build env asks for it.
    const { ACTIVE_CHAIN, NETWORK } = await loadNetwork({ VITE_BENZO_NETWORK: "benzonet" });

    expect(NETWORK).toBe("fuji");
    expect(ACTIVE_CHAIN.id).toBe(43113);
  });

  it("selects Avalanche mainnet from VITE_BENZO_NETWORK", async () => {
    const {
      ACTIVE_CHAIN,
      DEPLOYMENT,
      ENCRYPTED_ERC_ADDRESS,
      EERC_USDC_TOKEN_ID,
      EXPLORER_BASE_URL,
      NETWORK,
      PRIVATE_GIFT_ESCROW_ADDRESS,
      REGISTRAR_ADDRESS,
      RPC_URL,
      USDC_TOKEN_ADDRESS,
      VERIFIER_ID,
    } = await loadNetwork({ VITE_BENZO_NETWORK: "avalanche" });

    expect(NETWORK).toBe("avalanche");
    expect(ACTIVE_CHAIN.id).toBe(43114);
    expect(RPC_URL).toBe("https://api.avax.network/ext/bc/C/rpc");
    expect(EXPLORER_BASE_URL).toBe("https://snowtrace.io");
    expect(DEPLOYMENT.contracts.EncryptedERC).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");
    expect(DEPLOYMENT.contracts.Registrar).toBe("0x902B8D5585A5124C9B9c001A95b7f520C07a79F2");
    expect(DEPLOYMENT.contracts.tUSDC).toBe("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
    expect(DEPLOYMENT.contracts.PrivateGiftEscrow).toBe("0xb22c366e000165683A51C2630F6Ab818e5227C94");
    expect(ENCRYPTED_ERC_ADDRESS).toBe(DEPLOYMENT.contracts.EncryptedERC);
    expect(REGISTRAR_ADDRESS).toBe(DEPLOYMENT.contracts.Registrar);
    expect(USDC_TOKEN_ADDRESS).toBe(DEPLOYMENT.contracts.tUSDC);
    expect(PRIVATE_GIFT_ESCROW_ADDRESS).toBe(DEPLOYMENT.contracts.PrivateGiftEscrow);
    expect(EERC_USDC_TOKEN_ID).toBe(1n);
    expect(VERIFIER_ID).toBe("0x4A716026a0C1F7158165520B6DF2009fFeB79f01");
  });
});
