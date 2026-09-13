import { expect, it, vi } from 'vitest'
import { escrowCall, hashArcadeId } from '@common-arcade/economy'
import { submitSeatPayment } from './seat-payment'

function fixture(allowance = 0n, atomic = true) {
  const hash = `0x${'1'.repeat(64)}` as const
  const deployment = {
    chainId: 84532,
    contract: `0x${'2'.repeat(40)}` as const,
    token: `0x${'3'.repeat(40)}` as const,
  }
  const wallet = {
    account: { address: `0x${'4'.repeat(40)}` },
    chain: { id: 84532 },
    getChainId: vi.fn(async () => 84532),
    getCapabilities: vi.fn(async () => ({
      atomic: { status: atomic ? 'supported' : 'unsupported' },
    })),
    sendCalls: vi.fn(async (_input: unknown) => ({ id: crypto.randomUUID() })),
    waitForCallsStatus: vi.fn(async () => ({
      status: 'success',
      receipts: [{ transactionHash: hash }],
    })),
    sendTransaction: vi.fn(async () => hash),
  }
  const reader = {
    getChainId: vi.fn(async () => 84532),
    readContract: vi.fn(async () => allowance),
    call: vi.fn(async () => ({})),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
  }
  const input = {
    deployment,
    wallet: wallet as never,
    reader: reader as never,
    call: escrowCall(deployment, 'bet', hashArcadeId(crypto.randomUUID()), {
      seat: hashArcadeId('sea_player_1'),
      amount: 1000000n,
    }),
    amount: 1000000n,
    onProgress: vi.fn(),
  }
  return { input, wallet, reader, hash }
}
it('batches the exact allowance and deposit into one wallet confirmation', async () => {
  const f = fixture()
  expect(await submitSeatPayment(f.input)).toBe(f.hash)
  expect(f.wallet.sendCalls).toHaveBeenCalledOnce()
  expect(f.wallet.sendCalls.mock.calls[0]?.[0]).toMatchObject({
    forceAtomic: true,
    calls: [
      { to: f.input.deployment.token },
      { to: f.input.deployment.contract },
    ],
  })
  expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
})
it('uses an existing allowance without asking for another approval', async () => {
  const f = fixture(1000000n)
  await submitSeatPayment(f.input)
  expect(f.wallet.sendTransaction).toHaveBeenCalledOnce()
  expect(f.wallet.sendCalls).not.toHaveBeenCalled()
})
it('never falls back to extra transactions after a rejected batch', async () => {
  const f = fixture()
  f.wallet.sendCalls.mockRejectedValueOnce(new Error('User rejected'))
  await expect(submitSeatPayment(f.input)).rejects.toThrow('User rejected')
  expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
})
it('reconciles a submitted bet after a timeout without sending a second bet', async () => {
  const f = fixture()
  f.wallet.waitForCallsStatus.mockRejectedValueOnce(new Error('Timed out'))
  await expect(submitSeatPayment(f.input)).rejects.toThrow('Timed out')
  expect(await submitSeatPayment(f.input)).toBe(f.hash)
  expect(f.wallet.sendCalls).toHaveBeenCalledOnce()
  expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
})
it('rejects calls outside the game deployment before prompting a wallet', async () => {
  const f = fixture()
  f.input.call.to = f.input.deployment.token
  await expect(submitSeatPayment(f.input)).rejects.toThrow('does not match')
  expect(f.wallet.sendCalls).not.toHaveBeenCalled()
  expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
})
