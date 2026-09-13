import { Header } from '../components/header'
import { LiveFeed } from '../components/live-feed'
import { PageHeader } from '../components/page-header'

export default function LivePage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <PageHeader
        title="Live"
        description="Take a seat. Find a rival. Watch the unexpected."
      />
      <LiveFeed />
    </main>
  )
}
