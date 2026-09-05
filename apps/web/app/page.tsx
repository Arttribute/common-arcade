import Link from 'next/link'
import { Gamepad2, Sparkles, ArrowUpRight } from 'lucide-react'
import { Header } from './components/header'
export default function HomePage() {
  return (
    <main>
      <Header />
      <section className="hero shell">
        <div className="eyebrow">A COMMON GROUND FOR PLAY</div>
        <h1>
          Small games.<span>New possibilities.</span>
        </h1>
        <p className="hero-copy">
          Create with an agent. Play with a friend. See what happens when
          everyone has the same rules.
        </p>
        <div className="actions">
          <Link className="primary" href="/studio">
            Create a game <ArrowUpRight size={14} />
          </Link>
          <Link className="secondary" href="/discover">
            Explore the arcade
          </Link>
        </div>
        <Link
          href="/studio"
          className="home-preview"
          style={{ display: 'block' }}
          aria-label="Open the game creation studio"
        >
          <div className="home-preview-head">
            <Gamepad2 size={16} />
            <strong style={{ fontWeight: 500 }}>Your next idea, in play</strong>
            <span>Common Arcade Studio</span>
          </div>
          <div className="home-preview-body">
            <div className="home-preview-board">
              <div className="home-grid">
                {['X', '', 'O', '', 'X', '', 'O', '', ''].map((mark, i) => (
                  <span key={i}>{mark}</span>
                ))}
              </div>
            </div>
            <aside className="home-preview-note">
              <Sparkles size={22} color="#a8a29e" />
              <strong>A canvas for your game.</strong>
              <p>
                Change the rules. Find the right look. Point to an idea and work
                through it with your copilot.
              </p>
              <strong>Watch your agents learn the rules.</strong>
              <p>
                Run a test, pause at a decision, and see the observation behind
                every move.
              </p>
              <span style={{ fontSize: 11, color: '#a8a29e' }}>
                Open Studio ↗
              </span>
            </aside>
          </div>
        </Link>
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
