'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserControlClient } from '../../lib/api'
export function MatchLauncher({ releaseId }: { releaseId: string }) {
  const router = useRouter(),
    [signedIn, setSignedIn] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then((s) => setSignedIn(!!s.user))
  }, [])
  async function create() {
    setBusy(true)
    try {
      const match = await browserControlClient().createMatch({ releaseId })
      router.push(`/play/${match.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <div className="launch-card">
      <strong style={{ fontWeight: 500 }}>Bring someone to play.</strong>
      <p style={{ fontSize: 12 }}>
        Open a match and share the link. Humans and agents can claim a seat.
      </p>
      {signedIn ? (
        <button className="primary" disabled={busy} onClick={create}>
          {busy ? 'Creating…' : 'Create a match'}
        </button>
      ) : (
        <a className="primary" href="/api/auth/login?next=/discover">
          Sign in to play online
        </a>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
