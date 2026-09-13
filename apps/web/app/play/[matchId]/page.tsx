import { Header } from '../../components/header'
import { PlayMatch } from '../../components/play-match'
import { PageHeader } from '../../components/page-header'

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
      <PageHeader title="Live session" className="match-head" />
      <section className="shell">
        <PlayMatch
          matchId={matchId}
          initialActor={query.actor ?? 'human_player'}
        />
      </section>
    </main>
  )
}
