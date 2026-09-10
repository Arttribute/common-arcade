# Arcade escrow

Run `bash packages/contracts/setup.sh` from the repository root, then
`pnpm --filter @common-arcade/contracts test`. Foundry v1.5.1, Solidity 0.8.24,
OpenZeppelin 5.0.2, Safe 1.4.1 and forge-std 1.9.7 are pinned. Dependencies,
broadcasts and generated build output are ignored. `TestUSDC` only deploys on
local chain 31337; public testnets use their canonical USDC.

The contract supports single-winner stakes, sponsor bounties, spectator pools,
fees and contributor refunds. The allowlisted resolver attests results; the
contract does not prove game execution. A Safe owns token/resolver controls,
emergency pause and fees. There is no upgrade or administrator sweep.

Deployment and Safe batch instructions: [runbook](../../docs/payments/runbook.md).
Regenerate the TypeScript ABI after Solidity changes using
`node scripts/export-escrow-abi.mjs` from the root.
