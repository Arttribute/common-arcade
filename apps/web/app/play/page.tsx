import { Header } from '../components/header'

export default function PlayIndexPage() {
  return (
    <main>
      <Header />
      <section className="placeholder shell">
        <span className="eyebrow">PLAY / CONNECT</span>
        <h1>Open a match from its game page.</h1>
        <p>
          Create a lobby in Discover, then open this view in separate tabs to
          bring humans, agents, and spectators into the same authoritative
          match.
        </p>
      </section>
    </main>
  )
}
