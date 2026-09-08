import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  stringToBytes,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  ECONOMY_HEDERA_EXTENSION_ID,
  readEconomyHederaConfig,
  type EconomyHederaConfig,
} from '@common-arcade/economy-hedera'
import type { GameManifest } from '@common-arcade/protocol'
import { getTicTacToeManifest } from '@common-arcade/example-tic-tac-toe'
import type { Principal } from './identity.js'
import type { DocumentStore } from './store.js'

/**
 * Optional, opt-in economy routes: bounties, stakes, and (testnet-only, for
 * now) spectator betting, on top of the MatchEscrow contract in
 * @common-arcade/economy-hedera. Mounted the same way as studio/recordings/
 * browser-tests (see app.ts) via `app.route('/', createEconomyApi(...))`.
 *
 * Every route 404s as "economy not enabled" unless the game's manifest
 * declares the `economy-hedera/v1` extension — every other game, and every
 * human/agent playing one that hasn't opted in, is unaffected.
 *
 * Custody boundary: `stake` / `fundBounty` / `placeBet` never touch a
 * private key here — they return unsigned contract-call parameters for the
 * caller's own wallet to sign and submit (control-api holds no agent or
 * player funds). `settle` / `void` are different: only the platform's own
 * Hedera operator account may ever call them on-chain (the contract enforces
 * this too — see `onlyArbiter` in MatchEscrow.sol), so those two are signed
 * and submitted here using `HEDERA_OPERATOR_PRIVATE_KEY`, restricted to the
 * internal worker-secret header already used for copilot jobs.
 */

const matchEscrowAbi = [
  {
    name: 'fundBounty',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'matchId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'matchId', type: 'bytes32' },
      { name: 'seatId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'placeBet',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'matchId', type: 'bytes32' },
      { name: 'seatId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'settle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'bytes32' },
      { name: 'winnerSeatId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'voidMatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'bytes32' }],
    outputs: [],
  },
] as const

/** Arbitrary-length Common Arcade ids (mat_.../sea_...) hashed into the contract's opaque bytes32 keys. */
function toBytes32Id(id: string): Hex {
  return keccak256(stringToBytes(id))
}

/**
 * The Hedera JSON-RPC relay represents native balance/value with 18 decimals
 * (weibar) even though Hedera itself uses 8-decimal tinybars — 1 tinybar =
 * 1e10 weibar. Contract calls made through a standard EVM client (viem here,
 * or any wallet on the client side) must convert before setting `value`.
 */
export function tinybarsToWeibars(tinybars: string): bigint {
  return BigInt(tinybars) * 10n ** 10n
}

function hederaChain(network: 'hedera-testnet' | 'hedera-mainnet') {
  const testnet = network === 'hedera-testnet'
  return defineChain({
    id: testnet ? 296 : 295,
    name: testnet ? 'Hedera Testnet' : 'Hedera Mainnet',
    network,
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
    rpcUrls: {
      default: {
        http: [
          process.env.HEDERA_JSON_RPC_URL ??
            (testnet
              ? 'https://testnet.hashio.io/api'
              : 'https://mainnet.hashio.io/api'),
        ],
      },
    },
  })
}

async function resolveGameManifest(
  store: DocumentStore,
  gameId: string,
): Promise<GameManifest | undefined> {
  const stored = (
    await store.list<{ version: number; release: { manifest: GameManifest } }>(
      'releases',
    )
  )
    .map((record) => record.release.manifest)
    .findLast((manifest) => manifest.metadata.id === gameId)
  if (stored) return stored
  if (gameId === 'gam_tictactoe1') return getTicTacToeManifest()
  return undefined
}

async function requireEconomyConfig(
  store: DocumentStore,
  gameId: string,
): Promise<EconomyHederaConfig> {
  const manifest = await resolveGameManifest(store, gameId)
  const config = manifest && readEconomyHederaConfig(manifest)
  if (!config) {
    throw new EconomyNotEnabledError(gameId)
  }
  return config
}

class EconomyNotEnabledError extends Error {
  constructor(readonly gameId: string) {
    super(`Game ${gameId} has not opted into ${ECONOMY_HEDERA_EXTENSION_ID}`)
  }
}

const stakeBody = z.object({
  gameId: z.string().min(1),
  seatId: z.string().min(1),
})
const bountyBody = z.object({
  gameId: z.string().min(1),
  amountTinybars: z.string().regex(/^[0-9]+$/),
})
const betBody = z.object({
  gameId: z.string().min(1),
  seatId: z.string().min(1),
  amountTinybars: z.string().regex(/^[0-9]+$/),
})
const settleBody = z.object({
  gameId: z.string().min(1),
  result: z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('win'), winnerSeatId: z.string().min(1) }),
    z.object({ outcome: z.literal('draw') }),
    z.object({ outcome: z.literal('void') }),
  ]),
})

export interface EconomyApiOptions {
  readonly workerSecret?: string
}

