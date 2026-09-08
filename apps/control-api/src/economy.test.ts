import { describe, expect, it } from 'vitest'
import { getTicTacToeManifestWithEconomy } from '@common-arcade/example-tic-tac-toe'
import type { Principal } from './identity.js'
import { MemoryDocumentStore, type DocumentStore } from './store.js'
import { createEconomyApi, tinybarsToWeibars } from './economy.js'

const stubAuthenticate = async (): Promise<Principal> => ({
  id: 'usr_test',
  provider: 'local',
  scopes: ['matches:play'],
  token: 'test-token',
})

async function storeWithEconomyEnabledGame(store: DocumentStore) {
  const manifest = await getTicTacToeManifestWithEconomy({
    network: 'hedera-testnet',
    escrowContractAddress: '0x1111111111111111111111111111111111111111',
    bounty: { enabled: true },
    stake: { enabled: true, amountTinybars: '100000000' },
    betting: { enabled: true },
  })
  await store.put('releases', 'rel_economytest1', {
    version: 1,
    release: { manifest },
  })
  return manifest.metadata.id
}

describe('economy api', () => {
  it('converts tinybars to weibars (1 tinybar = 1e10 weibar)', () => {
    expect(tinybarsToWeibars('1').toString()).toBe('10000000000')
    expect(tinybarsToWeibars('100000000').toString()).toBe(
      (10n ** 18n).toString(),
    )
  })

  it('404s for a game that has not opted into the economy extension', async () => {
    const app = createEconomyApi(new MemoryDocumentStore(), stubAuthenticate)
    const response = await app.request('/v1/matches/mat_1/economy/stake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'gam_unknown', seatId: 'sea_a' }),
    })
    expect(response.status).toBe(404)
  })

  it('returns unsigned stake calldata for a game with staking enabled', async () => {
    const store = new MemoryDocumentStore()
    const gameId = await storeWithEconomyEnabledGame(store)
    const app = createEconomyApi(store, stubAuthenticate)

    const response = await app.request('/v1/matches/mat_1/economy/stake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, seatId: 'sea_a' }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      to: string
      value: string
      data: string
    }
    expect(body.to).toBe('0x1111111111111111111111111111111111111111')
    expect(body.value).toBe((10n ** 18n).toString())
    expect(body.data).toMatch(/^0x[0-9a-f]+$/)
  })

  it('404s the settle endpoint without the internal worker secret', async () => {
    const store = new MemoryDocumentStore()
    const gameId = await storeWithEconomyEnabledGame(store)
    const app = createEconomyApi(store, stubAuthenticate, {
      workerSecret: 'shh',
    })

    const response = await app.request(
      '/v1/internal/matches/mat_1/economy/settle',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gameId,
          result: { outcome: 'win', winnerSeatId: 'sea_a' },
        }),
      },
    )
    expect(response.status).toBe(403)
  })
})
