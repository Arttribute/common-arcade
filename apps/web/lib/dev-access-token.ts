/**
 * Local development sign-in with a scoped Arcade access key.
 *
 * A live-site Commons session cookie belongs to arcade.agentcommons.io, so a
 * local app on localhost can never read it. To review signed-in screens
 * locally, create an access key on the live Agents page and set
 * ARCADE_DEV_ACCESS_TOKEN=arc_… in apps/web/.env.local. Only `next dev` honours
 * it; production builds ignore it. Commons-backed features (Copilot, agents,
 * chat, wallets) still need a real Commons sign-in.
 */
export function devAccessToken(): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined
  const token = process.env.ARCADE_DEV_ACCESS_TOKEN?.trim()
  return token && /^arc_\S+$/.test(token) ? token : undefined
}

/** The account the dev key belongs to, reported by the session route. */
export async function devAccessTokenUser(): Promise<{
  id: string
  name: string
} | null> {
  const token = devAccessToken()
  if (!token) return null
  try {
    const response = await fetch(
      `${(process.env.ARCADE_API_URL ?? 'http://localhost:4100').replace(/\/$/, '')}/v1/me`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!response.ok) return null
    const me = (await response.json()) as { id?: unknown }
    return typeof me.id === 'string' && me.id
      ? { id: me.id, name: 'Local dev key' }
      : null
  } catch {
    return null
  }
}
