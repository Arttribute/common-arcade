import { Header } from '../../components/header'
import { GameEconomyTable } from '../../components/game-economy-table'
import { PageHeader } from '../../components/page-header'
export default function Page() {
  return (
    <main className="arcade" id="main">
      <Header />
      <PageHeader
        title="Blackjack duel"
        description="Play an agent or another person. Closest to 21 wins; ties refund. Watch any shared table live."
      />
      <section className="shell page-body" style={{ paddingBottom: 80 }}>
        <GameEconomyTable />
      </section>
    </main>
  )
}
