import {
  avalanche,
  benzonet,
  BENZONET_LOCAL_RPC_URL,
  deploymentsByNetwork,
  DEPLOYMENT_NETWORKS,
  fuji,
  type Deployments,
  type DeploymentNetwork,
} from "@benzo/config";
import type { Address, Chain } from "viem";

const env = import.meta.env as unknown as Record<string, string | undefined>;

function deploymentNetwork(value: string | undefined): DeploymentNetwork {
  // The consumer wallet only ships the public chains. `benzonet` (the permissioned
  // business L1) is intentionally NOT reachable here, it folds back to Fuji.
  if (value === "avalanche") return value;
  return "fuji";
}

// The network baked in at build time. Env address/RPC overrides only ever apply
// to THIS network, so switching to another network at runtime resolves that
// network's published @benzo/config cluster cleanly (never the env network's
// overrides pointed at the wrong chain).
const ENV_NETWORK = deploymentNetwork(env.VITE_CHAIN_ENV ?? env.VITE_BENZO_NETWORK);

const PRIVATE_GIFT_ESCROW_PLACEHOLDER = "0x0000000000000000000000000000000000000000";
const FUJI_EERC_ACTIVITY_START_BLOCK = "56879304";
const FUJI_CURRENT_EERC_ADDRESS = "0x9e16ed3b799541b4929f7e2014904c65e81035b1";

// Deployment-wide knobs (not per-network), resolved once from env.
export const EERC_CONVERTER_MODE = (env.VITE_EERC_CONVERTER_MODE ?? "true") !== "false";
export const USDC_DECIMALS = Number(env.VITE_USDC_DECIMALS ?? "6");
export const EERC_USDC_TOKEN_ID = BigInt(env.VITE_EERC_USDC_TOKEN_ID ?? "1");
// Fuji's public RPC caps eth_getLogs at 2048 blocks per request (returns -32602,
// which viem surfaces as "Missing or invalid parameters"), so the activity scan
// must window under that. Default 2000; override per-network via env if a chain
// allows wider ranges.
export const EERC_ACTIVITY_LOG_WINDOW_BLOCKS = BigInt(env.VITE_EERC_ACTIVITY_LOG_WINDOW_BLOCKS ?? "2000");

const baseChains: Record<DeploymentNetwork, Chain> = { fuji, benzonet, avalanche };

function rpcFor(network: DeploymentNetwork): string {
  // A per-network RPC env var always wins for its own network; the generic
  // VITE_RPC_URL only applies to the env network so it can't mispoint another.
  const generic = network === ENV_NETWORK ? env.VITE_RPC_URL : undefined;
  if (network === "benzonet") return env.VITE_BENZONET_RPC_URL ?? generic ?? BENZONET_LOCAL_RPC_URL;
  if (network === "avalanche") return env.VITE_AVALANCHE_RPC_URL ?? generic ?? avalanche.rpcUrls.default.http[0];
  return env.VITE_FUJI_RPC_URL ?? generic ?? fuji.rpcUrls.default.http[0];
}

/** Fully resolved, self-contained facts for one network. Pure, no globals. */
export interface NetworkConfig {
  network: DeploymentNetwork;
  chain: Chain;
  chainId: number;
  rpcUrl: string;
  label: string;
  explorerBaseUrl: string;
  deployment: Deployments;
  encryptedErc?: Address;
  registrar?: Address;
  usdc?: Address;
  handleRegistry?: Address;
  privateGiftEscrow: Address;
  verifierId: Address;
  activityStartBlock: bigint;
  usdcAsset: string;
}

export function resolveNetworkConfig(network: DeploymentNetwork): NetworkConfig {
  const deployment = deploymentsByNetwork[network];
  const contracts = deployment.contracts;
  const isEnv = network === ENV_NETWORK;
  const override = (value: string | undefined) => (isEnv ? value : undefined);

  const rpcUrl = rpcFor(network);
  const chain: Chain = { ...baseChains[network], rpcUrls: { default: { http: [rpcUrl] } } };
  // Per-network fallback so a viem chain-def change can't silently point mainnet
  // at the testnet explorer.
  const explorerFallback =
    network === "benzonet"
      ? "https://explorer.benzo.space"
      : network === "avalanche"
        ? "https://snowtrace.io"
        : "https://testnet.snowtrace.io";
  const explorerBaseUrl = chain.blockExplorers?.default.url ?? explorerFallback;

  const encryptedErc = (override(env.VITE_EERC_ENCRYPTED_ERC_ADDRESS) ?? contracts.EncryptedERC) as Address | undefined;
  const usdc = (override(env.VITE_USDC_TOKEN_ADDRESS) ?? contracts.tUSDC) as Address | undefined;

  const activityStartBlock = BigInt(
    override(env.VITE_EERC_ACTIVITY_START_BLOCK) ??
      (network === "fuji" && encryptedErc?.toLowerCase() === FUJI_CURRENT_EERC_ADDRESS
        ? FUJI_EERC_ACTIVITY_START_BLOCK
        : "0"),
  );

  return {
    network,
    chain,
    chainId: deployment.chainId,
    rpcUrl,
    label: chain.name,
    explorerBaseUrl,
    deployment,
    encryptedErc,
    registrar: (override(env.VITE_EERC_REGISTRAR_ADDRESS) ?? contracts.Registrar) as Address | undefined,
    usdc,
    handleRegistry: (override(env.VITE_HANDLE_REGISTRY_ADDRESS) ??
      (contracts as { HandleRegistry?: Address }).HandleRegistry) as Address | undefined,
    // The zero placeholder remains the "not deployed on this network" default so
    // requireGiftEscrowAddress() throws loudly rather than sending to 0x0.
    privateGiftEscrow: (override(env.VITE_PRIVATE_GIFT_ESCROW_ADDRESS) ??
      contracts.PrivateGiftEscrow ??
      PRIVATE_GIFT_ESCROW_PLACEHOLDER) as Address,
    verifierId: contracts.verifiers.transfer,
    activityStartBlock,
    usdcAsset: usdc ?? "USDC",
  };
}

