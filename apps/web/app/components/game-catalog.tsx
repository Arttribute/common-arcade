'use client'
import type { GameManifest } from '@common-arcade/protocol'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Search, Users } from 'lucide-react'
import { legacyGameCovers } from '../lib/legacy-game-covers'
import { GameArtwork } from './game-artwork'

export function GameCatalog({ games: catalog }: { games: GameManifest[] }) {
  const games = catalog.map((game) => ({
    ...game,
    metadata: {
      ...game.metadata,
      thumbnail: game.metadata.thumbnail || legacyGameCovers[game.metadata.id],
    },
  }))
  const [query, setQuery] = useState(''),
    [mode, setMode] = useState('all'),
    [order, setOrder] = useState('az')
  const visible = games
    .filter(
      (g) =>
        (mode === 'all' || g.spec.mode === mode) &&
        `${g.metadata.title} ${g.metadata.summary} ${g.metadata.tags.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      order === 'az'
        ? a.metadata.title.localeCompare(b.metadata.title)
        : b.metadata.title.localeCompare(a.metadata.title),
    )
  /* Two editorially pinned games, falling back to alphabetical order if either
   * is missing or has no artwork. Only games with artwork are eligible, since
   * the tile is mostly image. The pinned ids are hard-coded here — changing
   * what the arcade leads with means editing this list. */
  const featured = games
    .filter((g) => g.metadata.thumbnail)
    .sort((a, b) => {
      const featuredIds = [
        'gam_cc8de8704f48428cb0cd4d3e3aba5810',
        'gam_310da5dfaaab49f080756583615e5af2',
      ]
      const rank = (id: string) =>
        featuredIds.includes(id) ? featuredIds.indexOf(id) : featuredIds.length
      return (
        rank(a.metadata.id) - rank(b.metadata.id) ||
        a.metadata.title.localeCompare(b.metadata.title)
      )
    })
    .slice(0, 2)
  return (
    <div className="catalog shell">
      {!query && mode === 'all' && featured.length > 0 && (
        <>
          <div className="catalog-heading">
            <h2>Featured this week</h2>
            <span>Hand-picked by the Arcade team</span>
          </div>
          <section className="catalog-featured" aria-label="Featured games">
            {featured.map((game) => (
              <Link
                key={game.metadata.id}
                href={`/games/${game.metadata.id}`}
                className="feature-game"
              >
                <GameArtwork
                  title={game.metadata.title}
                  src={game.metadata.thumbnail}
                />
                <div>
                  <span className="eyebrow">READY TO PLAY</span>
                  <h2>{game.metadata.title}</h2>
                  <p>{game.metadata.summary}</p>
                  <span className="feature-play">
                    Explore game <ArrowUpRight size={16} />
                  </span>
                </div>
              </Link>
            ))}
          </section>
        </>
      )}
      <div className="catalog-heading">
        <h2>Explore the arcade</h2>
        <span>
          {visible.length} {visible.length === 1 ? 'game' : 'games'}
        </span>
      </div>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search games"
            placeholder="Search games"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="catalog-filters" aria-label="Game type">
          {[
            ['all', 'All games'],
            ['realtime', 'Real time'],
            ['turn-based', 'Turn based'],
            ['simultaneous', 'Simultaneous'],
            ['hybrid', 'Hybrid'],
          ]
            .filter(
              ([id]) => id === 'all' || games.some((g) => g.spec.mode === id),
            )
            .map(([id, label]) => (
              <button
                key={id}
                aria-pressed={mode === id}
                onClick={() => setMode(id!)}
              >
                {label}
              </button>
            ))}
        </div>
        <select
          aria-label="Sort games"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        >
          <option value="az">Name: A–Z</option>
          <option value="za">Name: Z–A</option>
        </select>
      </div>
      <section className="catalog-grid" aria-label="Games">
        {visible.map((game) => (
          <Link
            className="catalog-card"
            href={`/games/${game.metadata.id}`}
            key={game.metadata.id}
          >
            <GameArtwork
              title={game.metadata.title}
              src={game.metadata.thumbnail}
            />
            <div className="catalog-card-info">
              <div>
                <h3>{game.metadata.title}</h3>
                <p>{game.metadata.summary}</p>
              </div>
              <span className="play-pill">Play</span>
            </div>
            <div className="catalog-card-meta">
              <span>{game.spec.mode.replaceAll('-', ' ')}</span>
              <span>
                <Users size={12} />
                {game.spec.seats.min === game.spec.seats.max
                  ? game.spec.seats.max
                  : `${game.spec.seats.min}–${game.spec.seats.max}`}{' '}
                players
              </span>
            </div>
          </Link>
        ))}
      </section>
      {!visible.length && (
        <div className="catalog-empty">
          <Search size={26} />
          <h2>
            {games.length
              ? 'No games found'
              : 'The next great game could be yours.'}
          </h2>
          <p>
            {games.length
              ? 'Try a different name or game type.'
              : 'Create a game in Studio and share it with the arcade.'}
          </p>
          {games.length ? (
            <button
              className="secondary"
              onClick={() => {
                setQuery('')
                setMode('all')
              }}
            >
              Clear filters
            </button>
          ) : (
            <Link className="primary" href="/studio">
              Create a game
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
