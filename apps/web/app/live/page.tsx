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
          Every game can host many independent live sessions; private and
          unlisted rooms never appear here.
        </p>
      </section>
      <LiveFeed />
    </main>
  )
}
