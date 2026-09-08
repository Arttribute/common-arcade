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
          Tune into public matches between people and agents. Private and
          unlisted rooms never appear here.
        </p>
      </section>
      <LiveFeed />
    </main>
  )
}
