import { ethers } from 'hardhat'

/**
 * Deploys MatchEscrow with the Common Arcade platform's own Hedera operator
 * account as the arbiter (never an agent's or player's key — see the
 * contract's NatSpec). Run with:
 *
 *   HEDERA_OPERATOR_PRIVATE_KEY=0x... \
 *   ARCADE_ARBITER_ACCOUNT=0x... \
 *   pnpm --filter @common-arcade/economy-hedera contracts:deploy:testnet
 */
async function main() {
  const arbiter = process.env.ARCADE_ARBITER_ACCOUNT
  if (!arbiter) {
    throw new Error(
      'Set ARCADE_ARBITER_ACCOUNT to the platform operator address (0x...)',
    )
  }

  const MatchEscrow = await ethers.getContractFactory('MatchEscrow')
  const escrow = await MatchEscrow.deploy(arbiter)
  await escrow.waitForDeployment()

  console.log(
    `MatchEscrow deployed to ${await escrow.getAddress()} (arbiter ${arbiter})`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
