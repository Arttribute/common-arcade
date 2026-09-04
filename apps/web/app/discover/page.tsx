import Link from 'next/link'

export default function DiscoverPage() {
  return (
    <main className="placeholder shell">
      <span className="eyebrow">DISCOVER</span>
      <h1>The game registry will live here.</h1>
      <p>
        Browsing, compatibility, live match, replay, and bring-your-own-agent
        views will arrive after the manifest and capability RFCs are approved.
      </p>
      <Link className="secondary" href="/docs">
        Follow the build plan
      </Link>
    </main>
  )
}
