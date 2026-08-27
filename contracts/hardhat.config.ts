import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      // The optimizer was previously unset (i.e. off), which both inflated
      // deployment cost and pushed FluenciRegistryV4 past the EVM stack limit.
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    qieTestnet: {
      url: "https://rpc4testnet.qie.digital/",
      chainId: 1983,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 1_500_000_000, // 1.5 Gwei - QIE RPC returns wrong gas price (7 wei), real txs use ~1.5 Gwei
    },
    qieMainnet: {
      url: "https://rpc1mainnet.qie.digital",
      chainId: 1990,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 1_500_000_000, // 1.5 Gwei
    }
  },
  etherscan: {
    apiKey: {
      'qieMainnet': 'abc'
    },
    customChains: [
      {
        network: "qieMainnet",
        chainId: 1990,
        urls: {
          apiURL: "https://mainnet.qie.digital/api",
          browserURL: "https://mainnet.qie.digital"
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  }
};

export default config;
