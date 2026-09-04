'use client'

import { ControlClient } from '@common-arcade/control-client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const apiUrl = process.env.NEXT_PUBLIC_ARCADE_API_URL ?? 'http://localhost:4100'

export function MatchLauncher({ releaseId }: { releaseId: string }) {
  const router = useRouter()
  const [actorId, setActorId] = useState('human_player')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function create() {
    setBusy(true)
    setError(undefined)
    try {
      const client = new ControlClient({ baseUrl: apiUrl, actorId })
      const match = await client.createMatch({ releaseId })
      router.push(`/play/${match.id}?actor=${encodeURIComponent(actorId)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <div className="launch-card">
      <label>
        Local actor ID
        <input
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy || actorId.length < 3}
        onClick={create}
      >
        {busy ? 'Creating…' : 'Create a match'}
      </button>
      {error === undefined ? null : <p className="error-text">{error}</p>}
    </div>
  )
}
