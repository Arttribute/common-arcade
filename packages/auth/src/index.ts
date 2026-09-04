import { z } from 'zod'
import {
  matchIdSchema,
  seatIdSchema,
  sessionIdSchema,
} from '@common-arcade/protocol'

export const actorTypeSchema = z.enum([
  'human',
  'agent',
  'policy',
  'service',
  'referee',
])

export const principalEnvelopeSchema = z
  .object({
    issuer: z.string().url(),
    subject: z.string().min(1).max(200),
    actorType: actorTypeSchema,
    organizationId: z.string().min(1).max(200).optional(),
    workspaceId: z.string().min(1).max(200).optional(),
    actorChain: z.array(z.string().min(1).max(200)).max(16),
    authenticationStrength: z.enum([
      'anonymous',
      'single-factor',
      'mfa',
      'workload',
    ]),
    scopes: z.array(z.string().min(1).max(300)).max(100),
    audience: z.string().min(1).max(300),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    tokenId: z.string().min(8).max(200),
    traceId: z.string().min(1).max(200),
  })
  .strict()
  .refine((value) => value.expiresAt > value.issuedAt, {
    message: 'expiresAt must be later than issuedAt',
    path: ['expiresAt'],
  })

export type ActorType = z.infer<typeof actorTypeSchema>
export type PrincipalEnvelope = z.infer<typeof principalEnvelopeSchema>

export function hasScope(
  principal: Pick<PrincipalEnvelope, 'scopes'>,
  required: string,
): boolean {
  return principal.scopes.includes(required)
}

export function requireScope(
  principal: Pick<PrincipalEnvelope, 'scopes'>,
  required: string,
): void {
  if (!hasScope(principal, required)) {
    throw new AuthorizationError('INSUFFICIENT_SCOPE', required)
  }
}

