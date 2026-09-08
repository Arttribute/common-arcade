import type { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'

// Hedera's Smart Contract Service is reached through its EVM JSON-RPC relay,
// so standard Hardhat + ethers works unmodified — no Hedera-specific plugin
// is needed to compile, test, or deploy this contract.
//
// Hardhat 2.x's own config/CLI loading is CommonJS-only; this file uses the
// .cts extension so Node loads it as CommonJS regardless of this package's
// "type": "module" (see https://v2.hardhat.org/HH19).
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hederaTestnet: {
      url:
        process.env.HEDERA_TESTNET_RPC_URL ?? 'https://testnet.hashio.io/api',
      chainId: 296,
      accounts: process.env.HEDERA_OPERATOR_PRIVATE_KEY
        ? [process.env.HEDERA_OPERATOR_PRIVATE_KEY]
        : [],
    },
  },
}

export default config
