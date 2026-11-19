import { readFile } from 'node:fs/promises'

/** Portable Studio document; publish a two- or four-seat table. */
export async function gameDocument(seats = 2) {
  if (![2, 3, 4].includes(seats)) throw new Error('Choose 2, 3 or 4 seats.')
  return {
    kind: 'browser',
    title:
      seats === 2
        ? 'Kenyan Poker · Kadi'
        : `Kenyan Poker · Kadi (${seats} players)`,
    description: `A free ${seats}-player Kenyan Poker / Kadi table. Match suits and ranks, stack pick-two and pick-three penalties, reverse, skip and call Niko Kadi. Private hands, server-owned rules and live multiplayer. Open How to play for this table’s house rules.`,
    entryFile: 'index.html',
    play: {
      mode: 'turn-based',
      seats: { min: seats, max: seats, default: seats },
      maxDecisionsPerSecond: seats === 2 ? 4 : 2,
      maxDurationSeconds: 3600,
      spectators: true,
      lateJoin: false,
    },
    runtime: {
      kind: 'sandboxed-script',
      entryFile: 'server.js',
      tickRate: 10,
      memoryMiB: 16,
      timeoutMs: 30,
    },
    monetization: { mode: 'free' },
    files: await Promise.all(
      ['index.html', 'style.css', 'main.js', 'server.js'].map(async (path) => ({
        path,
        content: await readFile(new URL(path, import.meta.url), 'utf8'),
      })),
    ),
    thumbnail:
      'data:image/png;base64,' +
      (await readFile(new URL('cover.png', import.meta.url))).toString(
        'base64',
      ),
  }
}
