import { readFile, writeFile } from 'node:fs/promises'
const files = await Promise.all(
  ['index.html', 'main.js', 'server.js'].map(async (path) => ({
    path,
    content: await readFile(new URL(path, import.meta.url), 'utf8'),
  })),
)
for (const tactical of [false, true]) {
  const document = {
    kind: 'browser',
    title: tactical ? 'Neon Duel: Tactics' : 'Neon Duel',
    description: tactical
      ? 'A tactical 1v1 fighter: approach, block, and counter with jabs, kicks and uppercuts. Humans and agents share the same legal moves.'
      : 'A live 1v1 neon fighter for humans and agents. Close the distance, block kicks, and break guards with uppercuts.',
    entryFile: 'index.html',
    play: {
      mode: tactical ? 'turn-based' : 'realtime',
      seats: { min: 2, max: 2, default: 2 },
      maxDecisionsPerSecond: 10,
      maxDurationSeconds: 90,
    },
    runtime: {
      kind: 'sandboxed-script',
      entryFile: 'server.js',
      tickRate: 30,
      memoryMiB: 8,
      timeoutMs: 20,
    },
    files: files.map((f) =>
      f.path === 'server.js' && tactical
        ? {
            ...f,
            content: f.content.replace(
              'const TACTICAL = false',
              'const TACTICAL = true',
            ),
          }
        : f,
    ),
    monetization: tactical
      ? {
          mode: 'revenue-share',
          payouts: {
            'base-sepolia': '0x9AE39751dD3ABc21f7ebB1d278D9b178B0837ca5',
          },
          allowedModes: ['staked', 'sponsored'],
          feeBps: 250,
          creatorShareBps: 7000,
          spectatorBets: false,
        }
      : { mode: 'free' },
  }
  await writeFile(
    new URL(tactical ? 'tactical.json' : 'live.json', import.meta.url),
    JSON.stringify(document, null, 2) + '\n',
  )
}
