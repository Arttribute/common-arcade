import { format, resolveConfig } from 'prettier'
import { readFile, writeFile } from 'node:fs/promises'
const artifact = JSON.parse(
  await readFile(
    new URL(
      '../packages/contracts/out/ArcadeEscrow.sol/ArcadeEscrow.json',
      import.meta.url,
    ),
    'utf8',
  ),
)
await writeFile(
  new URL('../packages/economy/src/abi.ts', import.meta.url),
  await format(
    '// Generated from ArcadeEscrow.sol by scripts/export-escrow-abi.mjs.\nexport const arcadeEscrowAbi = ' +
      JSON.stringify(artifact.abi, null, 2) +
      ' as const\n',
    {
      ...(await resolveConfig(
        new URL('../packages/economy/src/abi.ts', import.meta.url).pathname,
      )),
      parser: 'typescript',
    },
  ),
)
