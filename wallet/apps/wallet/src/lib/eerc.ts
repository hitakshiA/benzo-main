import type { EERC } from "@avalabs/eerc-sdk";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACTIVE_CHAIN,
  EERC_CONVERTER_MODE,
  ENCRYPTED_ERC_ADDRESS,
  REGISTRAR_ADDRESS,
  RPC_URL,
  USDC_DECIMALS,
  USDC_TOKEN_ADDRESS,
} from "./network";
import type { BenzoAccount } from "@benzo/core";
import { INSUFFICIENT_PRIVATE_USDC_ERROR } from "./errors";

type CircuitURLs = ConstructorParameters<typeof EERC>[5];

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const env = import.meta.env as unknown as Record<string, string | undefined>;

function circuitUrl(operation: string, artifact: "wasm" | "zkey"): string {
  const key = `VITE_EERC_${operation.toUpperCase()}_${artifact.toUpperCase()}_URL`;
  return env[key] ?? `/circuits/${operation}.${artifact}`;
}

export const EERC_CIRCUIT_URLS: CircuitURLs = {
  register: { wasm: circuitUrl("registration", "wasm"), zkey: circuitUrl("registration", "zkey") },
  transfer: { wasm: circuitUrl("transfer", "wasm"), zkey: circuitUrl("transfer", "zkey") },
  mint: { wasm: circuitUrl("mint", "wasm"), zkey: circuitUrl("mint", "zkey") },
  withdraw: { wasm: circuitUrl("withdraw", "wasm"), zkey: circuitUrl("withdraw", "zkey") },
  burn: { wasm: circuitUrl("burn", "wasm"), zkey: circuitUrl("burn", "zkey") },
};

// A fresh self-custody wallet holds no AVAX, so its first eERC register() would
// revert on gas. Ask the testnet faucet (proxied at /api/faucet) to drip a little
// gas + USDC, then wait for it to land. The faucet is balance-gated and
// rate-limited server-side, so importing an already-funded key is a no-op.
const FAUCET_MIN_GAS_WEI = 10_000_000_000_000_000n; // 0.01 AVAX

export async function ensureGasFunded(address: Address): Promise<void> {
  const client = getPublicClient();
  if ((await client.getBalance({ address })) >= FAUCET_MIN_GAS_WEI) return;
  try {
    await fetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
  } catch {
    // Faucet unreachable — fall through; register() will surface a clear error.
  }
  for (let i = 0; i < 20; i++) {
    if ((await client.getBalance({ address })) >= FAUCET_MIN_GAS_WEI) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export function createViemClients(account: BenzoAccount) {
  const viemAccount = privateKeyToAccount(account.evmPrivateKey);
  return {
    publicClient: createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL, { retryCount: 5, retryDelay: 800, timeout: 25_000 }) }),
    walletClient: createWalletClient({
      account: viemAccount,
      chain: ACTIVE_CHAIN,
      transport: http(RPC_URL, { retryCount: 5, retryDelay: 800, timeout: 25_000 }),
    }),
  };
}

// Account-independent read client shared by on-chain reads (e.g. @handle
// resolution) that don't need a signer. Memoized per active chain so we reuse a
// single RPC transport, but rebuilt when the user switches networks (ACTIVE_CHAIN
// is a live binding, so a changed chain id invalidates the cache).
let sharedPublicClient: PublicClient | null = null;
let sharedPublicClientChainId: number | null = null;
export function getPublicClient(): PublicClient {
  if (!sharedPublicClient || sharedPublicClientChainId !== ACTIVE_CHAIN.id) {
    sharedPublicClient = createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL, { retryCount: 5, retryDelay: 800, timeout: 25_000 }) });
    sharedPublicClientChainId = ACTIVE_CHAIN.id;
  }
  return sharedPublicClient;
}

// The eERC SDK bundles snarkjs + circuit tooling (multi-MB), and is only needed
// once the user performs an encrypted op (balance read / transfer). Load it via
// dynamic import so it stays out of the initial bundle and is fetched on demand.
let eercCtorPromise: Promise<typeof EERC> | null = null;
function loadEERC(): Promise<typeof EERC> {
  if (!eercCtorPromise) {
    eercCtorPromise = import("@avalabs/eerc-sdk")
      .then((m) => m.EERC)
      .catch((err) => {
        // Never cache a rejected import, clear it so the next encrypted op
        // retries instead of being stuck on the same failed load all session.
        eercCtorPromise = null;
        throw err;
      });
  }
  return eercCtorPromise;
}

export async function createEerc(account: BenzoAccount): Promise<EERC | null> {
  if (!ENCRYPTED_ERC_ADDRESS || !REGISTRAR_ADDRESS) return null;
  const EERCClass = await loadEERC();
  const { publicClient, walletClient } = createViemClients(account);
  return new EERCClass(
    publicClient,
    walletClient,
    ENCRYPTED_ERC_ADDRESS,
    REGISTRAR_ADDRESS,
    EERC_CONVERTER_MODE,
    EERC_CIRCUIT_URLS,
    account.eercDecryptionKey,
  );
}

