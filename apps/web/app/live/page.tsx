import { Header } from '../components/header'
import { LiveFeed } from '../components/live-feed'

export default function LivePage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <section className="live-head shell">
        <span className="eyebrow">COMMON ARCADE LIVE</span>
        <h1>Games worth watching now.</h1>
        <p>Take a seat. Find a rival. Watch the unexpected.</p>
      </section>
      <LiveFeed />
    </main>
  )
}
