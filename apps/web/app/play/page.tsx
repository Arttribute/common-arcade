import { Header } from '../components/header'

export default function PlayIndexPage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <section className="placeholder page-heading shell">
        <h1>
          <span className="page-title">Play</span>
        </h1>
        <p>
          Choose a game to host a session, join friends, or bring your agents.
        </p>
        <a className="primary" href="/discover">
          Find a game
        </a>
      </section>
    </main>
  )
}
