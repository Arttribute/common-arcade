import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const MATCH_ID = ethers.encodeBytes32String('match-1')
const SEAT_A = ethers.encodeBytes32String('seat-a')
const SEAT_B = ethers.encodeBytes32String('seat-b')

async function deployFixture() {
  const signers = await ethers.getSigners()
  const [arbiter, playerA, playerB, bettorA, bettorB, sponsor] = signers
  if (!arbiter || !playerA || !playerB || !bettorA || !bettorB || !sponsor) {
    throw new Error('Expected at least 6 funded local signers')
  }
  const MatchEscrow = await ethers.getContractFactory('MatchEscrow')
  const escrow = await MatchEscrow.deploy(arbiter.address)
  return { escrow, arbiter, playerA, playerB, bettorA, bettorB, sponsor }
}

describe('MatchEscrow', () => {
  it('rejects a zero-address arbiter', async () => {
    const MatchEscrow = await ethers.getContractFactory('MatchEscrow')
    await expect(
      MatchEscrow.deploy(ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(MatchEscrow, 'ZeroArbiter')
  })

  it('pays the winning staker their stake, the loser stake, and the bounty on settle', async () => {
    const { escrow, arbiter, playerA, playerB, sponsor } =
      await loadFixture(deployFixture)

    await escrow
      .connect(playerA)
      .stake(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') })
    await escrow
      .connect(playerB)
      .stake(MATCH_ID, SEAT_B, { value: ethers.parseEther('1') })
    await escrow
      .connect(sponsor)
      .fundBounty(MATCH_ID, { value: ethers.parseEther('0.5') })

    await escrow.connect(arbiter).settle(MATCH_ID, SEAT_A)

    const owed = await escrow.pendingWithdrawals(playerA.address)
    expect(owed).to.equal(ethers.parseEther('2.5')) // own stake + loser stake + bounty

    await expect(escrow.connect(playerA).withdraw()).to.changeEtherBalance(
      playerA,
      ethers.parseEther('2.5'),
    )
  })

  it('rejects settle from a non-arbiter', async () => {
    const { escrow, playerA } = await loadFixture(deployFixture)
    await escrow
      .connect(playerA)
      .stake(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') })
    await expect(
      escrow.connect(playerA).settle(MATCH_ID, SEAT_A),
    ).to.be.revertedWithCustomError(escrow, 'NotArbiter')
  })

  it('splits the losing bet pool pro rata among winning bettors', async () => {
    const { escrow, arbiter, playerA, playerB, bettorA, bettorB } =
      await loadFixture(deployFixture)

    await escrow
      .connect(playerA)
      .stake(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') })
    await escrow
      .connect(playerB)
      .stake(MATCH_ID, SEAT_B, { value: ethers.parseEther('1') })
    // bettorA backs the winner with 1 HBAR, bettorB backs the loser with 2 HBAR.
    await escrow
      .connect(bettorA)
      .placeBet(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') })
    await escrow
      .connect(bettorB)
      .placeBet(MATCH_ID, SEAT_B, { value: ethers.parseEther('2') })

    await escrow.connect(arbiter).settle(MATCH_ID, SEAT_A)

    // bettorA gets their 1 HBAR back plus the entire 2 HBAR losing pool.
    await expect(
      escrow.connect(bettorA).claimBetWinnings(MATCH_ID),
    ).to.changeEtherBalance(bettorA, ethers.parseEther('3'))
    // bettorB backed the loser and has nothing to claim.
    await expect(
      escrow.connect(bettorB).claimBetWinnings(MATCH_ID),
    ).to.be.revertedWithCustomError(escrow, 'DidNotBackWinner')
  })

  it('refunds every staker and bettor exactly what they put in when voided', async () => {
    const { escrow, arbiter, playerA, playerB, bettorA } =
      await loadFixture(deployFixture)

    await escrow
      .connect(playerA)
      .stake(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') })
    await escrow
      .connect(playerB)
      .stake(MATCH_ID, SEAT_B, { value: ethers.parseEther('1') })
    await escrow
      .connect(bettorA)
      .placeBet(MATCH_ID, SEAT_A, { value: ethers.parseEther('0.3') })

    await escrow.connect(arbiter).voidMatch(MATCH_ID)

    await expect(escrow.connect(playerA).withdraw()).to.changeEtherBalance(
      playerA,
      ethers.parseEther('1'),
    )
    await expect(
      escrow.connect(bettorA).claimBetWinnings(MATCH_ID),
    ).to.changeEtherBalance(bettorA, ethers.parseEther('0.3'))
  })

  it('rejects a second stake on an already-staked seat', async () => {
    const { escrow, playerA, playerB } = await loadFixture(deployFixture)
    await escrow
      .connect(playerA)
      .stake(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') })
    await expect(
      escrow
        .connect(playerB)
        .stake(MATCH_ID, SEAT_A, { value: ethers.parseEther('1') }),
    ).to.be.revertedWithCustomError(escrow, 'SeatAlreadyStaked')
  })
})
