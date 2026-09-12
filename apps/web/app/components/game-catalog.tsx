'use client'
import type { GameManifest } from '@common-arcade/protocol'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Search, Users } from 'lucide-react'
import { legacyGameCovers } from '../lib/legacy-game-covers'
import { GameArtwork } from './game-artwork'
import { SelectMenu } from './ui/select-menu'

const MODES = [
  ['realtime', 'Real time'],
  ['turn-based', 'Turn based'],
  ['simultaneous', 'Simultaneous'],
  ['hybrid', 'Hybrid'],
] as const
// While browsing, each game type shows two rows of the compact grid.
const SECTION_LIMIT = 8

type CatalogGame = GameManifest & {
  metadata: GameManifest['metadata'] & { thumbnail?: string }
}

function players(game: CatalogGame) {
  const { min, max } = game.spec.seats
  return min === max ? `${max}` : `${min}–${max}`
}

function GameCard({
  game,
  showMode,
}: {
  game: CatalogGame
  showMode: boolean
}) {
  return (
    <Link className="catalog-card" href={`/games/${game.metadata.id}`}>
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
        {showMode ? <span>{game.spec.mode.replaceAll('-', ' ')}</span> : null}
        <span>
          <Users size={12} />
          {players(game)} players
        </span>
      </div>
    </Link>
  )
}

export function GameCatalog({ games: catalog }: { games: GameManifest[] }) {
  const games: CatalogGame[] = catalog.map((game) => ({
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
  const browsing = !query && mode === 'all'
  const knownModes = new Set<string>(MODES.map(([id]) => id))
  // Group by game type while browsing; anything with an unrecognised mode still shows.
  const sections = [
    ...MODES.map(([id, label]) => ({
      id,
      label,
      games: visible.filter((g) => g.spec.mode === id),
      filterable: true,
    })),
    {
      id: 'other',
      label: 'More games',
      games: visible.filter((g) => !knownModes.has(g.spec.mode)),
      filterable: false,
    },
  ].filter((section) => section.games.length > 0)

  return (
    <div className="catalog shell">
      {browsing && featured.length > 0 && (
        <section className="catalog-featured" aria-label="In the arcade">
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
          {[['all', 'All games'] as const, ...MODES]
            .filter(
              ([id]) => id === 'all' || games.some((g) => g.spec.mode === id),
            )
            .map(([id, label]) => (
              <button
                key={id}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
        </div>
        <SelectMenu
          compact
          label="Sort games"
          value={order}
          options={[
            { value: 'az', label: 'Name: A–Z' },
            { value: 'za', label: 'Name: Z–A' },
          ]}
          onChange={setOrder}
        />
      </div>
      {browsing ? (
        sections.map((section) => (
          <section
            key={section.id}
            className="catalog-section"
            aria-labelledby={`catalog-${section.id}`}
          >
            <div className="catalog-section-head">
              <h3 id={`catalog-${section.id}`}>{section.label}</h3>
              <span>{section.games.length}</span>
              {section.filterable && section.games.length > SECTION_LIMIT ? (
                <button type="button" onClick={() => setMode(section.id)}>
                  See all
                </button>
              ) : null}
            </div>
            <div className="catalog-grid compact">
              {(section.filterable
                ? section.games.slice(0, SECTION_LIMIT)
                : section.games
              ).map((game) => (
                <GameCard key={game.metadata.id} game={game} showMode={false} />
              ))}
            </div>
          </section>
        ))
      ) : visible.length ? (
        <section className="catalog-grid compact" aria-label="Games">
          {visible.map((game) => (
            <GameCard key={game.metadata.id} game={game} showMode />
          ))}
        </section>
      ) : null}
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
