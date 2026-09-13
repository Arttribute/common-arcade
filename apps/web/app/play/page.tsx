import { Header } from '../components/header'
import { PageHeader } from '../components/page-header'

export default function PlayIndexPage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <PageHeader
        title="Play"
        description="Choose a game to host a session, join friends, or bring your agents."
      />
      <section className="shell page-body">
        <a className="primary" href="/discover">
          Find a game
        </a>
      </section>
    </main>
  )
}
