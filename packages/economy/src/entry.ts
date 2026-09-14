import { getAddress, parseSignature, type Address, type Hex } from 'viem'
import { z } from 'zod'
import type { EscrowDeployment } from './chain.js'

/** Seat entry payment window. Long enough for one confirmed relay, short enough to bound a stale signature. */
export const ENTRY_TIMEOUT_SECONDS = 120

/** x402 v2 `exact` requirements for paying a seat stake straight into the escrow. */
export interface EntryRequirements {
  scheme: 'exact'
  network: `${string}:${string}`
  asset: Address
  amount: string
  payTo: Address
  maxTimeoutSeconds: number
  extra: { name: 'USDC'; version: '2' }
}

export function entryRequirements(
  deployment: EscrowDeployment,
  stakeUnits: string,
): EntryRequirements {
  // The signature domain is the escrow's actual chain, which is also its CAIP-2 network.
  return {
    scheme: 'exact',
    network: `eip155:${deployment.chainId}`,
    asset: getAddress(deployment.token),
    amount: stakeUnits,
    payTo: getAddress(deployment.contract),
    maxTimeoutSeconds: ENTRY_TIMEOUT_SECONDS,
    extra: { name: 'USDC', version: '2' },
  }
}

export const transferAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export interface TransferAuthorization {
  from: Address
  to: Address
  value: string
  validAfter: string
  validBefore: string
  nonce: Hex
}

/** EIP-712 data a wallet signs for an x402 `exact` EIP-3009 payment. */
export function transferAuthorizationTypedData(
  requirements: EntryRequirements,
  authorization: TransferAuthorization,
) {
  return {
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId: Number(requirements.network.split(':')[1]),
      verifyingContract: requirements.asset,
    },
    types: transferAuthorizationTypes,
    primaryType: 'TransferWithAuthorization' as const,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  }
}

const hex = (bytes: number) =>
  z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`))
const units = z.string().regex(/^(0|[1-9]\d{0,77})$/)
export const entryPaymentSchema = z.object({
  x402Version: z.literal(2),
  accepted: z.object({
    scheme: z.literal('exact'),
    network: z.string(),
    asset: hex(20),
    amount: units,
    payTo: hex(20),
    maxTimeoutSeconds: z.number().int(),
  }),
  payload: z.object({
    authorization: z.object({
      from: hex(20),
      to: hex(20),
      value: units,
      validAfter: units,
      validBefore: units,
      nonce: hex(32),
    }),
    signature: hex(65),
  }),
})
export type EntryPayment = z.infer<typeof entryPaymentSchema>

/** Contract argument for `stakeWithAuthorization`. EOA signatures only. */
export function escrowAuthorization(payment: EntryPayment) {
  const { authorization, signature } = payment.payload
  const { r, s, v, yParity } = parseSignature(signature as Hex)
  return {
    from: getAddress(authorization.from),
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce as Hex,
    v: Number(v ?? BigInt(yParity + 27)),
    r,
    s,
  }
}

/** base64(JSON), the x402 v2 header encoding, without Node Buffer. */
export function encodeX402Header(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
export function decodeX402Header<T = unknown>(header: string): T {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(header) || header.length > 16384)
    throw new Error('Invalid x402 header')
  const binary = atob(header)
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    ),
  ) as T
}
