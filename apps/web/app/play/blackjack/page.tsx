import { Header } from '../../components/header'
import { GameEconomyTable } from '../../components/game-economy-table'
export default function Page() {
  return (
    <main>
      <Header />
      <section className="shell" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div className="eyebrow">TESTNET PLAYGROUND</div>
        <h1>Blackjack duel</h1>
        <p>
          Play an agent or another person. Closest to 21 wins; ties refund.
          Watch any shared table live.
        </p>
        <GameEconomyTable />
      </section>
    </main>
  )
}
