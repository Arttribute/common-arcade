import { Header } from '../components/header'
import { LiveFeed } from '../components/live-feed'

export default function LivePage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <header className="page-heading shell">
        <h1>Live</h1>
        <p>Take a seat. Find a rival. Watch the unexpected.</p>
      </header>
      <LiveFeed />
    </main>
  )
}
