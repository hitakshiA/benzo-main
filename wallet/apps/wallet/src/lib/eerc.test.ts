import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenzoAccount } from "@benzo/core";

const TO_ADDRESS = "0x1111111111111111111111111111111111111111";
const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const mocks = vi.hoisted(() => {
  const writeContract = vi.fn();
  return {
    account: { address: "0x2222222222222222222222222222222222222222" },
    createPublicClient: vi.fn(() => ({ readContract: vi.fn() })),
    createWalletClient: vi.fn(() => ({ account: { address: "0x2222222222222222222222222222222222222222" }, writeContract })),
    http: vi.fn((url: string) => ({ url })),
    privateKeyToAccount: vi.fn(() => ({ address: "0x2222222222222222222222222222222222222222" })),
    tokenAddress: "0x1226C73Bd8022080b8DbCDC24AA8B61D659A835f",
    writeContract,
  };
});

vi.mock("viem", () => ({
  createPublicClient: mocks.createPublicClient,
  createWalletClient: mocks.createWalletClient,
  erc20Abi: [],
  http: mocks.http,
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: mocks.privateKeyToAccount,
}));

vi.mock("./network", () => ({
  ACTIVE_CHAIN: { id: 43113, name: "Avalanche Fuji" },
  EERC_CONVERTER_MODE: true,
  ENCRYPTED_ERC_ADDRESS: "0x3333333333333333333333333333333333333333",
  REGISTRAR_ADDRESS: "0x4444444444444444444444444444444444444444",
  RPC_URL: "https://rpc.example",
  USDC_DECIMALS: 6,
  USDC_TOKEN_ADDRESS: mocks.tokenAddress,
}));

import { transferPublicUsdc } from "./eerc";

describe("transferPublicUsdc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeContract.mockResolvedValue(TX_HASH);
  });

  it("submits an ERC-20 transfer through the existing viem wallet client", async () => {
    const account = {
      address: "0x2222222222222222222222222222222222222222",
      evmPrivateKey: `0x${"1".repeat(64)}`,
    } as BenzoAccount;

    await expect(transferPublicUsdc(account, TO_ADDRESS, 2_500_000n)).resolves.toEqual({
      txHash: TX_HASH,
    });

    expect(mocks.privateKeyToAccount).toHaveBeenCalledWith(account.evmPrivateKey);
    expect(mocks.http).toHaveBeenCalledWith("https://rpc.example", expect.objectContaining({ retryCount: 5 }));
    expect(mocks.writeContract).toHaveBeenCalledWith({
      account: { address: "0x2222222222222222222222222222222222222222" },
      address: mocks.tokenAddress,
      abi: expect.arrayContaining([expect.objectContaining({ name: "transfer" })]),
      functionName: "transfer",
      args: [TO_ADDRESS, 2_500_000n],
    });
  });
});
