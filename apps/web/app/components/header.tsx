import Link from 'next/link'

export function Header() {
  return (
    <nav className="nav shell">
      <Link className="brand" href="/">
        <span className="brand-mark">CA</span>
        <span>Common Arcade</span>
      </Link>
      <div className="nav-links">
        <Link href="/discover">Discover</Link>
        <Link href="/play">Play</Link>
        <Link href="/studio">Studio</Link>
        <Link href="/agents">Agents</Link>
        <Link href="/docs">Docs</Link>
      </div>
    </nav>
  )
}