// ----------------------------------------------------------- persisted selection

export const NETWORK_STORAGE_KEY = "benzo.network";

export function isDeploymentNetwork(value: unknown): value is DeploymentNetwork {
  return typeof value === "string" && (DEPLOYMENT_NETWORKS as readonly string[]).includes(value);
}

export function getStoredNetwork(): DeploymentNetwork | null {
  try {
    const raw = globalThis.localStorage?.getItem(NETWORK_STORAGE_KEY);
    // A previously-stored "benzonet" is no longer offered in the wallet, treat it
    // as unset so it falls back to Fuji rather than stranding a user on it.
    return isDeploymentNetwork(raw) && raw !== "benzonet" ? raw : null;
  } catch {
    return null;
  }
}

function persistNetwork(network: DeploymentNetwork): void {
  try {
    globalThis.localStorage?.setItem(NETWORK_STORAGE_KEY, network);
  } catch {
    // Storage unavailable, the selection stays in-memory for this session.
  }
}

// -------------------------------------------------- active network (live bindings)
//
// The active values below are ESM `let` exports, not frozen consts. Consumers
// that read them INSIDE a function (eerc/gift/handle/activity clients, api
// headers) observe every switch automatically via live bindings, so the whole
// client-side balance/transfer path swaps networks without touching those files.
// The two module-init capturers, wagmi.tsx + chain.ts, rebuild explicitly.

let active: NetworkConfig = resolveNetworkConfig(getStoredNetwork() ?? ENV_NETWORK);

export let NETWORK: DeploymentNetwork = active.network;
export let DEPLOYMENT: Deployments = active.deployment;
export let CHAIN_ID: number = active.chainId;
export let RPC_URL: string = active.rpcUrl;
export let ACTIVE_CHAIN: Chain = active.chain;
export let NETWORK_LABEL: string = active.label;
export let EXPLORER_BASE_URL: string = active.explorerBaseUrl;
export let ENCRYPTED_ERC_ADDRESS: Address | undefined = active.encryptedErc;
export let REGISTRAR_ADDRESS: Address | undefined = active.registrar;
export let USDC_TOKEN_ADDRESS: Address | undefined = active.usdc;
export let HANDLE_REGISTRY_ADDRESS: Address | undefined = active.handleRegistry;
export let PRIVATE_GIFT_ESCROW_ADDRESS: Address = active.privateGiftEscrow;
export let VERIFIER_ID: Address = active.verifierId;
export let EERC_ACTIVITY_START_BLOCK: bigint = active.activityStartBlock;
export let USDC_ASSET: string = active.usdcAsset;

const subscribers = new Set<(network: DeploymentNetwork) => void>();

/** Subscribe to network switches. Returns an unsubscribe fn. */
export function subscribeNetwork(fn: (network: DeploymentNetwork) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getActiveNetwork(): DeploymentNetwork {
  return active.network;
}

export function getNetworkConfig(): NetworkConfig {
  return active;
}

/** Switch the active network, persist it, and notify subscribers. No-op if unchanged. */
export function setActiveNetwork(network: DeploymentNetwork): DeploymentNetwork {
  if (!isDeploymentNetwork(network) || network === active.network) return active.network;
  active = resolveNetworkConfig(network);
  NETWORK = active.network;
  DEPLOYMENT = active.deployment;
  CHAIN_ID = active.chainId;
  RPC_URL = active.rpcUrl;
  ACTIVE_CHAIN = active.chain;
  NETWORK_LABEL = active.label;
  EXPLORER_BASE_URL = active.explorerBaseUrl;
  ENCRYPTED_ERC_ADDRESS = active.encryptedErc;
  REGISTRAR_ADDRESS = active.registrar;
  USDC_TOKEN_ADDRESS = active.usdc;
  HANDLE_REGISTRY_ADDRESS = active.handleRegistry;
  PRIVATE_GIFT_ESCROW_ADDRESS = active.privateGiftEscrow;
  VERIFIER_ID = active.verifierId;
  EERC_ACTIVITY_START_BLOCK = active.activityStartBlock;
  USDC_ASSET = active.usdcAsset;
  persistNetwork(network);
  for (const fn of subscribers) fn(network);
  return active.network;
}