export class AuthorizationError extends Error {
  constructor(
    readonly code:
      | 'INSUFFICIENT_SCOPE'
      | 'INVALID_TICKET'
      | 'EXPIRED_TICKET'
      | 'TICKET_REPLAYED'
      | 'WRONG_AUDIENCE',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`)
    this.name = 'AuthorizationError'
  }
}

export const realtimeTicketClaimsSchema = z
  .object({
    version: z.literal(1),
    tokenId: z.string().min(8).max(200),
    nonce: z.string().min(8).max(200),
    audience: z.literal('arcade-realtime'),
    mode: z.enum(['control', 'spectate']),
    matchId: matchIdSchema,
    seatId: seatIdSchema.optional(),
    sessionId: sessionIdSchema,
    actorId: z.string().min(1).max(200),
    controllerId: z.string().min(1).max(200).optional(),
    scopes: z.array(z.string().min(1).max(300)).min(1).max(20),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt <= value.issuedAt) {
      context.addIssue({
        code: 'custom',
        message: 'expiresAt must be later than issuedAt',
        path: ['expiresAt'],
      })
    }
    if (value.mode === 'control' && value.seatId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'control tickets require a seatId',
        path: ['seatId'],
      })
    }
  })

export type RealtimeTicketClaims = z.infer<typeof realtimeTicketClaimsSchema>

export interface RealtimeTicketRequest {
  readonly mode: RealtimeTicketClaims['mode']
  readonly matchId: string
  readonly seatId?: string
  readonly sessionId: string
  readonly actorId: string
  readonly controllerId?: string
  readonly scopes: readonly string[]
  readonly ttlSeconds?: number
}

export interface NonceStore {
  consume(nonce: string, expiresAt: number): Promise<boolean>
}

export class InMemoryNonceStore implements NonceStore {
  private readonly consumed = new Map<string, number>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    const now = Math.floor(this.now() / 1000)
    for (const [key, expiry] of this.consumed) {
      if (expiry <= now) this.consumed.delete(key)
    }
    if (this.consumed.has(nonce)) return false
    this.consumed.set(nonce, expiresAt)
    return true
  }
}

export interface LocalTicketAuthorityOptions {
  readonly nonceStore?: NonceStore
  readonly now?: () => number
  readonly maximumTtlSeconds?: number
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)))
}

export class LocalRealtimeTicketAuthority {
  private constructor(
    private readonly key: CryptoKey,
    private readonly nonceStore: NonceStore,
    private readonly now: () => number,
    private readonly maximumTtlSeconds: number,
  ) {}

  static async create(
    secret: Uint8Array,
    options: LocalTicketAuthorityOptions = {},
  ): Promise<LocalRealtimeTicketAuthority> {
    if (secret.byteLength < 32) {
      throw new TypeError('Local ticket secrets must contain at least 32 bytes')
    }
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    )
    const now = options.now ?? (() => Date.now())
    return new LocalRealtimeTicketAuthority(
      key,
      options.nonceStore ?? new InMemoryNonceStore(now),
      now,
      options.maximumTtlSeconds ?? 60,
    )
  }

  async mint(request: RealtimeTicketRequest): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1000)
    const { ttlSeconds = 30, ...ticketRequest } = request
    if (ttlSeconds < 1 || ttlSeconds > this.maximumTtlSeconds) {
      throw new RangeError(
        `Ticket TTL must be between 1 and ${this.maximumTtlSeconds} seconds`,
      )
    }
    const claims = realtimeTicketClaimsSchema.parse({
      ...ticketRequest,
      scopes: [...request.scopes],
      version: 1,
      tokenId: `tok_${crypto.randomUUID()}`,
      nonce: `non_${crypto.randomUUID()}`,
      audience: 'arcade-realtime',
      issuedAt,
      expiresAt: issuedAt + ttlSeconds,
    })
    const header = bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'ART' })),
    )
    const payload = bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify(claims)),
    )
    const signingInput = `${header}.${payload}`
    const signature = await crypto.subtle.sign(
      'HMAC',
      this.key,
      new TextEncoder().encode(signingInput),
    )
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
  }

  async redeem(
    token: string,
    expected: {
      readonly audience: 'arcade-realtime'
      readonly matchId?: string
      readonly seatId?: string
    },
  ): Promise<RealtimeTicketClaims> {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new AuthorizationError('INVALID_TICKET', 'Malformed ticket')
    }
    const [header, payload, encodedSignature] = parts
    if (
      header === undefined ||
      payload === undefined ||
      encodedSignature === undefined
    ) {
      throw new AuthorizationError('INVALID_TICKET', 'Malformed ticket')
    }

    let signature: Uint8Array<ArrayBuffer>
    try {
      signature = base64UrlToBytes(encodedSignature)
    } catch {
      throw new AuthorizationError('INVALID_TICKET', 'Malformed signature')
    }
    const valid = await crypto.subtle.verify(
      'HMAC',
      this.key,
      signature,
      new TextEncoder().encode(`${header}.${payload}`),
    )
    if (!valid) {
      throw new AuthorizationError(
        'INVALID_TICKET',
        'Signature verification failed',
      )
    }

    let claims: RealtimeTicketClaims
    try {
      const decodedHeader = z
        .object({ alg: z.literal('HS256'), typ: z.literal('ART') })
        .strict()
        .parse(decodeJson(header))
      void decodedHeader
      claims = realtimeTicketClaimsSchema.parse(decodeJson(payload))
    } catch {
      throw new AuthorizationError(
        'INVALID_TICKET',
        'Ticket claims are invalid',
      )
    }

    const now = Math.floor(this.now() / 1000)
    if (claims.expiresAt <= now || claims.issuedAt > now + 5) {
      throw new AuthorizationError(
        'EXPIRED_TICKET',
        'Ticket is outside its validity window',
      )
    }
    if (claims.audience !== expected.audience) {
      throw new AuthorizationError('WRONG_AUDIENCE', expected.audience)
    }
    if (expected.matchId !== undefined && claims.matchId !== expected.matchId) {
      throw new AuthorizationError('WRONG_AUDIENCE', expected.matchId)
    }
    if (expected.seatId !== undefined && claims.seatId !== expected.seatId) {
      throw new AuthorizationError('WRONG_AUDIENCE', expected.seatId)
    }
    if (!(await this.nonceStore.consume(claims.nonce, claims.expiresAt))) {
      throw new AuthorizationError('TICKET_REPLAYED', claims.nonce)
    }
    return claims
  }
}