export function createEconomyApi(
  store: DocumentStore,
  authenticate: (authorization?: string, scope?: string) => Promise<Principal>,
  options: EconomyApiOptions = {},
) {
  const app = new Hono()

  async function loadConfigOrNotFound(
    c: Context,
    gameId: string,
  ): Promise<EconomyHederaConfig | Response> {
    try {
      return await requireEconomyConfig(store, gameId)
    } catch (error) {
      if (error instanceof EconomyNotEnabledError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    }
  }

  app.post('/v1/matches/:matchId/economy/stake', async (c) => {
    await authenticate(c.req.header('Authorization'), 'matches:play')
    const matchId = c.req.param('matchId')
    const body = stakeBody.parse(await c.req.json())
    const config = await loadConfigOrNotFound(c, body.gameId)
    if (config instanceof Response) return config
    if (
      !config.stake.enabled ||
      !config.escrowContractAddress ||
      !config.stake.amountTinybars
    ) {
      return c.json({ error: `Staking is not enabled for ${body.gameId}` }, 404)
    }
    return c.json({
      to: config.escrowContractAddress,
      value: tinybarsToWeibars(config.stake.amountTinybars).toString(),
      data: encodeFunctionData({
        abi: matchEscrowAbi,
        functionName: 'stake',
        args: [toBytes32Id(matchId), toBytes32Id(body.seatId)],
      }),
    })
  })

  app.post('/v1/matches/:matchId/economy/bounty', async (c) => {
    await authenticate(c.req.header('Authorization'), 'matches:play')
    const matchId = c.req.param('matchId')
    const body = bountyBody.parse(await c.req.json())
    const config = await loadConfigOrNotFound(c, body.gameId)
    if (config instanceof Response) return config
    if (!config.bounty.enabled || !config.escrowContractAddress) {
      return c.json(
        { error: `Bounties are not enabled for ${body.gameId}` },
        404,
      )
    }
    return c.json({
      to: config.escrowContractAddress,
      value: tinybarsToWeibars(body.amountTinybars).toString(),
      data: encodeFunctionData({
        abi: matchEscrowAbi,
        functionName: 'fundBounty',
        args: [toBytes32Id(matchId)],
      }),
    })
  })

  app.post('/v1/matches/:matchId/economy/bet', async (c) => {
    await authenticate(c.req.header('Authorization'), 'matches:play')
    const matchId = c.req.param('matchId')
    const body = betBody.parse(await c.req.json())
    const config = await loadConfigOrNotFound(c, body.gameId)
    if (config instanceof Response) return config
    if (!config.betting.enabled || !config.escrowContractAddress) {
      return c.json({ error: `Betting is not enabled for ${body.gameId}` }, 404)
    }
    return c.json({
      to: config.escrowContractAddress,
      value: tinybarsToWeibars(body.amountTinybars).toString(),
      data: encodeFunctionData({
        abi: matchEscrowAbi,
        functionName: 'placeBet',
        args: [toBytes32Id(matchId), toBytes32Id(body.seatId)],
      }),
    })
  })

  // Internal: called by the match runtime/supervisor once a match's
  // authoritative result is known. Same worker-secret convention as
  // /v1/internal/copilot-jobs/* (see lambda.ts) — never reachable by an
  // agent's or player's own credentials.
  app.post('/v1/internal/matches/:matchId/economy/settle', async (c) => {
    // Answered directly rather than thrown: this rejection must not depend on
    // a parent app's error handler being mounted to come out as a 403.
    if (
      !options.workerSecret ||
      c.req.header('X-Arcade-Worker-Secret') !== options.workerSecret
    ) {
      return c.json(
        { error: 'This endpoint is for the match runtime only.' },
        403,
      )
    }
    const matchId = c.req.param('matchId')
    const body = settleBody.parse(await c.req.json())
    let config: EconomyHederaConfig
    try {
      config = await requireEconomyConfig(store, body.gameId)
    } catch (error) {
      if (error instanceof EconomyNotEnabledError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    }
    if (!config.escrowContractAddress) {
      return c.json(
        {
          error: `Economy has no escrow contract configured for ${body.gameId}`,
        },
        404,
      )
    }
    const operatorKey = process.env.HEDERA_OPERATOR_PRIVATE_KEY
    if (!operatorKey) {
      throw new Error('HEDERA_OPERATOR_PRIVATE_KEY is not configured')
    }

    const account = privateKeyToAccount(operatorKey as Hex)
    const chain = hederaChain(config.network)
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    })
    const publicClient = createPublicClient({ chain, transport: http() })

    // A draw has no on-chain winner to pay, so it settles the same way as an
    // explicit void: every staker and bettor gets exactly their own money
    // back rather than leaving funds stuck with no winner to credit.
    const data =
      body.result.outcome === 'win'
        ? encodeFunctionData({
            abi: matchEscrowAbi,
            functionName: 'settle',
            args: [toBytes32Id(matchId), toBytes32Id(body.result.winnerSeatId)],
          })
        : encodeFunctionData({
            abi: matchEscrowAbi,
            functionName: 'voidMatch',
            args: [toBytes32Id(matchId)],
          })

    const hash = await walletClient.sendTransaction({
      to: config.escrowContractAddress as Hex,
      data,
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return c.json({
      transactionHash: hash,
      action: body.result.outcome === 'win' ? 'settled' : 'voided',
    })
  })

  return app
}
