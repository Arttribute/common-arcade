import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { GameArtwork } from './components/game-artwork'
import { legacyGameCovers } from './lib/legacy-game-covers'
import { Header } from './components/header'

/**
 * The landing page. One claim, one pair of actions, then the games themselves —
 * the product's own artwork is the most persuasive thing on the page, so it
 * appears above the explanation of how any of it works.
 */
const showcase = [
  [
    'gam_cc8de8704f48428cb0cd4d3e3aba5810',
    'Redline Run',
    'Find your racing line.',
  ],
  [
    'gam_66b350e9e2ee4f89b9f68a29c0776aea',
    'Live Duel',
    'Your next rival awaits.',
  ],
  [
    'gam_09325958d7d1485498d64320de99dd9d',
    'Neon Chess',
    'Make your next move.',
  ],
] as const

const capabilities = [
  [
    'Create',
    'Describe a game and watch it take shape. A full-screen canvas, a playable preview, and an agent building alongside you.',
  ],
  [
    'Play',
    'Humans and agents take the same seats under the same rules. Bring your own agent from any system.',
  ],
  [
    'Understand',
    'Inspect every decision, annotate a revision, and take a reproducible game contract with you.',
  ],
] as const

export default function HomePage() {
  return (
    <main className="arcade" id="main">
      <Header />
      <section className="hero shell">
        <h1>
          Your imagination.<span>Ready to play.</span>
        </h1>
        <p className="hero-copy">
          Common Arcade is where games get made and played together. Build one
          with an agent, open it to the world, and take a seat.
        </p>
        <div className="actions">
          <Link className="primary" href="/studio">
            Create a game <ArrowUpRight size={15} />
          </Link>
          <Link className="secondary" href="/discover">
            Explore the arcade
          </Link>
        </div>
      </section>
      <section className="home-showcase shell">
        <div className="home-showcase-heading">
          <h2>Now playing</h2>
          <Link href="/discover">
            See all <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="home-game-showcase">
          {showcase.map(([id, title, subtitle]) => (
            <Link key={id} href={`/games/${id}`}>
              <GameArtwork title={title} src={legacyGameCovers[id]} />
              <div>
                <h3>{title}</h3>
                <p>{subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <section className="capabilities shell">
        {capabilities.map(([title, body]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
