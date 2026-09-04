import {
  gameManifestSchema,
  type GameManifest,
  type JsonValue,
} from '@common-arcade/protocol'

export interface ManifestSignature {
  readonly algorithm: 'Ed25519'
  readonly keyId: string
  readonly value: string
}

export interface ExtensionSupport {
  readonly id: string
  readonly supported: boolean
}

export interface ExtensionNegotiation {
  readonly accepted: readonly string[]
  readonly ignored: readonly string[]
  readonly unsupportedRequired: readonly string[]
  readonly compatible: boolean
}

function compareKeys(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareKeys(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON cannot contain non-finite numbers')
  }
  return Object.is(value, -0) ? 0 : value
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value))
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : new Uint8Array(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
}

function manifestDigestInput(manifest: GameManifest): JsonValue {
  const { digest: _digest, ...metadata } = manifest.metadata
  return { ...manifest, metadata } as JsonValue
}

export function parseManifest(input: unknown): GameManifest {
  return gameManifestSchema.parse(input)
}

export async function computeManifestDigest(
  manifest: GameManifest,
): Promise<string> {
  return sha256(canonicalJson(manifestDigestInput(manifest)))
}

export async function verifyManifestDigest(
  manifest: GameManifest,
): Promise<boolean> {
  return manifest.metadata.digest === (await computeManifestDigest(manifest))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function signManifest(
  manifest: GameManifest,
  privateKey: CryptoKey,
  keyId: string,
): Promise<ManifestSignature> {
  if (!(await verifyManifestDigest(manifest))) {
    throw new Error('Cannot sign a manifest whose declared digest is invalid')
  }
  const bytes = new TextEncoder().encode(canonicalJson(manifest as JsonValue))
  const signature = await crypto.subtle.sign('Ed25519', privateKey, bytes)
  return {
    algorithm: 'Ed25519',
    keyId,
    value: bytesToBase64Url(new Uint8Array(signature)),
  }
}

export async function verifyManifestSignature(
  manifest: GameManifest,
  signature: ManifestSignature,
  publicKey: CryptoKey,
): Promise<boolean> {
  if (signature.algorithm !== 'Ed25519') return false
  if (!(await verifyManifestDigest(manifest))) return false
  const bytes = new TextEncoder().encode(canonicalJson(manifest as JsonValue))
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    base64UrlToBytes(signature.value),
    bytes,
  )
}

export function negotiateExtensions(
  manifest: GameManifest,
  support: readonly ExtensionSupport[],
): ExtensionNegotiation {
  const supported = new Set(
    support.filter((item) => item.supported).map((item) => item.id),
  )
  const accepted: string[] = []
  const ignored: string[] = []
  const unsupportedRequired: string[] = []

  for (const extension of manifest.spec.extensions) {
    if (supported.has(extension.id)) accepted.push(extension.id)
    else if (extension.required) unsupportedRequired.push(extension.id)
    else ignored.push(extension.id)
  }

  return {
    accepted,
    ignored,
    unsupportedRequired,
    compatible: unsupportedRequired.length === 0,
  }
}
