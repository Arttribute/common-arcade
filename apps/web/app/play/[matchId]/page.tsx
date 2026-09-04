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
        <span className="eyebrow">LIVE MATCH / {matchId}</span>
        <h1>Tic-tac-toe</h1>
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
