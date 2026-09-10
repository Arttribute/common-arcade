import { describe, it, expect, vi } from 'vitest'
import type { PublicClient, WalletClient, Hex } from 'viem'
import { approvalCall } from '@common-arcade/economy'
import {
  readPendingTransaction,
  submitConfirmedCall,
  walletError,
} from './wallet-transaction'
const address = '0x1111111111111111111111111111111111111111' as const
const token = '0x2222222222222222222222222222222222222222' as const
const hash = `0x${'a'.repeat(64)}` as Hex
const deployment = { chainId: 84532, contract: address, token }
function setup() {
  const sendTransaction = vi.fn().mockResolvedValue(hash)
  const waitForTransactionReceipt = vi
    .fn()
    .mockResolvedValue({ status: 'success' })
  const wallet = {
    account: { address },
    chain: { id: 84532 },
    getChainId: async () => 84532,
    sendTransaction,
  } as unknown as WalletClient
  const reader = {
    getChainId: async () => 84532,
    call: vi.fn().mockResolvedValue({}),
    waitForTransactionReceipt,
  } as unknown as PublicClient
  const update = vi.fn()
  const submit = () =>
    submitConfirmedCall({
      deployment,
      wallet,
      reader,
      call: approvalCall(deployment, 1000000n),
      label: 'USDC allowance',
      update,
    })
  return {
    submit,
    sendTransaction,
    waitForTransactionReceipt,
    update,
    wallet,
    reader,
  }
}
describe('human wallet transaction lifecycle', () => {
  it('records submission before receipt and only then confirms', async () => {
    const s = setup()
    await s.submit()
    expect(s.sendTransaction).toHaveBeenCalledOnce()
    expect(s.update.mock.calls[0]?.[0]).toMatchObject({
      hash,
      chainId: 84532,
      address,
    })
    expect(s.update.mock.calls[1]?.[0]).toBeUndefined()
    expect(s.update.mock.calls[1]?.[1]).toBe('USDC allowance confirmed.')
  })
  it('retains a timed-out transaction and never retries the broadcast', async () => {
    const s = setup()
    s.waitForTransactionReceipt.mockRejectedValue(new Error('RPC timeout'))
    await expect(s.submit()).rejects.toThrow('RPC timeout')
    expect(s.update.mock.calls.at(-1)?.[0]).toMatchObject({ hash })
    expect(s.sendTransaction).toHaveBeenCalledOnce()
  })
  it('clears a known revert without claiming success', async () => {
    const s = setup()
    s.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' })
    await expect(s.submit()).rejects.toThrow('Transaction reverted')
    expect(s.update.mock.calls.at(-1)?.[0]).toBeUndefined()
    expect(s.update.mock.calls.at(-1)?.[1]).toContain('reverted')
  })
  it('does not record a broadcast when the user declines', async () => {
    const s = setup(),
      rejected = Object.assign(new Error('Denied'), { code: 4001 })
    s.sendTransaction.mockRejectedValue(rejected)
    await expect(s.submit()).rejects.toThrow('Denied')
    expect(s.update).not.toHaveBeenCalled()
    expect(walletError({ cause: rejected })).toContain('You declined')
  })
  it('rejects wrong-network calls before requesting a transaction', async () => {
    const s = setup()
    s.wallet.getChainId = async () => 1
    await expect(s.submit()).rejects.toThrow('chain mismatch')
    expect(s.sendTransaction).not.toHaveBeenCalled()
  })
  it('does not report a wallet cancellation as a successful payment', async () => {
    const s = setup(),
      replacementHash = `0x${'b'.repeat(64)}` as Hex
    s.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({
        reason: 'cancelled',
        transactionReceipt: { transactionHash: replacementHash },
      })
      return { status: 'success' }
    })
    await expect(s.submit()).rejects.toThrow('cancelled or replaced')
    expect(s.update.mock.calls.at(-1)?.[0]).toBeUndefined()
    expect(s.update.mock.calls.at(-1)?.[1]).toContain('cancelled or replaced')
    expect(s.sendTransaction).toHaveBeenCalledOnce()
  })
  it('tracks the actual confirmed hash when a user speeds up a transaction', async () => {
    const s = setup(),
      replacementHash = `0x${'c'.repeat(64)}` as Hex
    s.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({
        reason: 'repriced',
        transactionReceipt: { transactionHash: replacementHash },
      })
      return { status: 'success' }
    })
    expect(await s.submit()).toBe(replacementHash)
    expect(s.update.mock.calls[1]?.[0]).toMatchObject({ hash: replacementHash })
    expect(s.update.mock.calls.at(-1)?.[1]).toBe('USDC allowance confirmed.')
  })
  it('reads only well-formed pending hashes from storage', () => {
    expect(readPendingTransaction('null')).toBeUndefined()
    expect(readPendingTransaction('oops')).toBeUndefined()
    expect(
      readPendingTransaction(
        JSON.stringify({ hash, chainId: 84532, address, label: 'Stake' }),
      ),
    ).toMatchObject({ hash })
    expect(
      readPendingTransaction(
        JSON.stringify({ hash: 'bad', chainId: 1, address, label: 'Stake' }),
      ),
    ).toBeUndefined()
  })
})