function eercPublicClient(eerc: EERC): PublicClient {
  return (eerc as unknown as { client: PublicClient }).client;
}

export async function readPublicUsdcBalance(account: BenzoAccount): Promise<string | null> {
  if (!USDC_TOKEN_ADDRESS) return null;
  const { publicClient } = createViemClients(account);
  const balance = await publicClient.readContract({
    address: USDC_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  return balance.toString();
}

export async function transferPublicUsdc(
  account: BenzoAccount,
  to: Address,
  amount: bigint,
): Promise<{ txHash: Hex }> {
  if (!USDC_TOKEN_ADDRESS) throw new Error("USDC token is not configured.");
  const { walletClient } = createViemClients(account);
  if (!walletClient.account) throw new Error("Local wallet account is not available.");
  const txHash = await walletClient.writeContract({
    account: walletClient.account,
    address: USDC_TOKEN_ADDRESS,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, amount],
  });
  return { txHash };
}

export async function readEercPrivateBalance(account: BenzoAccount): Promise<string | null> {
  const eerc = await createEerc(account);
  if (!eerc || !ENCRYPTED_ERC_ADDRESS || !USDC_TOKEN_ADDRESS) return null;
  const publicKey = await eerc.fetchPublicKey(account.address);
  if (publicKey[0] === 0n && publicKey[1] === 0n) return "0";
  const result = await eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS,
    abi: eerc.encryptedErcAbi,
    functionName: EERC_CONVERTER_MODE ? "getBalanceFromTokenAddress" : "balanceOf",
    args: EERC_CONVERTER_MODE ? [account.address, USDC_TOKEN_ADDRESS] : [account.address, 0n],
  } as never);
  const [eGCT, , amountPCTs, balancePCT] = result as [
    unknown,
    bigint,
    Array<{ pct: bigint[]; index: bigint }>,
    bigint[],
    bigint,
  ];
  return eerc.calculateTotalBalance(eGCT as never, amountPCTs, balancePCT).toString();
}

export async function registerEercAccount(account: BenzoAccount): Promise<Hex | undefined> {
  const eerc = await createEerc(account);
  if (!eerc) throw new Error("eERC contracts are not configured.");
  return ensureEercRegistered(eerc, account.address);
}

export async function transferPrivateUsdc(
  account: BenzoAccount,
  to: Address,
  amount: bigint,
  message?: string,
): Promise<{ txHash: Hex; provingMs: number }> {
  if (!USDC_TOKEN_ADDRESS) throw new Error("USDC token is not configured.");
  const eerc = await createEerc(account);
  if (!eerc) throw new Error("eERC contracts are not configured.");
  await ensureEercRegistered(eerc, account.address);
  const balance = await readEercBalanceParts(eerc, account.address, USDC_TOKEN_ADDRESS);
  const auditor = await eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS!,
    abi: eerc.encryptedErcAbi,
    functionName: "auditorPublicKey",
    args: [],
  } as never) as bigint[];
  // provingMs wraps the SDK's eERC op, which generates the Groth16 proof
  // (snarkjs) and broadcasts the tx in one call, so it captures the client-side
  // proving cost. It excludes the setup above (registration/balance/auditor
  // reads); the SDK doesn't expose proof-gen separately from the broadcast.
  const proveStartedAt = performance.now();
  const result = await eerc.transfer(
    to,
    amount,
    balance.encryptedBalance,
    balance.decryptedBalance,
    auditor,
    USDC_TOKEN_ADDRESS,
    message,
  );
  return { txHash: result.transactionHash, provingMs: Math.round(performance.now() - proveStartedAt) };
}

export async function shieldPublicUsdc(
  account: BenzoAccount,
  amount: bigint,
  message?: string,
): Promise<{ approvalTxHash?: Hex; registrationTxHash?: Hex; txHash: Hex; provingMs: number }> {
  if (!USDC_TOKEN_ADDRESS) throw new Error("USDC token is not configured.");
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  const eerc = await createEerc(account);
  if (!eerc) throw new Error("eERC contracts are not configured.");
  const publicBalance = await readPublicUsdcBalance(account);
  if (publicBalance == null) throw new Error("Public USDC balance is not available.");
  if (BigInt(publicBalance) < amount) throw new Error("Insufficient public USDC balance.");

  const registrationTxHash = await ensureEercRegistered(eerc, account.address);
  const approvalTxHash = await ensureUsdcAllowance(account, amount);
  // provingMs wraps the deposit proof-gen + broadcast only (see transferPrivateUsdc);
  // the registration + ERC-20 approval above are excluded.
  const proveStartedAt = performance.now();
  let result: Awaited<ReturnType<typeof eerc.deposit>> | undefined;
  for (let attempt = 0; result === undefined; attempt++) {
    try {
      result = await eerc.deposit(amount, USDC_TOKEN_ADDRESS, BigInt(USDC_DECIMALS), message);
    } catch (err) {
      // Fuji's public RPC is load-balanced: the approve above may already be
      // visible on one node while the SDK re-reads the allowance from a lagging
      // one and wrongly throws "Insufficient approval amount!". The allowance IS
      // on-chain, so retry a few times to let the read become consistent.
      if (attempt < 4 && /insufficient approval/i.test((err as Error)?.message ?? "")) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      throw err;
    }
  }
  return { approvalTxHash, registrationTxHash, txHash: result.transactionHash, provingMs: Math.round(performance.now() - proveStartedAt) };
}

