import { ARCADE_PROTOCOL } from '@common-arcade/protocol'
import { ArcadeApiError, ControlClient } from '@common-arcade/control-client'

export interface RunCliOptions {
  readonly args: string[]
  readonly env?: NodeJS.ProcessEnv
  readonly write?: (value: string) => void
  readonly fetch?: typeof globalThis.fetch
}

const HELP = `Common Arcade CLI (${ARCADE_PROTOCOL.stability})

Commands:
  status                              Inspect the control plane
  doctor                              Check API and runtime prerequisites
  games search [query]                Discover compatible games
  games info <game-id>                Print a canonical game manifest
  matches create --release <id>       Create a match
  matches inspect <match-id>          Inspect lifecycle and roster
  replay show <match-id>              Print an authoritative replay
  version                             Print protocol status

Environment:
  ARCADE_API_URL                      Defaults to http://localhost:4100
  ARCADE_ACTOR_ID                     Local actor used for mutations
  ARCADE_TOKEN                        Hosted bearer token (takes precedence)`

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function clientFor(options: RunCliOptions): ControlClient {
  const env = options.env ?? process.env
  return new ControlClient({
    baseUrl: env.ARCADE_API_URL ?? 'http://localhost:4100',
    ...(env.ARCADE_TOKEN === undefined
      ? env.ARCADE_ACTOR_ID === undefined
        ? {}
        : { actorId: env.ARCADE_ACTOR_ID }
      : { bearerToken: env.ARCADE_TOKEN }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export async function runCli(options: RunCliOptions): Promise<number> {
  const [command, subcommand, subject] = options.args
  const write = options.write ?? console.log

  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    write(HELP)
    return 0
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    write(`${ARCADE_PROTOCOL.namespace} (${ARCADE_PROTOCOL.stability})`)
    return 0
  }

  const client = clientFor(options)
  try {
    if (command === 'status') {
      write(json(await client.getStatus()))
      return 0
    }

    if (command === 'doctor') {
      const status = await client.getStatus()
      write(
        json({
          ok: true,
          api: status.name,
          protocol: status.protocol,
          webSocket: typeof globalThis.WebSocket !== 'undefined',
          note:
            typeof globalThis.WebSocket === 'undefined'
              ? 'Node callers must provide a WebSocket implementation such as ws.'
              : 'This runtime has a native WebSocket implementation.',
        }),
      )
      return 0
    }

    if (command === 'games' && subcommand === 'search') {
      const result = await client.listGames()
      const query = subject?.toLowerCase()
      const games =
        query === undefined
          ? result.games
          : result.games.filter((game) =>
              [
                game.metadata.title,
                game.metadata.summary,
                ...game.metadata.tags,
              ]
                .join(' ')
                .toLowerCase()
                .includes(query),
            )
      write(json({ games, nextCursor: result.nextCursor }))
      return 0
    }

    if (command === 'games' && subcommand === 'info' && subject !== undefined) {
      write(json(await client.getGame(subject)))
      return 0
    }

    if (command === 'matches' && subcommand === 'create') {
      const releaseId = option(options.args, '--release')
      if (releaseId === undefined) {
        write('matches create requires --release <release-id>')
        return 2
      }
      const seed = option(options.args, '--seed')
      const idempotencyKey = option(options.args, '--idempotency-key')
      write(
        json(
          await client.createMatch({
            releaseId,
            ...(seed === undefined ? {} : { seed }),
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          }),
        ),
      )
      return 0
    }

    if (
      command === 'matches' &&
      subcommand === 'inspect' &&
      subject !== undefined
    ) {
      write(json(await client.getMatch(subject)))
      return 0
    }

    if (
      command === 'replay' &&
      subcommand === 'show' &&
      subject !== undefined
    ) {
      write(json(await client.getReplay(subject)))
      return 0
    }

    write(`Unknown or incomplete command: ${options.args.join(' ')}`)
    return 2
  } catch (error) {
    if (error instanceof ArcadeApiError) {
      write(json(error.problem))
      return error.problem.status === 401 || error.problem.status === 403
        ? 3
        : 1
    }
    write(error instanceof Error ? error.message : String(error))
    return 1
  }
}
