import { createHash, randomUUID } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { DocumentStore } from '@common-arcade/control-api'
import type { PersistedMatch } from '@common-arcade/match-worker-service'

const compress = promisify(gzip)
const decompress = promisify(gunzip)
const CHUNK_BYTES = 200_000

/** Publish the small CAS pointer only after every immutable payload chunk is durable. */
export class DurableMatchStore {
  constructor(private readonly store: DocumentStore) {}

  async save(match: PersistedMatch, expectedVersion?: number): Promise<void> {
    const encoded = (
      await compress(Buffer.from(JSON.stringify(match)))
    ).toString('base64')
    const generation = `${match.replay.matchId}:${randomUUID()}`
    const chunks = Math.ceil(encoded.length / CHUNK_BYTES)
    for (let index = 0; index < chunks; index++) {
      await this.store.put(`match-payload:${generation}`, String(index), {
        version: 1,
        data: encoded.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES),
      })
    }
    await this.store.put(
      'matches',
      match.replay.matchId,
      {
        version: match.version,
        generation,
        chunks,
        digest: createHash('sha256').update(encoded).digest('hex'),
      },
      expectedVersion,
    )
  }

  async load(): Promise<PersistedMatch[]> {
    const records = await this.store.list<{
      version: number
      match?: PersistedMatch
      generation?: string
      chunks?: number
      digest?: string
    }>('matches')
    const matches: PersistedMatch[] = []
    for (const record of records) {
      try {
        // Existing deployments stored the entire match inline.
        if (record.match) {
          matches.push(record.match)
          continue
        }
        if (!record.generation || !record.chunks || record.chunks > 1024)
          throw new Error('Invalid match payload pointer')
        const parts: string[] = []
        for (let index = 0; index < record.chunks; index++) {
          const chunk = await this.store.get<{ version: number; data: string }>(
            `match-payload:${record.generation}`,
            String(index),
          )
          if (!chunk) throw new Error('Missing match payload chunk')
          parts.push(chunk.data)
        }
        const encoded = parts.join('')
        if (
          createHash('sha256').update(encoded).digest('hex') !== record.digest
        )
          throw new Error('Match payload integrity check failed')
        matches.push(
          JSON.parse(
            (
              await decompress(Buffer.from(encoded, 'base64'), {
                maxOutputLength: 128 * 1024 * 1024,
              })
            ).toString(),
          ),
        )
      } catch (error) {
        console.error(
          'Match recovery quarantined a damaged record',
          record.generation,
          error,
        )
      }
    }
    return matches
  }
}
