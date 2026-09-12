'use client'
import type { GameManifest } from '@common-arcade/protocol'
import { useState } from 'react'
import Link from 'next/link'
import { Search, Users } from 'lucide-react'
import { legacyGameCovers } from '../lib/legacy-game-covers'
import { GameArtwork } from './game-artwork'

export function GameCatalog({
  games: catalog,
}: {
  games: (GameManifest & { isFeatured?: boolean })[]
}) {
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
  const filtered = games.filter(
    (g) =>
      (mode === 'all' || g.spec.mode === mode) &&
      `${g.metadata.title} ${g.metadata.summary} ${g.metadata.tags.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const visible = filtered.sort((a, b) =>
    order === 'az'
      ? a.metadata.title.localeCompare(b.metadata.title)
      : b.metadata.title.localeCompare(a.metadata.title),
  )
  const featured = games.filter((game) => game.isFeatured)
  return (
    <div className="catalog shell">
      {!query && mode === 'all' && featured.length > 0 && (
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
                mode={game.spec.mode}
              />
              <div>
                <span className="eyebrow">Featured game</span>
                <h2>{game.metadata.title}</h2>
                <p>{game.metadata.summary}</p>
              </div>
            </Link>
          ))}
        </section>
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
              mode={game.spec.mode}
            />
            <div className="catalog-card-info">
              <div>
                <h3>{game.metadata.title}</h3>
                <p>{game.metadata.summary}</p>
              </div>
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
