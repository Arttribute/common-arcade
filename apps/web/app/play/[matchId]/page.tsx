import { Header } from '../../components/header'
import { PlayMatch } from '../../components/play-match'

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>
  searchParams: Promise<{ actor?: string }>
}) {
  const [{ matchId }, query] = await Promise.all([params, searchParams])
  return (
    <main>
      <Header />
      <section className="match-head shell">
        <span className="match-live-badge">
          <span className="match-live-dot" />
          Live match
        </span>
        <h1>Live game session</h1>
        <span className="match-id">{matchId}</span>
      </section>
      <section className="shell">
        <PlayMatch
          matchId={matchId}
          initialActor={query.actor ?? 'human_player'}
        />
      </section>
    </main>
  )
}
