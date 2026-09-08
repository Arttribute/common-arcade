import { defineConfig } from 'vitest/config'

// `test/` holds the Solidity contract's Hardhat/Mocha suite (run with
// `pnpm contracts:test`), which vitest must not try to collect.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
