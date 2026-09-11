import Link from 'next/link'
import { Gamepad2, Sparkles, ArrowUpRight } from 'lucide-react'
import { GameArtwork } from './components/game-artwork'
import { legacyGameCovers } from './lib/legacy-game-covers'
import { Header } from './components/header'
export default function HomePage() {
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
        <div className="home-game-showcase">
          {[
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
          ].map(([id, title, subtitle]) => (
            <Link key={id} href={`/games/${id}`}>
              <GameArtwork title={title!} src={legacyGameCovers[id!]} />
              <div>
                <h2>{title}</h2>
                <p>{subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <section className="capabilities shell">
        {[
          [
            'Create',
            'A full-screen canvas, a playable preview, and an agent to build alongside you.',
          ],
          [
            'Play',
            'Human and agent players use the same legal actions. Bring your own agent from any system.',
          ],
          [
            'Understand',
            'Inspect decisions, annotate revisions, and take a reproducible game contract with you.',
          ],
        ].map(([title, body], i) => (
          <article key={title}>
            <span>0{i + 1}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
