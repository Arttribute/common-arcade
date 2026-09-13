'use client'
import type { MatchDescriptor } from '@common-arcade/protocol'
import { useState } from 'react'
import { ArrowRight, Bot, Eye, RotateCcw, Trophy, User, X } from 'lucide-react'
import {
  STOPPED,
  formatDuration,
  matchOutcome,
  resultLabel,
  seatName,
} from './live-result'

export function LiveResultCard({
  match,
  ended,
  restart,
}: {
  match: MatchDescriptor
  ended: boolean
  /** Present when this viewer may start or vote for the next round. */
  restart?: { label: string; run: () => void }
}) {
  const [hidden, setHidden] = useState(false)
  const outcome = matchOutcome(match, ended)
  const seats = match.seats
  const series = match.series
  const rounds = series?.maximumRounds ?? 1
  const round = series?.currentRound ?? 1
  const multiRound = rounds > 1
  const winner =
    outcome.kind === 'winner'
      ? seats.find((seat) => seat.id === outcome.seatId)
      : undefined

  const headline =
    outcome.kind === 'winner' && winner
      ? `${seatName(winner, seats)} wins${
          outcome.scope === 'session' ? '' : multiRound ? ` round ${round}` : ''
        }`
      : outcome.kind === 'draw'
        ? outcome.scope === 'session'
          ? 'The session ends in a tie'
          : 'Draw'
        : outcome.kind === 'message'
          ? outcome.message
          : outcome.kind === 'stopped'
            ? (STOPPED[outcome.status] ?? 'Session interrupted')
            : 'Game over'

  const eyebrow =
    match.status !== 'completed'
      ? 'Session ended'
      : ended
        ? multiRound
          ? 'Final result'
          : 'Game over'
        : `Round ${round} of ${rounds} complete`

  const summary = ended
    ? match.status === 'completed'
      ? 'Thanks for playing.'
      : 'Play has stopped. Any completed rounds are recorded below.'
    : 'Your seats and agents are ready for the next round.'

  // The latest round's own result, only where it adds to the headline: the
  // deciding round under a session winner, a game's message alongside a
  // winner, or whatever was recorded before play stopped.
  const result = match.result
  const hasMessage =
    !!result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    typeof result.message === 'string'
  const roundDetail =
    result !== undefined &&
    outcome.kind !== 'message' &&
    (outcome.kind === 'stopped' ||
      hasMessage ||
      ('scope' in outcome && outcome.scope === 'session'))
      ? resultLabel(result, seats)
      : undefined

  const duration = formatDuration(match.createdAt, match.updatedAt)

  if (hidden)
    return (
      <div className="live-result-layer is-collapsed">
        <button
          type="button"
          className="live-result-reopen"
          onClick={() => setHidden(false)}
        >
          <Trophy size={16} aria-hidden />
          Show result
        </button>
      </div>
    )

  return (
    <div className="live-result-layer">
      <section
        className="live-result-card"
        aria-label={ended ? 'Session result' : 'Round result'}
      >
        <header className="live-result-head">
          <span className="live-result-eyebrow">
            <Trophy size={14} aria-hidden />
            {eyebrow}
          </span>
          <button
            type="button"
            className="live-result-dismiss"
            aria-label="Hide result to view the game"
            title="Hide result"
            onClick={() => setHidden(true)}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div role="status" aria-live="polite">
          <h2>{headline}</h2>
          <p>{summary}</p>
        </div>

        <div className="live-result-table">
          {multiRound ? (
            <div className="live-result-table-head" aria-hidden>
              <span>Player</span>
              <span>Rounds won</span>
            </div>
          ) : null}
          <ul aria-label={multiRound ? 'Rounds won by each player' : 'Players'}>
            {seats.map((seat) => {
              const isWinner = seat.id === winner?.id
              return (
                <li key={seat.id} className={isWinner ? 'is-winner' : ''}>
                  <span className="live-result-player">
                    <span className="live-result-avatar" aria-hidden>
                      {seat.controllerKind === 'agent' ? (
                        <Bot size={14} />
                      ) : (
                        <User size={14} />
                      )}
                    </span>
                    <span className="live-result-name">
                      {seatName(seat, seats)}
                      <small>
                        {seat.controllerKind === 'agent'
                          ? 'Agent'
                          : seat.controllerKind === 'human'
                            ? 'Human'
                            : seat.role}
                      </small>
                    </span>
                    {isWinner ? (
                      <span className="live-result-badge">Winner</span>
                    ) : null}
                  </span>
                  {multiRound ? (
                    <strong>{series?.scores[seat.id] ?? 0}</strong>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>

        <dl className="live-result-facts">
          {multiRound ? (
            <div>
              <dt>Rounds</dt>
              <dd>
                {round} of {rounds}
              </dd>
            </div>
          ) : null}
          {roundDetail && roundDetail !== headline ? (
            <div>
              <dt>{multiRound ? 'Last round' : 'Result'}</dt>
              <dd>{roundDetail}</dd>
            </div>
          ) : null}
          {duration ? (
            <div>
              <dt>Duration</dt>
              <dd>{duration}</dd>
            </div>
          ) : null}
        </dl>

        <div className="live-result-actions">
          {restart ? (
            <button
              type="button"
              className="primary compact"
              onClick={restart.run}
            >
              <RotateCcw size={16} aria-hidden />
              {restart.label}
            </button>
          ) : null}
          {ended ? (
            <a className="primary compact" href="/live">
              Find another session
              <ArrowRight size={16} aria-hidden />
            </a>
          ) : null}
          <button
            type="button"
            className="secondary compact live-result-view"
            onClick={() => setHidden(true)}
          >
            <Eye size={16} aria-hidden />
            View game
          </button>
        </div>
      </section>
    </div>
  )
}