export async function unshieldPrivateUsdc(
  account: BenzoAccount,
  amount: bigint,
  message?: string,
): Promise<{ registrationTxHash?: Hex; txHash: Hex; provingMs: number }> {
  if (!USDC_TOKEN_ADDRESS) throw new Error("USDC token is not configured.");
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  const eerc = await createEerc(account);
  if (!eerc) throw new Error("eERC contracts are not configured.");
  const registrationTxHash = await ensureEercRegistered(eerc, account.address);
  const balance = await readEercBalanceParts(eerc, account.address, USDC_TOKEN_ADDRESS);
  if (amount > balance.decryptedBalance) throw new Error(INSUFFICIENT_PRIVATE_USDC_ERROR);
  const auditor = await readAuditorPublicKey(eerc);
  // provingMs wraps the withdraw proof-gen + broadcast only (see transferPrivateUsdc).
  const proveStartedAt = performance.now();
  const result = await eerc.withdraw(
    amount,
    balance.encryptedBalance,
    balance.decryptedBalance,
    auditor,
    USDC_TOKEN_ADDRESS,
    message,
  );
  return { registrationTxHash, txHash: result.transactionHash, provingMs: Math.round(performance.now() - proveStartedAt) };
}

async function ensureEercRegistered(eerc: EERC, address: Address): Promise<Hex | undefined> {
  const publicKey = await eerc.fetchPublicKey(address);
  if (publicKey[0] !== 0n && publicKey[1] !== 0n) return undefined;
  const result = await eerc.register();
  const hash = result.transactionHash as Hex;
  await eercPublicClient(eerc).waitForTransactionReceipt({ hash });
  return hash;
}

async function ensureUsdcAllowance(account: BenzoAccount, amount: bigint): Promise<Hex | undefined> {
  if (!USDC_TOKEN_ADDRESS || !ENCRYPTED_ERC_ADDRESS) throw new Error("USDC/eERC contracts are not configured.");
  const { publicClient, walletClient } = createViemClients(account);
  const allowance = await publicClient.readContract({
    address: USDC_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, ENCRYPTED_ERC_ADDRESS],
  });
  if (allowance >= amount) return undefined;
  const { request } = await publicClient.simulateContract({
    address: USDC_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [ENCRYPTED_ERC_ADDRESS, amount],
    // Use the LOCAL signer account, not the bare address. Passing the address
    // makes viem treat it as a JSON-RPC account, so writeContract falls back to
    // eth_sendTransaction (RPC-side signing) — which public RPCs like Fuji reject
    // ("the method eth_sendTransaction is not available"). The local account
    // signs on-device and submits via eth_sendRawTransaction.
    account: walletClient.account,
  });
  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function readAuditorPublicKey(eerc: EERC): Promise<bigint[]> {
  return eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS!,
    abi: eerc.encryptedErcAbi,
    functionName: "auditorPublicKey",
    args: [],
  } as never) as Promise<bigint[]>;
}

async function readEercBalanceParts(eerc: EERC, address: Address, token: Address): Promise<{
  decryptedBalance: bigint;
  encryptedBalance: bigint[];
}> {
  const result = await eercPublicClient(eerc).readContract({
    address: ENCRYPTED_ERC_ADDRESS!,
    abi: eerc.encryptedErcAbi,
    functionName: EERC_CONVERTER_MODE ? "getBalanceFromTokenAddress" : "balanceOf",
    args: EERC_CONVERTER_MODE ? [address, token] : [address, 0n],
  } as never);
  const [eGCT, , amountPCTs, balancePCT] = result as [
    { c1: { x: bigint; y: bigint }; c2: { x: bigint; y: bigint } },
    bigint,
    Array<{ pct: bigint[]; index: bigint }>,
    bigint[],
    bigint,
  ];
  return {
    decryptedBalance: eerc.calculateTotalBalance(eGCT, amountPCTs, balancePCT),
    encryptedBalance: [eGCT.c1.x, eGCT.c1.y, eGCT.c2.x, eGCT.c2.y],
  };
}

export function usdcBaseUnitsToDisplayUnits(value: bigint): bigint {
  return USDC_DECIMALS === 6 ? value : value / 10n ** BigInt(Math.max(USDC_DECIMALS - 6, 0));
}
