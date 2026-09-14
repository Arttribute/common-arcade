import { toHex, type Address, type Hex, type WalletClient } from 'viem'
import {
  decodeX402Header,
  encodeX402Header,
  transferAuthorizationTypedData,
  type EntryRequirements,
  type EscrowDeployment,
} from '@common-arcade/economy'
import { paymentService } from './paid-session'

/** How a table advertises gasless entry. Mirrors the payment service's entry descriptor. */
export interface SeatEntry {
  path: string
  method: 'x402' | 'signed-command'
  network: string
  asset: Address
  payTo: Address
  amount: string
}

/**
 * Takes a seat with one wallet signature and no network fee. A paid seat is an x402 request:
 * the wallet signs a USDC transfer of exactly the stake to this game's escrow, and the game
 * service relays it. A sponsored seat signs an entry request instead. The signing wallet owns
 * the seat, refunds and winnings; `controller` is only allowed to play.
 */
export async function enterSeat(input: {
  matchId: string
  entry: SeatEntry
  deployment: EscrowDeployment
  stakeUnits: string
  wallet: WalletClient
  seat: number
  controller: Address
  onProgress: (message: string) => void
}) {
  const { entry, deployment, wallet, onProgress } = input
  if (!wallet.account) throw new Error('Connect a wallet to continue')
  if (!paymentService) throw new Error('Paid sessions are unavailable')
  const url = `${paymentService}${entry.path}`
  const body = { seat: input.seat + 1, controller: input.controller }
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    })
  let response: Response
  if (entry.method === 'signed-command') {
    onProgress('Confirm your seat in your wallet…')
    const expiresAt = Date.now() + 60000
    const signature = await wallet.signMessage({
      account: wallet.account,
      message: JSON.stringify({
        domain: paymentService,
        matchId: input.matchId,
        operation: 'entry',
        body,
        expiresAt,
      }),
    })
    response = await post({
      ...body,
      auth: { address: wallet.account.address, expiresAt, signature },
    })
  } else {
    response = await post(body)
    if (response.status === 402) {
      const challenge = response.headers.get('PAYMENT-REQUIRED')
      if (!challenge) throw new Error('The game did not quote a seat price')
      const [requirements] = decodeX402Header<{
        accepts: EntryRequirements[]
      }>(challenge).accepts
      // Sign only a transfer of this table's stake to this table's escrow.
      if (
        !requirements ||
        requirements.scheme !== 'exact' ||
        requirements.network !== `eip155:${deployment.chainId}` ||
        requirements.payTo.toLowerCase() !==
          deployment.contract.toLowerCase() ||
        requirements.asset.toLowerCase() !== deployment.token.toLowerCase() ||
        requirements.amount !== input.stakeUnits
      )
        throw new Error('The seat price does not match this game')
      const authorization = {
        from: wallet.account.address,
        to: requirements.payTo,
        value: requirements.amount,
        validAfter: '0',
        validBefore: String(
          Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds,
        ),
        nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex,
      }
      onProgress(
        'Approve the seat payment in your wallet. There is no network fee.',
      )
      const signature = await wallet.signTypedData({
        account: wallet.account,
        ...transferAuthorizationTypedData(requirements, authorization),
      })
      onProgress('Taking your seat…')
      response = await post(body, {
        'PAYMENT-SIGNATURE': encodeX402Header({
          x402Version: 2,
          accepted: requirements,
          payload: { authorization, signature },
        }),
      })
    }
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(
      result.error === 'insufficient_funds'
        ? 'This wallet does not have enough test USDC for the entry.'
        : (result.error ?? 'Could not take this seat'),
    )
  return result as {
    seat: number
    player: Address
    controller: Address
    transaction?: Hex
  }
}
