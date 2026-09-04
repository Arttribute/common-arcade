import Link from 'next/link'

export default function StudioPage() {
  return (
    <main className="placeholder shell">
      <span className="eyebrow">TEST ARENA + STUDIO</span>
      <h1>Build with agents. Watch everything happen.</h1>
      <p>
        The studio seam is reserved for compiled previews, agent test matches,
        timeline logs, policy decisions, annotations, and replay inspection.
      </p>
      <Link className="secondary" href="/docs/architecture">
        Read the architecture boundary
      </Link>
    </main>
  )
}
