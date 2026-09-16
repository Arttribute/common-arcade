import { AsyncLocalStorage } from 'node:async_hooks'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { DocumentStore, StoredDocument } from './store.js'

export type Principal = {
  id: string
  scopes: string[]
  token: string
  provider: 'commons' | 'api-key' | 'local'
  /** Service subject that is acting for `id`, when the call is delegated. */
  delegatedBy?: string
}
export type AccessKey = StoredDocument & {
  ownerId: string
  name: string
  hash: string
  scopes: string[]
  expiresAt: number
  revoked: boolean
  createdAt: string
}
export class IdentityError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'IdentityError'
  }
}
export const arcadeScopes = [
  'projects:read',
  'projects:write',
  'releases:publish',
  'matches:play',
  'keys:manage',
] as const
export async function tokenHash(token: string) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  ).toString('hex')
}
/**
 * Resolves an opaque Commons OAuth token into verified claims. The gateway
 * performs the introspection, so Arcade never holds the platform's internal
 * secret. A transport failure is reported separately from a rejected
 * credential: telling a signed-in creator to sign in again when the identity
 * service is merely unreachable sends them around a loop that cannot help.
 */
async function resolveOpaqueCommonsToken(token: string): Promise<JWTPayload> {
  if (token.startsWith('local:'))
    throw new Error('Local identities are disabled')
  const url = `${(process.env.COMMONS_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')}/v1/identity`
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new IdentityError(
      401,
      'Commons identity is unreachable right now. Please retry in a moment.',
    )
  }
  if (!response.ok) throw new Error('Inactive Commons credential')
  const identity = (await response.json()) as {
    actorId?: unknown
    actorType?: unknown
    scopes?: unknown
    credentialType?: unknown
  }
  if (
    typeof identity.actorId !== 'string' ||
    !identity.actorId ||
    identity.credentialType !== 'oauth' ||
    !Array.isArray(identity.scopes) ||
    !identity.scopes.every((s) => typeof s === 'string')
  )
    throw new Error('Invalid verified principal')
  return {
    sub: identity.actorId,
    actor_type: identity.actorType,
    scopes: identity.scopes,
  } as JWTPayload
}
/**
 * A first-party Commons service acts for a signed-in creator rather than for
 * itself. An Agent Commons agent that builds a game must leave the project in
 * the creator's own Studio, so those calls present the service's
 * client-credentials token and name the creator in `X-Commons-Actor`.
 *
 * Delegation is honoured only for service subjects listed in
 * ARCADE_COMMONS_DELEGATES: any holder of such a token could otherwise claim to
 * be any account. The actor is carried per request rather than threaded through
 * all sixty authenticate() call sites, which would be easy to get wrong in the
 * one place it matters.
 */
const delegatedActor = new AsyncLocalStorage<string | undefined>()

export const commonsActorHeader = 'x-commons-actor'

/** Run `work` with `actor` as the delegated creator for any auth inside it. */
export function withCommonsActor<T>(
  actor: string | undefined,
  work: () => T,
): T {
  return delegatedActor.run(actor, work)
}

/** Hono middleware that carries `X-Commons-Actor` for the whole request. */
export const commonsDelegation = async (
  context: { req: { header: (name: string) => string | undefined } },
  next: () => Promise<void>,
) => withCommonsActor(context.req.header(commonsActorHeader), next)

const trustedDelegates = () =>
  new Set(
    (process.env.ARCADE_COMMONS_DELEGATES ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )

export function createAuthenticator(
  store: DocumentStore,
  options: {
    issuer?: string
    jwksUrl?: string
    audience?: string
    allowLocal?: boolean
  } = {},
) {
  const issuer = options.issuer ?? process.env.COMMONS_IDENTITY_ISSUER
  const keys = issuer
    ? createRemoteJWKSet(
        new URL(
          options.jwksUrl ??
            process.env.COMMONS_IDENTITY_JWKS_URL ??
            `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`,
        ),
      )
    : undefined
  return async (
    authorization: string | undefined,
    scope?: string,
    actor?: string,
  ): Promise<Principal> => {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1]
    if (!token)
      throw new IdentityError(
        401,
        'Sign in with Commons or supply a scoped Arcade access key.',
      )
    let principal: Principal
    if (
      token.startsWith('local:') &&
      options.allowLocal &&
      /^local:[A-Za-z0-9_-]{3,120}$/.test(token)
    ) {
      principal = {
        id: token.slice(6),
        scopes: [...arcadeScopes],
        token,
        provider: 'local',
      }
    } else if (token.startsWith('arc_')) {
      const key = await store.get<AccessKey>(
        'access-keys',
        await tokenHash(token),
      )
      if (!key || key.revoked || key.expiresAt <= Date.now())
        throw new IdentityError(401, 'Access key is expired or revoked.')
      principal = {
        id: key.ownerId,
        scopes: key.scopes,
        token,
        provider: 'api-key',
      }
    } else {
      if (!keys || !issuer)
        throw new IdentityError(401, 'Commons identity is not configured.')
      try {
        // Signed platform JWTs are the normal Commons credential and are
        // verified offline. Opaque OAuth tokens carry no claims, so they are
        // resolved once through the Commons gateway's verified principal
        // endpoint; that hop is a fallback, never the primary path.
        const payload =
          token.split('.').length === 3
            ? (
                await jwtVerify(token, keys, {
                  issuer,
                  audience: options.audience ?? 'commons-platform',
                  algorithms: ['RS256', 'ES256', 'EdDSA'],
                })
              ).payload
            : await resolveOpaqueCommonsToken(token)
        // Commons client-credentials JWTs identify the service with azp.
        // Match the platform verifier; never accept azp as a human identity.
        const subject =
          payload.sub ??
          (payload.actor_type === 'service' && typeof payload.azp === 'string'
            ? payload.azp
            : undefined)
        if (!subject) throw new Error('Missing subject')
        const grants =
          typeof payload.scope === 'string'
            ? payload.scope.split(' ')
            : Array.isArray(payload.scopes)
              ? payload.scopes
              : []
        const scopes: string[] = []
        if (grants.includes('agents:read'))
          scopes.push('projects:read', 'matches:play')
        if (grants.includes('agents:write'))
          scopes.push('projects:write', 'releases:publish', 'keys:manage')
        const requestedActor = actor ?? delegatedActor.getStore()
        if (payload.actor_type === 'service' && requestedActor) {
          if (!trustedDelegates().has(subject))
            throw new IdentityError(
              403,
              'This service is not allowed to act for a Commons account.',
            )
          if (!/^[A-Za-z0-9_.:@-]{1,200}$/.test(requestedActor))
            throw new IdentityError(
              403,
              'Delegated Commons actor is malformed.',
            )
          // A delegated call may build, test and publish the creator's games,
          // but never mint long-lived credentials in their name.
          principal = {
            id: requestedActor,
            scopes: scopes.filter((granted) => granted !== 'keys:manage'),
            token,
            provider: 'commons',
            delegatedBy: subject,
          }
        } else {
          principal = { id: subject, scopes, token, provider: 'commons' }
        }
      } catch (error) {
        throw error instanceof IdentityError
          ? error
          : new IdentityError(
              401,
              'Commons session could not be verified. Sign in again.',
            )
      }
    }
    if (scope && !principal.scopes.includes(scope))
      throw new IdentityError(403, `This credential does not grant ${scope}.`)
    return principal
  }
}
