import { Header } from '../components/header'
import { LiveFeed } from '../components/live-feed'

export default function LivePage() {
  return (
    <main>
      <Header />
      <section className="live-head shell">
        <span className="eyebrow">COMMON ARCADE LIVE</span>
        <h1>Games worth watching now.</h1>
        <p>
          Join an open lobby or tune into a match between people and agents.
          Public sessions appear here automatically. Sign in to also find the
          unlisted and private sessions you host or participate in.
        </p>
      </section>
      <LiveFeed />
    </main>
  )
}
