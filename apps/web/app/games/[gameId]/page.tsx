import { RecordingShelf } from '../../components/recording-shelf'
import { CompiledArtifactFrame } from '@agent-commons/ui'
import {
  compilePresentation,
  starterDocument,
  isBrowserGame,
  assessLiveReadiness,
  type StudioRelease,
} from '@common-arcade/studio'
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
  const releaseId = releaseList.releases.at(-1)?.id
  if (releaseId === undefined) notFound()
  const customResponse = await fetch(
    `${api}/v1/studio/releases/${encodeURIComponent(releaseId)}`,
    { cache: 'no-store' },
  )
  const customRelease = customResponse.ok
    ? ((await customResponse.json()) as StudioRelease)
    : undefined
  const document = customRelease?.document ?? {
    ...starterDocument,
    title: game.metadata.title,
  }
  const browserGame = !assessLiveReadiness(document).liveReady
  return (
    <main>
      <Header />
      <section className="game-detail shell">
        <span className="eyebrow">
          {game.metadata.namespace} / {game.metadata.version}
        </span>
        <h1>{game.metadata.title}</h1>
        <p>{game.metadata.summary}</p>
        {document.monetization?.mode === 'revenue-share' && (
          <p>
            {game.spec.mode === 'turn-based' &&
            game.spec.seats.min <= 2 &&
            game.spec.seats.max >= 2 ? (
              <>
                Optional {document.monetization.allowedModes.join(' / ')}{' '}
                matches · 2.5% success fee ·{' '}
                {document.monetization.creatorShareBps / 100}% of that fee
                supports the creator. Free play remains available.{' '}
                <a href={`/play/paid/${releaseId}`}>Open play & earn</a>
              </>
            ) : (
              'Free live play. Open payment controls to manage agent wallets and service payments. Entry stakes and prize pools are not available for this realtime release yet.'
            )}
          </p>
        )}
        <div className="profile-list">
          <span>{game.spec.mode.replaceAll('-', ' ')}</span>
          <span>
            {game.spec.seats.min}–{game.spec.seats.max} players
          </span>
          <span>
            {browserGame ? 'Local preview' : 'Play with friends & agents'}
          </span>
        </div>
        <div className="game-detail-actions">
          <MatchLauncher
            releaseId={releaseId}
            gameId={gameId}
            browserGame={browserGame}
            remixing={customRelease?.distribution?.remixing}
            license={customRelease?.distribution?.license}
            paymentTerms={document.monetization}
            paidMatchSupported={
              game.spec.mode === 'turn-based' &&
              game.spec.seats.min <= 2 &&
              game.spec.seats.max >= 2
            }
          />
        </div>
      </section>
      <section
        id="game-preview"
        className="shell"
        style={{
          height: 540,
          border: '1px solid #e7e5e4',
          borderRadius: 12,
          overflow: 'hidden',
          marginBottom: 40,
        }}
        aria-label={
          browserGame ? 'Local preview, not a live session' : 'Try this game'
        }
      >
        <CompiledArtifactFrame
          preview={{ type: 'html', html: compilePresentation(document) }}
          title={`${game.metadata.title} — local practice`}
        />
      </section>
      <div className="shell">
        <RecordingShelf gameId={gameId} />
      </div>
      <details className="technical-details shell">
        <summary>Game details & compatibility</summary>
        <section className="contract-grid">
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
            <p>
              {browserGame
                ? 'Browser preview only. It cannot create a synchronized live lobby.'
                : 'Content-addressed and replayable under the declared profile.'}
            </p>
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
        {isBrowserGame(document) && document.capabilities ? (
          <section className="capability-contract shell">
            <div>
              <span className="panel-label">WORLD</span>
              <strong>{document.capabilities.world.persistence}</strong>
              <p>
                {document.capabilities.world.cadence} ·{' '}
                {document.capabilities.world.authority}
              </p>
            </div>
            <div>
              <span className="panel-label">PRESENTATION</span>
              <strong>
                {document.capabilities.presentation.dimension} ·{' '}
                {document.capabilities.presentation.engine}
              </strong>
              <p>
                {document.capabilities.presentation.contentPipeline?.authoringTools.includes(
                  'blender',
                )
                  ? 'Blender → web-optimized ' +
                    document.capabilities.presentation.contentPipeline.runtimeFormats.join(
                      ' / ',
                    )
                  : 'Web-native presentation pipeline'}
              </p>
            </div>
            <div>
              <span className="panel-label">TEAMS</span>
              <strong>
                {document.capabilities.teams.enabled
                  ? `${document.capabilities.teams.maxTeams} teams · ${document.capabilities.teams.control}`
                  : 'Individual play'}
              </strong>
              <p>
                {document.capabilities.teams.enabled
                  ? `${document.capabilities.teams.membersPerTeam} seats per team`
                  : 'No shared team controller'}
              </p>
            </div>
            <div>
              <span className="panel-label">ECONOMY</span>
              <strong>{document.capabilities.economy.payments}</strong>
              <p>
                {document.capabilities.economy.payments === 'integration-ready'
                  ? 'Hooks declared; payments are not active.'
                  : 'No payment capability requested.'}
              </p>
            </div>
          </section>
        ) : null}
        <section className="manifest-block">
          <details>
            <summary className="panel-label">View the agent contract</summary>
            <pre>{JSON.stringify(game, null, 2)}</pre>
          </details>
        </section>
      </details>
    </main>
  )
}
