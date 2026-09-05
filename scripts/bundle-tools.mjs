import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

// Self-contained, installable release assets while registry bootstrap is pending.
// Build from reviewed source; no private workspace packages or registry auth needed.
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'dist/releases')
const version = process.argv[2] ?? '0.1.0-alpha.1'
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw Error('Invalid release version')
await mkdir(output, { recursive: true })
execFileSync(
  'pnpm',
  [
    '--filter',
    '@common-arcade/sdk...',
    '--filter',
    '@common-arcade/cli...',
    'build',
  ],
  { cwd: root, stdio: 'inherit' },
)
for (const name of ['sdk', 'cli']) {
  const cwd = resolve(root, 'packages', name)
  const require = createRequire(resolve(cwd, 'package.json'))
  const destination = resolve(output, name)
  const manifest = JSON.parse(
    await readFile(resolve(cwd, 'package.json'), 'utf8'),
  )
  const options = {
    entry:
      name === 'cli'
        ? [resolve(cwd, 'src/index.ts'), resolve(cwd, 'src/bin.ts')]
        : [resolve(cwd, 'src/index.ts')],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: resolve(destination, 'dist'),
    clean: true,
    splitting: false,
    tsconfig: resolve(cwd, 'tsconfig.json'),
  }
  execFileSync(
    process.execPath,
    [
      '-e',
      `require(${JSON.stringify(require.resolve('tsup'))}).build({...${JSON.stringify(options)}, noExternal: [/.*/], outExtension: () => ({js: '.js'})}).catch(e => {console.error(e);process.exitCode=1})`,
    ],
    { cwd, stdio: 'inherit' },
  )
  const { dependencies, devDependencies, scripts, ...pack } = manifest
  await writeFile(
    resolve(destination, 'package.json'),
    JSON.stringify(
      {
        ...pack,
        version,
        ...(name === 'sdk' ? { dependencies: { zod: '^4.5.4' } } : {}),
      },
      null,
      2,
    ),
  )
  const rewriteTypes = (text, prefix) =>
    text
      .replaceAll(
        /'@common-arcade\/(control-client|protocol|realtime-client)'/g,
        (_, dependency) => `'${prefix}${dependency}.js'`,
      )
      .replaceAll('NodeJS.ProcessEnv', 'Record<string, string | undefined>')
  await writeFile(
    resolve(destination, 'dist/index.d.ts'),
    rewriteTypes(
      await readFile(resolve(cwd, 'dist/index.d.ts'), 'utf8'),
      './types/',
    ),
  )
  if (name === 'sdk') {
    await mkdir(resolve(destination, 'dist/types'), { recursive: true })
    for (const dependency of [
      'control-client',
      'protocol',
      'realtime-client',
    ]) {
      await writeFile(
        resolve(destination, `dist/types/${dependency}.d.ts`),
        rewriteTypes(
          await readFile(
            resolve(root, `packages/${dependency}/dist/index.d.ts`),
            'utf8',
          ),
          './',
        ),
      )
    }
  }
  await writeFile(
    resolve(destination, 'README.md'),
    await readFile(resolve(cwd, 'README.md')),
  )
  await writeFile(
    resolve(destination, 'LICENSE'),
    await readFile(resolve(root, 'LICENSE')),
  )
  execFileSync('npm', ['pack', destination, '--pack-destination', output], {
    cwd: root,
    stdio: 'inherit',
  })
}
console.log(`Release assets ready in ${output}`)
