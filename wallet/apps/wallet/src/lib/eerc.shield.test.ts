import type { BenzoAccount } from "@benzo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0x00f6B82Ea91E429FDD6Dfed8f273190092dd14D6" as const;
const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const eercMocks = vi.hoisted(() => {
  const publicClient = {
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  };
  const walletClient = {
    writeContract: vi.fn(),
  };
  const fetchPublicKey = vi.fn();
  const register = vi.fn();
  const deposit = vi.fn();
  const withdraw = vi.fn();
  const transfer = vi.fn();
  const calculateTotalBalance = vi.fn();

  class MockEERC {
    client = publicClient;
    encryptedErcAbi = [];
    fetchPublicKey = fetchPublicKey;
    register = register;
    deposit = deposit;
    withdraw = withdraw;
    transfer = transfer;
    calculateTotalBalance = calculateTotalBalance;
  }

  return {
    MockEERC,
    calculateTotalBalance,
    deposit,
    fetchPublicKey,
    publicClient,
    register,
    transfer,
    walletClient,
    withdraw,
  };
});

vi.mock("@avalabs/eerc-sdk", () => ({
  EERC: eercMocks.MockEERC,
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => eercMocks.publicClient),
    createWalletClient: vi.fn(() => eercMocks.walletClient),
    http: vi.fn(() => ({})),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({ address: ADDRESS })),
}));

import { INSUFFICIENT_PRIVATE_USDC_ERROR } from "./errors";
import { shieldPublicUsdc, transferPrivateUsdc, unshieldPrivateUsdc } from "./eerc";
import { USDC_TOKEN_ADDRESS } from "./network";

const account: BenzoAccount = {
  address: ADDRESS,
  eercDecryptionKey: "11".repeat(32),
  evmAddress: ADDRESS,
  evmPrivateKey: `0x${"1".padStart(64, "0")}`,
  label: "test",
  mvkPub: new Uint8Array(),
  mvkScalar: 0n,
  mvkSecret: new Uint8Array(),
  spendPub: 0n,
  spendSk: 0n,
  viewPub: new Uint8Array(),
  viewSecret: new Uint8Array(),
};

const eGCT = {
  c1: { x: 1n, y: 2n },
  c2: { x: 3n, y: 4n },
};

describe("eERC client-side shield/unshield", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eercMocks.fetchPublicKey.mockResolvedValue([1n, 2n]);
    eercMocks.register.mockResolvedValue({ transactionHash: TX_HASH });
    eercMocks.deposit.mockResolvedValue({ transactionHash: TX_HASH });
    eercMocks.withdraw.mockResolvedValue({ transactionHash: TX_HASH });
    eercMocks.transfer.mockResolvedValue({ transactionHash: TX_HASH });
    eercMocks.calculateTotalBalance.mockReturnValue(1_000_000n);
    eercMocks.publicClient.waitForTransactionReceipt.mockResolvedValue({});
    eercMocks.publicClient.simulateContract.mockResolvedValue({ request: {} });
    eercMocks.walletClient.writeContract.mockResolvedValue(TX_HASH);
    eercMocks.publicClient.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "allowance":
        case "balanceOf":
          return 10_000_000n;
        case "auditorPublicKey":
          return [5n, 6n];
        case "decimals":
          return 18n;
        case "getBalanceFromTokenAddress":
          return [eGCT, 0n, [], [0n, 0n, 0n, 0n, 0n, 0n, 0n], 0n];
        default:
          throw new Error(`unexpected readContract ${functionName}`);
      }
    });
  });

  it("uses configured USDC token decimals for converter deposit scaling", async () => {
    await expect(shieldPublicUsdc(account, 1_000_000n, "memo")).resolves.toEqual({
      approvalTxHash: undefined,
      registrationTxHash: undefined,
      txHash: TX_HASH,
      provingMs: expect.any(Number),
    });

    expect(eercMocks.deposit).toHaveBeenCalledWith(1_000_000n, USDC_TOKEN_ADDRESS, 6n, "memo");
    expect(eercMocks.publicClient.readContract).not.toHaveBeenCalledWith(expect.objectContaining({
      functionName: "decimals",
    }));
  });

  it("rejects unshield above decrypted balance before attempting the withdraw proof", async () => {
    eercMocks.calculateTotalBalance.mockReturnValue(999_999n);

    await expect(unshieldPrivateUsdc(account, 1_000_000n, "memo")).rejects.toThrow(INSUFFICIENT_PRIVATE_USDC_ERROR);

    expect(eercMocks.withdraw).not.toHaveBeenCalled();
    expect(eercMocks.publicClient.readContract).not.toHaveBeenCalledWith(expect.objectContaining({
      functionName: "auditorPublicKey",
    }));
  });

  it("registers once before the first private send when the account has no eERC public key", async () => {
    eercMocks.fetchPublicKey.mockResolvedValueOnce([0n, 0n]);
    const to = "0x1111111111111111111111111111111111111111";

    await expect(transferPrivateUsdc(account, to, 250_000n, "memo")).resolves.toEqual({
      txHash: TX_HASH,
      provingMs: expect.any(Number),
    });

    expect(eercMocks.register).toHaveBeenCalledTimes(1);
    expect(eercMocks.publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
    expect(eercMocks.transfer).toHaveBeenCalledWith(
      to,
      250_000n,
      [1n, 2n, 3n, 4n],
      1_000_000n,
      [5n, 6n],
      USDC_TOKEN_ADDRESS,
      "memo",
    );
  });
});
