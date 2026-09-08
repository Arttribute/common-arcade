import { Hono } from 'hono'
import {
  HTTPFacilitatorClient,
  type HTTPRequestContext,
} from '@x402/core/server'
import type { AssetAmount } from '@x402/core/types'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { z } from 'zod'

/**
 * Standalone x402-gated coaching service. Kept decoupled from the rest of
 * Common Arcade (control-api, match-runtime, etc.) so it demos and deploys
 * on its own: an agent pays HBAR per call, in HBAR, settled on Hedera
 * through the Blocky402 facilitator, and gets back move-analysis advice for
 * an in-progress match. No Common Arcade internals are required to run it.
 *
 * Price scales with the requested analysis `depth` (metered, not a flat
 * per-call charge) — see `priceForRequest` below.
 */

const HEDERA_NETWORK =
  process.env.HEDERA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
const X402_NETWORK = `hedera:${HEDERA_NETWORK}` as const

// HBAR asset id is always 0.0.0; amounts are tinybars (1 HBAR = 1e8 tinybars).
const HBAR_ASSET = '0.0.0'
const TINYBARS_PER_DEPTH_UNIT = Number(
  process.env.X402_COACH_TINYBARS_PER_DEPTH ?? 5_000_000, // 0.05 HBAR
)

const coachRequestSchema = z.object({
  matchId: z.string().min(1).optional(),
  seatId: z.string().min(1).optional(),
  /** Free-form description of the current position/state to analyze. */
  position: z.string().min(1).max(4_000),
  /** Requested analysis depth. Higher depth costs more and returns more detail. */
  depth: z.number().int().min(1).max(5).default(1),
})

/** Metered price: deeper analysis costs proportionally more HBAR. */
async function priceForRequest(
  context: HTTPRequestContext,
): Promise<AssetAmount> {
  const body = await Promise.resolve(context.adapter.getBody?.()).catch(
    () => undefined,
  )
  const parsed = coachRequestSchema.safeParse(body)
  const depth = parsed.success ? parsed.data.depth : 1
  return { asset: HBAR_ASSET, amount: String(TINYBARS_PER_DEPTH_UNIT * depth) }
}

/** Deterministic, dependency-free "coaching" heuristic for the demo. */
function analyze(position: string, depth: number) {
  let hash = 0
  for (let index = 0; index < position.length; index += 1) {
    hash = (hash * 31 + position.charCodeAt(index)) >>> 0
  }
  const candidateMoves = [
    'advance-center',
    'defend-flank',
    'trade-tempo',
    'hold-position',
  ]
  const suggestedMove = candidateMoves[hash % candidateMoves.length]
  const confidence = Math.min(0.5 + depth * 0.1, 0.95)
  return {
    suggestedMove,
    confidence,
    depth,
    rationale: `Heuristic scan at depth ${depth} favors "${suggestedMove}" (confidence ${confidence.toFixed(2)}).`,
  }
}

export interface AppOptions {
  readonly payToAccountId?: string
  readonly facilitatorUrl?: string
}

export function createApp(options: AppOptions = {}): Hono {
  const payTo =
    options.payToAccountId ?? process.env.X402_HEDERA_PAYEE_ACCOUNT_ID
  const facilitatorUrl =
    options.facilitatorUrl ?? process.env.X402_FACILITATOR_URL_HEDERA
  if (!payTo) {
    throw new Error('X402_HEDERA_PAYEE_ACCOUNT_ID is not configured')
  }
  if (!facilitatorUrl) {
    throw new Error('X402_FACILITATOR_URL_HEDERA is not configured')
  }

  const app = new Hono()

  app.get('/healthz', (c) => c.json({ ok: true, network: X402_NETWORK }))

  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl })
  const hederaServerScheme = new ExactHederaScheme({
    defaultAssets: {
      [X402_NETWORK]: { asset: HBAR_ASSET, decimals: 8 },
    },
  })

  app.use(
    '*',
    paymentMiddlewareFromConfig(
      {
        'POST /v1/coach': {
          accepts: {
            scheme: 'exact',
            network: X402_NETWORK,
            payTo,
            price: priceForRequest,
          },
          description:
            'Per-call move/strategy coaching for an in-progress Common Arcade match. Price scales with analysis depth.',
          mimeType: 'application/json',
        },
      },
      facilitator,
      [{ network: X402_NETWORK, server: hederaServerScheme }],
    ),
  )

  app.post('/v1/coach', async (c) => {
    const parsed = coachRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    )
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid request', issues: parsed.error.issues },
        400,
      )
    }
    return c.json(analyze(parsed.data.position, parsed.data.depth))
  })

  return app
}
