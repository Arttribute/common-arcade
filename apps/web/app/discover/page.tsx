import type { GameManifest } from '@common-arcade/protocol'
import { GameCatalog } from '../components/game-catalog'
import { Header } from '../components/header'

export const dynamic = 'force-dynamic'

async function games(): Promise<{ games: GameManifest[]; online: boolean }> {
  const api = process.env.ARCADE_API_URL ?? 'http://localhost:4100'
  try {
    const response = await fetch(`${api}/v1/games`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Catalog returned ${response.status}`)
    const body = (await response.json()) as { games: GameManifest[] }
    return { games: body.games, online: true }
  } catch {
    return { games: [], online: false }
  }
}

export default async function DiscoverPage() {
  const catalog = await games()
  return (
    <main className="arcade" id="main">
      <Header />
      <section className="discover-head shell">
        <span className="eyebrow">THE ARCADE</span>
        <h1>Find your next game.</h1>
        <p>New worlds. Friendly rivals. Play yourself or bring an agent.</p>
      </section>
      {catalog.online ? (
        <GameCatalog games={catalog.games} />
      ) : (
        <section className="shell catalog-empty">
          <h2>The arcade is taking a moment.</h2>
          <p>Please refresh to try again.</p>
          <a className="secondary" href="/discover">
            Try again
          </a>
        </section>
      )}
    </main>
  )
}
