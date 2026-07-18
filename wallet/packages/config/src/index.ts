import { defineChain, type Address } from "viem";

// TODO(@benzo/config): replace this vendored slice with the published package
// from Miny-Labs/benzo once it is available to this frontend workspace.
export const FUJI_CHAIN_ID = 43_113;
export const BENZONET_CHAIN_ID = 68_420;
export const AVALANCHE_CHAIN_ID = 43_114;
export const BENZONET_BLOCKCHAIN_ID =
  "21iisL1nkpM2AauUadAz7p1gK3waRBZLEJme3LU3gsWpaxy792";
export const BENZONET_RPC_PATH = `/ext/bc/${BENZONET_BLOCKCHAIN_ID}/rpc`;
export const BENZONET_LOCAL_RPC_URL = `http://127.0.0.1:9650${BENZONET_RPC_PATH}`;

export const fuji = defineChain({
  id: FUJI_CHAIN_ID,
  name: "Avalanche Fuji",
  nativeCurrency: {
    decimals: 18,
    name: "Avalanche Fuji AVAX",
    symbol: "AVAX",
  },
  rpcUrls: {
    default: {
      http: ["https://api.avax-test.network/ext/bc/C/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "Snowtrace",
      url: "https://testnet.snowtrace.io",
    },
  },
  testnet: true,
});

export const avalanche = defineChain({
  id: AVALANCHE_CHAIN_ID,
  name: "Avalanche",
  nativeCurrency: {
    decimals: 18,
    name: "Avalanche AVAX",
    symbol: "AVAX",
  },
  rpcUrls: {
    default: {
      http: ["https://api.avax.network/ext/bc/C/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "Snowtrace",
      url: "https://snowtrace.io",
    },
  },
});

export const benzonet = defineChain({
  id: BENZONET_CHAIN_ID,
  name: "BenzoNet",
  nativeCurrency: {
    decimals: 18,
    name: "Benzo Gas",
    symbol: "BGAS",
  },
  rpcUrls: {
    default: {
      http: [BENZONET_LOCAL_RPC_URL],
    },
  },
  testnet: true,
});

export const benzoChains = [fuji, benzonet, avalanche] as const;

export const DEPLOYMENT_NETWORKS = ["fuji", "benzonet", "avalanche"] as const;
export type DeploymentNetwork = (typeof DEPLOYMENT_NETWORKS)[number];
export type DeploymentChainId =
  | typeof FUJI_CHAIN_ID
  | typeof BENZONET_CHAIN_ID
  | typeof AVALANCHE_CHAIN_ID;
export type CircuitOperation = "registration" | "transfer" | "mint" | "withdraw" | "burn";
export type VerifierDeployments = Record<CircuitOperation, Address>;

export type DeploymentContracts = {
  verifiers: VerifierDeployments;
  Registrar?: Address;
  EncryptedERC?: Address;
  tUSDC?: Address;
  HandleRegistry?: Address;
  PrivateGiftEscrow?: Address;
  InvoiceRegistry?: Address;
  GiftEscrow?: Address;
};

export type Deployments = {
  network: DeploymentNetwork;
  chainId: DeploymentChainId;
  contracts: DeploymentContracts;
};

export const fujiDeployments = {
  network: "fuji",
  chainId: FUJI_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x4250bD1eb89Ef78469f94da2fE7738DCdcb09Ef7",
      transfer: "0x4bF3DBD3fF57943dC402ec1F280589E1032A32A5",
      mint: "0x0fE395F5E97Ee02c961DE3d035E5De2D9019D15E",
      withdraw: "0x7E194cb8A575d23f74EEDbEf1b519B281B29c30e",
      burn: "0x1BDfD6cB772D5F882622BaFD7B19898Da9F61d34",
    },
    Registrar: "0x9a63FEa9851097DBAf3757b636217fdde50ABaF0",
    EncryptedERC: "0x9E16eD3B799541B4929f7E2014904C65E81035b1",
    tUSDC: "0x5425890298aed601595a70AB815c96711a31Bc65",
    HandleRegistry: "0xC74EcCDE4D9A1F48D560de9A96521D28D58B474b",
    PrivateGiftEscrow: "0x0B1f4e78C54E7696663b62F9cD7956f5FDE5b71d",
  },
} as const satisfies Deployments;

export const benzonetDeployments = {
  network: "benzonet",
  chainId: BENZONET_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x9a63FEa9851097DBAf3757b636217fdde50ABaF0",
      transfer: "0xa1d0f50D5f479a2aeC3C67A38a6fa5c735CcC313",
      mint: "0x1226C73Bd8022080b8DbCDC24AA8B61D659A835f",
      withdraw: "0x46688f1704a69a6c276cCCB823E36C80787B0FA2",
      burn: "0x992014C9De921CC064Ea6BC03849aea638b86Fd1",
    },
    Registrar: "0xdfB9b7d958539FC4A1e31C9b813833Fb972B30Ff",
    EncryptedERC: "0x790Dd53099E5009a9Cf572769a5A663cCb7EfAcE",
    tUSDC: "0x85546bE3564d503F6ED77a4DA44BEF32EcAEd034",
  },
} as const satisfies Deployments;

export const avalancheDeployments = {
  network: "avalanche",
  chainId: AVALANCHE_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x35b4C4227082f67c01656A39aC47F6c5D6005CaA",
      transfer: "0x4A716026a0C1F7158165520B6DF2009fFeB79f01",
      mint: "0xb0ea11Bf58ad83F1027E476cbA7B8E196Cc0C972",
      withdraw: "0xDf3caC632d70365cEb5CD1DD72E5de741936fdb7",
      burn: "0xCb59d38DA7F1E4cA11BfFa6BEd383624fa49bc3d",
    },
    Registrar: "0x902B8D5585A5124C9B9c001A95b7f520C07a79F2",
    EncryptedERC: "0x708d0b83461973F46041a36f588b8760dbC0Db0e",
    tUSDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    PrivateGiftEscrow: "0xb22c366e000165683A51C2630F6Ab818e5227C94",
  },
} as const satisfies Deployments;

export const deploymentsByNetwork: Record<DeploymentNetwork, Deployments> = {
  fuji: fujiDeployments,
  benzonet: benzonetDeployments,
  avalanche: avalancheDeployments,
};
