import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  actionResultSchema,
  actionSubmissionSchema,
  discoveryDocumentSchema,
  gameManifestSchema,
  matchDescriptorSchema,
  matchEventSchema,
  observationSchema,
  problemDetailsSchema,
  realtimeEnvelopeSchema,
  replaySchema,
} from '../dist/index.js'

const destination = fileURLToPath(
  new URL('../../../schemas/v0alpha1/', import.meta.url),
)

const schemas = {
  'action-result': actionResultSchema,
  'action-submission': actionSubmissionSchema,
  discovery: discoveryDocumentSchema,
  'game-manifest': gameManifestSchema,
  match: matchDescriptorSchema,
  event: matchEventSchema,
  observation: observationSchema,
  problem: problemDetailsSchema,
  'realtime-envelope': realtimeEnvelopeSchema,
  replay: replaySchema,
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

await mkdir(destination, { recursive: true })
const index = {
  apiVersion: 'io.agentcommons.arcade/v0alpha1',
  generatedBy: '@common-arcade/protocol',
  schemas: {},
}

for (const [name, schema] of Object.entries(schemas)) {
  const document = canonical({
    ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    $id: `https://arcade.agentcommons.io/schemas/v0alpha1/${name}.schema.json`,
    title: `Common Arcade ${name}`,
  })
  const body = `${JSON.stringify(document, null, 2)}\n`
  const file = `${name}.schema.json`
  await writeFile(`${destination}${file}`, body)
  index.schemas[name] = {
    file,
    digest: `sha256:${createHash('sha256')
      .update(JSON.stringify(document))
      .digest('hex')}`,
  }
}

await writeFile(
  `${destination}index.json`,
  `${JSON.stringify(canonical(index), null, 2)}\n`,
)
