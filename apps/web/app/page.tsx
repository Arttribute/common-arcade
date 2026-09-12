import Link from 'next/link'
import { ArrowUpRight, Sparkles, Users, Eye } from 'lucide-react'
import { GameArtwork } from './components/game-artwork'
import { legacyGameCovers } from './lib/legacy-game-covers'
import { Header } from './components/header'

const showcase = [
  {
    id: 'gam_cc8de8704f48428cb0cd4d3e3aba5810',
    title: 'Redline Run',
    subtitle: 'Find your racing line.',
  },
  {
    id: 'gam_66b350e9e2ee4f89b9f68a29c0776aea',
    title: 'Live Duel',
    subtitle: 'Your next rival awaits.',
  },
  {
    id: 'gam_09325958d7d1485498d64320de99dd9d',
    title: 'Neon Chess',
    subtitle: 'Make your next move.',
  },
]

const spotlights = [
  {
    icon: Sparkles,
    title: 'Create',
    body: 'A full-screen canvas, a playable preview, and an agent to build alongside you.',
  },
  {
    icon: Users,
    title: 'Play',
    body: 'Human and agent players use the same legal actions. Bring your own agent from any system.',
  },
  {
    icon: Eye,
    title: 'Understand',
    body: 'Inspect decisions, annotate revisions, and take a reproducible game contract with you.',
  },
]

export default function HomePage() {
  const hero = showcase[0]!
  const rest = showcase.slice(1)
  return (
    <main>
      <Header />
      <section className="hero shell">
        <div className="eyebrow">A COMMON GROUND FOR PLAY</div>
        <h1>
          Your imagination.<span>Ready to play.</span>
        </h1>
        <p className="hero-copy">
          Create, discover, and play web games. Build with an agent, bring your
          own ideas, and share a world worth exploring.
        </p>
        <div className="actions">
          <Link className="primary" href="/studio">
            Create a game <ArrowUpRight size={14} />
          </Link>
          <Link className="secondary" href="/discover">
            Explore the arcade
          </Link>
        </div>
      </section>

      <section className="home-hero-banner shell">
        <div className="home-hero-banner-copy">
          <span className="home-hero-badge">
            <Sparkles size={12} /> FEATURED GAME
          </span>
          <h2>{hero.title}</h2>
          <p>{hero.subtitle}</p>
          <Link className="feature-play" href={`/games/${hero.id}`}>
            Play now <ArrowUpRight size={16} />
          </Link>
        </div>
        <Link href={`/games/${hero.id}`} className="home-hero-banner-art">
          <GameArtwork title={hero.title} src={legacyGameCovers[hero.id]} />
        </Link>
      </section>

      <section className="home-row shell">
        <div className="home-row-head">
          <h2>More to play</h2>
          <Link href="/discover">
            See all games <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="catalog-featured">
          {rest.map(({ id, title, subtitle }) => (
            <Link key={id} href={`/games/${id}`} className="feature-game">
              <GameArtwork title={title} src={legacyGameCovers[id]} />
              <div>
                <span className="eyebrow">READY TO PLAY</span>
                <h2>{title}</h2>
                <p>{subtitle}</p>
                <span className="feature-play">
                  Play now <ArrowUpRight size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-spotlights shell">
        <div className="home-row-head">
          <h2>Built for creators and agents</h2>
        </div>
        <div className="home-spotlight-grid">
          {spotlights.map(({ icon: Icon, title, body }) => (
            <article key={title}>
              <span className="home-spotlight-icon">
                <Icon size={20} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
