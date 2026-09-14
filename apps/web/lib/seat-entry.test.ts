import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWalletClient, http, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import {
  decodeX402Header,
  encodeX402Header,
  entryRequirements,
  transferAuthorizationTypedData,
  type EntryRequirements,
} from '@common-arcade/economy'

vi.mock('./paid-session', () => ({ paymentService: 'https://pay.test' }))
const { enterSeat } = await import('./seat-entry')

const player = privateKeyToAccount(`0x${'0a'.repeat(32)}`)
const wallet = createWalletClient({
  account: player,
  chain: baseSepolia,
  transport: http('http://127.0.0.1:1'),
})
const deployment = {
  chainId: 84532,
  contract: '0x00000000000000000000000000000000000000E5' as const,
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
  authorizedEntry: true,
}
const entry = {
  path: '/v1/economy/matches/mat_1/entry',
  method: 'x402' as const,
  network: 'eip155:84532',
  asset: deployment.token,
  payTo: deployment.contract,
  amount: '1000000',
}
const challenge = (requirements: EntryRequirements) =>
  new Response('{}', {
    status: 402,
    headers: {
      'PAYMENT-REQUIRED': encodeX402Header({
        x402Version: 2,
        accepts: [requirements],
      }),
    },
  })
afterEach(() => vi.unstubAllGlobals())

describe('enterSeat', () => {
  it('pays a quoted stake with one signed transfer to the table escrow', async () => {
    const calls: { headers: Record<string, string>; body: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>
        calls.push({ headers, body: JSON.parse(String(init.body)) })
        return headers['PAYMENT-SIGNATURE']
          ? Response.json({ seat: 2, player: player.address })
          : challenge(entryRequirements(deployment, '1000000'))
      }),
    )
    const progress: string[] = []
    const result = await enterSeat({
      matchId: 'mat_1',
      entry,
      deployment,
      stakeUnits: '1000000',
      wallet,
      seat: 1,
      controller: '0x00000000000000000000000000000000000000c0',
      onProgress: (message) => progress.push(message),
    })
    expect(result.seat).toBe(2)
    expect(calls[1]!.body).toEqual({
      seat: 2,
      controller: '0x00000000000000000000000000000000000000c0',
    })
    const payment = decodeX402Header<{
      accepted: EntryRequirements
      payload: {
        authorization: {
          from: `0x${string}`
          to: `0x${string}`
          value: string
          validAfter: string
          validBefore: string
          nonce: `0x${string}`
        }
        signature: `0x${string}`
      }
    }>(calls[1]!.headers['PAYMENT-SIGNATURE']!)
    expect(payment.payload.authorization).toMatchObject({
      from: player.address,
      to: deployment.contract,
      value: '1000000',
    })
    expect(
      await recoverTypedDataAddress({
        ...transferAuthorizationTypedData(
          payment.accepted,
          payment.payload.authorization,
        ),
        signature: payment.payload.signature,
      }),
    ).toBe(player.address)
    expect(progress.join(' ')).toContain('no network fee')
  })

  it('refuses to sign a quote for a different recipient or amount', async () => {
    for (const quote of [
      {
        ...entryRequirements(deployment, '1000000'),
        payTo: '0x00000000000000000000000000000000000bad00' as const,
      },
      entryRequirements(deployment, '9000000'),
    ]) {
      const sign = vi.spyOn(wallet, 'signTypedData')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => challenge(quote)),
      )
      await expect(
        enterSeat({
          matchId: 'mat_1',
          entry,
          deployment,
          stakeUnits: '1000000',
          wallet,
          seat: 0,
          controller: player.address,
          onProgress: () => {},
        }),
      ).rejects.toThrow('does not match this game')
      expect(sign).not.toHaveBeenCalled()
      sign.mockRestore()
    }
  })

  it('takes a sponsored seat with a signed entry request', async () => {
    let sent: { auth?: { address: string } } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body))
        return Response.json({ seat: 1, player: player.address })
      }),
    )
    await enterSeat({
      matchId: 'mat_1',
      entry: { ...entry, method: 'signed-command', amount: '0' },
      deployment,
      stakeUnits: '0',
      wallet,
      seat: 0,
      controller: player.address,
      onProgress: () => {},
    })
    expect(sent.auth?.address).toBe(player.address)
  })
})
