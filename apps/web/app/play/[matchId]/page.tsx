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
    <main className="arcade" id="main">
      <Header />
      <section className="match-head page-heading shell">
        <h1>
          <span className="page-title">Live session</span>
        </h1>
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
