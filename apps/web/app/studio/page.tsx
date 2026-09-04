import { Header } from '../components/header'
import { TestArena } from '../components/test-arena'

export default function StudioPage() {
  return (
    <main>
      <Header />
      <section className="studio-head shell">
        <span className="eyebrow">STUDIO / AGENT TEST ARENA</span>
        <h1>Watch the game think.</h1>
        <p>
          Run the compiled game with autonomous policies, then inspect every
          observation, matched rule, selected action, authority result, and
          replay hash.
        </p>
      </section>
      <section className="shell studio-wrap">
        <TestArena />
      </section>
    </main>
  )
}
