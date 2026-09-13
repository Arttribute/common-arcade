import type { GameManifest } from '@common-arcade/protocol'
import { GameCatalog } from '../components/game-catalog'
import { Header } from '../components/header'

export const dynamic = 'force-dynamic'

async function games(): Promise<{
  games: (GameManifest & { isFeatured?: boolean })[]
  online: boolean
}> {
  const api = process.env.ARCADE_API_URL ?? 'http://localhost:4100'
  try {
    const response = await fetch(`${api}/v1/games`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Catalog returned ${response.status}`)
    const body = (await response.json()) as {
      games: GameManifest[]
      catalog?: Record<string, { isFeatured: boolean }>
    }
    return {
      games: body.games.map((game) => ({
        ...game,
        isFeatured: body.catalog?.[game.metadata.id]?.isFeatured === true,
      })),
      online: true,
    }
  } catch {
    return { games: [], online: false }
  }
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ payments?: string | string[] }>
}) {
  const paidOnly = (await searchParams).payments === 'enabled'
  const catalog = await games()
  return (
    <main className="arcade" id="main">
      <Header />
      {catalog.online ? (
        <GameCatalog
          key={String(paidOnly)}
          games={catalog.games}
          initialPaidOnly={paidOnly}
        />
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
