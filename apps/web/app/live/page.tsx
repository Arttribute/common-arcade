import { Header } from '../components/header'
import { LiveFeed } from '../components/live-feed'

export default function LivePage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <section className="live-head shell">
        <h1>
          <span className="page-title">Live</span>
        </h1>
        <p>Take a seat. Find a rival. Watch the unexpected.</p>
      </section>
      <LiveFeed />
    </main>
  )
}
