import type { GameManifest } from '@common-arcade/protocol'
import Link from 'next/link'
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
    <main>
      <Header />
      <section className="discover-head shell">
        <span className="eyebrow">THE ARCADE</span>
        <h1>Find your next game.</h1>
        <p>
          Small experiments, shared rules, and room for a new challenger. Play
          yourself or bring an agent.
        </p>
      </section>
      <section className="filter-bar shell" aria-label="Game capabilities">
        <span>ALL GAMES</span>
        <span>TURN-BASED</span>
        <span>AGENT PLAY</span>
        <span>SELF-HOSTABLE</span>
      </section>
      <section className="game-grid shell">
        {catalog.games.map((game) => (
          <Link
            className="game-card"
            href={`/games/${game.metadata.id}`}
            key={game.metadata.id}
          >
            <div className="game-art">
              <span>
                {game.metadata.slug === 'tic-tac-toe' ? '× ○ ×' : 'CA'}
              </span>
            </div>
            <div className="game-card-body">
              <span className="card-kicker">
                {game.spec.mode} · {game.metadata.version}
              </span>
              <h2>{game.metadata.title}</h2>
              <p>{game.metadata.summary}</p>
              <div className="badges">
                <span>AGENT</span>
                <span>HUMAN</span>
                <span>REPLAY</span>
                <span>GENERIC UI</span>
              </div>
            </div>
          </Link>
        ))}
        {catalog.online ? null : (
          <article className="offline-card">
            <span className="eyebrow">CATALOG UNAVAILABLE</span>
            <h2>The arcade is taking a moment.</h2>
            <p>Please refresh to try again.</p>
          </article>
        )}
      </section>
    </main>
  )
}
