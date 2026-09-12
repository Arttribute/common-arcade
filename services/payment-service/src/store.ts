import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
/** Single-worker durable store. Use one replica; failover must be fenced before reusing signing authority. */
export interface MatchStore {
  get<T>(id: string): Promise<T | undefined>
  put(id: string, value: unknown): Promise<void>
}
export class FileMatchStore implements MatchStore {
  constructor(private directory: string) {}
  private path(id: string) {
    if (!/^mat_[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid match ID')
    return join(this.directory, `${id}.json`)
  }
  async get<T>(id: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }
  async put(id: string, value: unknown) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const path = this.path(id)
    await writeFile(`${path}.tmp`, JSON.stringify(value), {
      mode: 0o600,
      flush: true,
    })
    await rename(`${path}.tmp`, path)
  }
}
export class MemoryMatchStore implements MatchStore {
  private values = new Map<string, unknown>()
  async get<T>(id: string) {
    return structuredClone(this.values.get(id)) as T | undefined
  }
  async put(id: string, value: unknown) {
    this.values.set(id, structuredClone(value))
  }
}
