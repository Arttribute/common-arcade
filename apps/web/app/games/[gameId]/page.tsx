import type { GameManifest } from '@common-arcade/protocol'
import { notFound } from 'next/navigation'
import { Header } from '../../components/header'
import { MatchLauncher } from '../../components/match-launcher'

export const dynamic = 'force-dynamic'

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const { gameId } = await params
  const api = process.env.ARCADE_API_URL ?? 'http://localhost:4100'
  const response = await fetch(
    `${api}/v1/games/${encodeURIComponent(gameId)}`,
    { cache: 'no-store' },
  ).catch(() => undefined)
  if (response === undefined || !response.ok) notFound()
  const game = (await response.json()) as GameManifest
  const releaseResponse = await fetch(
    `${api}/v1/games/${encodeURIComponent(gameId)}/releases`,
    { cache: 'no-store' },
  )
  if (!releaseResponse.ok) notFound()
  const releaseList = (await releaseResponse.json()) as {
    releases: Array<{ id: string }>
  }
  const releaseId = releaseList.releases[0]?.id
  if (releaseId === undefined) notFound()
  return (
    <main>
      <Header />
      <section className="game-detail shell">
        <div>
          <span className="eyebrow">
            {game.metadata.namespace} / {game.metadata.version}
          </span>
          <h1>{game.metadata.title}</h1>
          <p>{game.metadata.summary}</p>
          <div className="profile-list">
            {game.spec.profiles.map((profile) => (
              <span key={profile}>{profile}</span>
            ))}
          </div>
        </div>
        <MatchLauncher releaseId={releaseId} />
      </section>
      <section className="contract-grid shell">
        <article>
          <span>MODE</span>
          <strong>{game.spec.mode}</strong>
          <p>
            {game.spec.seats.min}–{game.spec.seats.max} seats · spectators{' '}
            {game.spec.seats.spectators ? 'allowed' : 'disabled'}
          </p>
        </article>
        <article>
          <span>RUNTIME</span>
          <strong>{game.spec.runtime.type}</strong>
          <p>Content-addressed and replayable under the declared profile.</p>
        </article>
        <article>
          <span>AGENT CONTRACT</span>
          <strong>{game.spec.policy.tiers.join(', ')}</strong>
          <p>
            {game.spec.policy.maxDecisionsPerSecond} decisions/s ·{' '}
            {game.spec.policy.memoryKiB} KiB policy memory
          </p>
        </article>
      </section>
      <section className="manifest-block shell">
        <span className="panel-label">CANONICAL MANIFEST</span>
        <pre>{JSON.stringify(game, null, 2)}</pre>
      </section>
    </main>
  )
}
