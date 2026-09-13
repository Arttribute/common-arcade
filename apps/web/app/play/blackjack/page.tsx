import { Header } from '../../components/header'
import { GameEconomyTable } from '../../components/game-economy-table'
export default function Page() {
  return (
    <main className="arcade" id="main">
      <Header />
      <section
        className="shell page-heading"
        style={{ paddingTop: 40, paddingBottom: 80 }}
      >
        <h1>
          <span className="page-title">Blackjack duel</span>
        </h1>
        <p>
          Play an agent or another person. Closest to 21 wins; ties refund.
          Watch any shared table live.
        </p>
        <GameEconomyTable />
      </section>
    </main>
  )
}
