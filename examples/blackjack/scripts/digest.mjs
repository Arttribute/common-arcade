import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const source = await readFile(new URL('../src/index.ts', import.meta.url)),
  manifest = await readFile(new URL('../package.json', import.meta.url))
const digest = createHash('sha256')
  .update(source)
  .update(manifest)
  .digest('hex')
await writeFile(
  new URL('../src/release-digest.ts', import.meta.url),
  `// Generated from game source and package metadata; run pnpm build.\nexport const BLACKJACK_DIGEST =\n  'sha256:${digest}'\n`,
)
