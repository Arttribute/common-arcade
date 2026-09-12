import {
  createGridPlacementGame,
  createSandboxedScriptGame,
  type GameDefinition,
} from '@common-arcade/match-runtime'
import {
  gameDocumentSchema,
  isBrowserGame,
  isManagedBrowserGame,
  type GameDocument,
} from '@common-arcade/protocol'
import { rulesFor } from './index.js'

/**
 * Compile an immutable project into authoritative match rules. This entrypoint
 * is server-only so the embedded QuickJS VM never enters Studio's browser
 * bundle merely because UI code imports document helpers.
 */
export async function compileGame(
  document: GameDocument,
  releaseId: string,
  digest: string,
): Promise<GameDefinition<any, any>> {
  const parsed = gameDocumentSchema.parse(document)
  if (isManagedBrowserGame(parsed)) {
    const source = parsed.files.find(
      (file) => file.path === parsed.runtime.entryFile,
    )?.content
    if (!source) throw new Error('Managed runtime source file is missing.')
    return createSandboxedScriptGame({
      releaseId,
      releaseDigest: digest,
      mode: parsed.play?.mode ?? 'turn-based',
      source,
      memoryMiB: parsed.runtime.memoryMiB,
      timeoutMs: parsed.runtime.timeoutMs,
    })
  }
  if (isBrowserGame(parsed))
    throw new Error(
      'Browser projects need a sandboxed authoritative runtime before they can host live matches.',
    )
  return createGridPlacementGame(rulesFor(parsed, releaseId, digest))
}

export { testGameRuntime, type RuntimeTestInput } from './runtime-test.js'
