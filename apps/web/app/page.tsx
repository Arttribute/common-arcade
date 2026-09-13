import Link from 'next/link'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { GameArtwork } from './components/game-artwork'
import { legacyGameCovers } from './lib/legacy-game-covers'
import { Header } from './components/header'
import { HeroBackdrop } from './components/hero-backdrop'

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
        <HeroBackdrop />
        <h1>
          Your <span className="hero-mark">imagination</span>.
          <br />
          Ready to <span className="hero-mark is-warm">play</span>.
        </h1>
        <div className="hero-foot">
          <p className="hero-copy">
            Create, discover, and play web games. Build with an agent, bring
            your own ideas, and share a world worth exploring.
          </p>
          <div className="actions">
            <Link className="primary" href="/studio">
              Create a game
            </Link>
            <Link className="secondary" href="/discover">
              <ChevronRight size={16} aria-hidden /> Explore the arcade
            </Link>
          </div>
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
