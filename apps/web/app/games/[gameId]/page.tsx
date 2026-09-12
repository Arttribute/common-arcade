import './game-detail.css'
import Link from 'next/link'
import {
  ArrowLeft,
  Circle,
  Gamepad2,
  Users,
  Radio,
  Square,
  X,
} from 'lucide-react'
import { legacyGameCovers } from '../../lib/legacy-game-covers'
import { GameArtwork } from '../../components/game-artwork'
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
  const artwork =
    game.metadata.thumbnail ?? document.thumbnail ?? legacyGameCovers[gameId]
  const paidMatchSupported =
    game.spec.mode === 'turn-based' &&
    game.spec.seats.min <= 2 &&
    game.spec.seats.max >= 2
  return (
    <main className="arcade game-store-page" id="main">
      <div className="game-store-layout">
        <aside
          className="game-store-art"
          aria-label={`${game.metadata.title} artwork and play`}
        >
          <Link
            href="/discover"
            className="game-store-back"
            aria-label="Back to Discover"
            title="Back to Discover"
          >
            <ArrowLeft size={18} />
          </Link>
          <GameArtwork
            title={game.metadata.title}
            src={artwork}
            mode={game.spec.mode}
          />
          <div className="game-store-action-shelf">
            <div className="game-store-game-icon" aria-hidden="true">
              <GameArtwork
                title={game.metadata.title}
                src={artwork}
                mode={game.spec.mode}
              />
            </div>
            <div className="game-store-action-copy">
              <strong>{game.metadata.title}</strong>
              <span>
                {browserGame
                  ? 'Play in your browser'
                  : 'Play with friends & agents'}
              </span>
            </div>
            <MatchLauncher
              releaseId={releaseId}
              gameId={gameId}
              browserGame={browserGame}
              remixing={customRelease?.distribution?.remixing}
              license={customRelease?.distribution?.license}
              paymentTerms={document.monetization}
              paidMatchSupported={paidMatchSupported}
            />
          </div>
        </aside>
        <article className="game-store-story">
          <header className="game-store-heading">
            <span className="eyebrow">Common Arcade</span>
            <h1>
              <span>{game.metadata.title}</span>
            </h1>
            <p>{game.metadata.summary}</p>
          </header>
          <div className="game-store-facts" aria-label="Game overview">
            <span>
              <Gamepad2 size={16} />
              {game.spec.mode.replaceAll('-', ' ')}
            </span>
            <span>
              <Users size={16} />
              {game.spec.seats.min === game.spec.seats.max
                ? game.spec.seats.min
                : `${game.spec.seats.min}–${game.spec.seats.max}`}{' '}
              players
            </span>
            <span>
              <Radio size={16} />
              {browserGame ? 'Local preview' : 'Live multiplayer'}
            </span>
          </div>
          <section
            className="game-store-media"
            aria-labelledby="game-preview-heading"
          >
            <div className="game-store-section-heading">
              <h2 id="game-preview-heading">Try the game</h2>
              <span>Local practice</span>
            </div>
            <div
              id="game-preview"
              className="game-store-preview"
              aria-label={
                browserGame
                  ? 'Local preview, not a live session'
                  : 'Try this game'
              }
            >
              <CompiledArtifactFrame
                recordingLabels={{
                  start: (
                    <>
                      <Circle size={12} aria-hidden="true" /> Record interaction
                    </>
                  ),
                  stop: (
                    <>
                      <Square size={12} aria-hidden="true" /> Stop recording
                    </>
                  ),
                  dismissError: <X size={14} aria-hidden="true" />,
                }}
                preview={{ type: 'html', html: compilePresentation(document) }}
                title={`${game.metadata.title} — local practice`}
              />
            </div>
            <p className="game-store-caption">
              {browserGame
                ? 'Play this preview here. A live-ready release is needed to host a shared session.'
                : 'Explore the game here, then choose Play to join or host a live session.'}
            </p>
          </section>
          <div className="game-store-recordings">
            <RecordingShelf gameId={gameId} />
          </div>
          {document.monetization?.mode === 'revenue-share' && (
            <details className="game-store-disclosure">
              <summary>Play & earnings</summary>
              <p>
                {paidMatchSupported ? (
                  <>
                    Free play remains available. Optional{' '}
                    {document.monetization.allowedModes.join(' / ')} matches
                    charge a 2.5% success fee;{' '}
                    {document.monetization.creatorShareBps / 100}% of that fee
                    supports the creator.{' '}
                    <Link href={`/play/paid/${releaseId}`}>
                      Open play & earn
                    </Link>
                    .
                  </>
                ) : (
                  'Free live play. Payment controls let you manage agent wallets and service payments. Entry stakes and prize pools are not available for this realtime release yet.'
                )}
              </p>
              <Link href="/docs">
                Learn how game payments work{' '}
                <ArrowLeft size={14} className="game-store-forward" />
              </Link>
            </details>
          )}
          <details className="game-store-disclosure game-store-compatibility">
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
              <section className="capability-contract">
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
                    {document.capabilities.economy.payments ===
                    'integration-ready'
                      ? 'Hooks declared; payments are not active.'
                      : 'No payment capability requested.'}
                  </p>
                </div>
              </section>
            ) : null}
            <section className="manifest-block">
              <details>
                <summary className="panel-label">
                  View the agent contract
                </summary>
                <pre>{JSON.stringify(game, null, 2)}</pre>
              </details>
            </section>
          </details>
          <footer className="game-store-footer">
            Version {game.metadata.version}
            {customRelease?.distribution?.license
              ? ` · ${customRelease.distribution.license}`
              : ''}
          </footer>
        </article>
      </div>
    </main>
  )
}
