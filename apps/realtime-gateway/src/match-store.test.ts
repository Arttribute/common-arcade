import { describe, expect, it } from 'vitest'
import { MemoryDocumentStore } from '@common-arcade/control-api'
import {
  LocalArcadePlatform,
  type PersistedMatch,
} from '@common-arcade/match-worker-service'
import { DurableMatchStore } from './match-store.js'

describe('durable match payload storage', () => {
  it('recovers a replay larger than one DynamoDB item and retains CAS semantics', async () => {
    const store = new MemoryDocumentStore()
    const durable = new DurableMatchStore(store)
    let saved: PersistedMatch | undefined
    const platform = await LocalArcadePlatform.create({
      persistMatch: async (record) => {
        saved = record
      },
    })
    await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'large-storage-test',
    })
    const match = saved!
    match.replay.checkpoints[0]!.state = {
      values: Array.from({ length: 50_000 }, () => crypto.randomUUID()),
    }
    expect(JSON.stringify(match).length).toBeGreaterThan(400_000)
    await durable.save(match)
    expect(await durable.load()).toEqual([match])
    await expect(durable.save({ ...match, version: 2 })).rejects.toThrow(
      'changed',
    )
    expect(await durable.load()).toEqual([match])
    await durable.save({ ...match, version: 2 }, 1)
    expect((await durable.load())[0]?.version).toBe(2)
  })
  it('quarantines a broken payload instead of blocking healthy matches', async () => {
    const store = new MemoryDocumentStore()
    await store.put('matches', 'bad', {
      version: 1,
      generation: 'missing',
      chunks: 1,
      digest: 'bad',
    })
    expect(await new DurableMatchStore(store).load()).toEqual([])
  })
})
