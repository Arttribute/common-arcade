import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../', import.meta.url)

async function childPackageDirectories(relativeDirectory) {
  const directory = new URL(`${relativeDirectory}/`, root)
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${relativeDirectory}/${entry.name}`)
}

const firstLevel = [
  ...(await childPackageDirectories('apps')),
  ...(await childPackageDirectories('services')),
  ...(await childPackageDirectories('packages')),
  'infra/aws',
]
const adapterRootIndex = firstLevel.indexOf('packages/adapters')
if (adapterRootIndex >= 0) firstLevel.splice(adapterRootIndex, 1)
firstLevel.push(...(await childPackageDirectories('packages/adapters')))

const names = new Map()
for (const relativeDirectory of firstLevel) {
  const path = join(root.pathname, relativeDirectory, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))

  if (!manifest.name)
    throw new Error(`${relativeDirectory} has no package name`)
  if (names.has(manifest.name)) {
    throw new Error(
      `${manifest.name} is duplicated in ${names.get(manifest.name)} and ${relativeDirectory}`,
    )
  }
  names.set(manifest.name, relativeDirectory)

  if (manifest.private !== true) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
      throw new Error(`${manifest.name} has an invalid release version`)
    }
    if (
      manifest.publishConfig?.access !== 'public' ||
      manifest.publishConfig?.provenance !== true
    ) {
      throw new Error(`${manifest.name} must publish publicly with provenance`)
    }
    if (!manifest.files?.includes('dist')) {
      throw new Error(
        `${manifest.name} must publish an explicit dist allowlist`,
      )
    }
  }
}

console.log(`Validated ${names.size} workspace package manifests`)
