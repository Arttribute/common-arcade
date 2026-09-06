import { readFile, writeFile } from 'node:fs/promises'
import { RealtimeClient } from '@common-arcade/realtime-client'
import {
  gameDocumentSchema,
  starterDocument,
  emptyBrowserDocument,
} from '@common-arcade/protocol'
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
  init [file] [--template grid]       Write a browser game project (or grid template)
  browser-run create <projectId>      Create a portable browser playtest
  browser-run decide <id> --file JSON  Record a decision from an observation
  browser-run inspect <id>            Inspect browser decisions and observations
  projects list                       List your saved games
  projects create --file game.json    Create a game project
  projects get <id>                    Read a project and exact revision
  projects update <id> --file <file>   Update (requires --revision N)
  projects publish <id> --revision N  Publish immutable revision
  projects test <id>                  Run a pinned game to completion
  play <match-id> --seat <seat-id>     Join and play a bounded legal policy
  status                              Inspect the control plane
  doctor                              Check API and runtime prerequisites
  games search [query]                Discover compatible games
  games info <game-id>                Print a canonical game manifest
  matches create --release <id>       Create a match
  matches inspect <match-id>          Inspect lifecycle and roster
  replay show <match-id>              Print an authoritative replay
  test run [--seed value] [--step]    Run two policies in Test Arena
  test logs <test-run-id>             Query structured agent diagnostics
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
    if (command === 'init') {
      const path = subcommand?.startsWith('--')
        ? 'game.json'
        : (subcommand ?? 'game.json')
      await writeFile(
        path,
        json(
          option(options.args, '--template') === 'grid'
            ? starterDocument
            : emptyBrowserDocument,
        ) + '\n',
        { flag: 'wx' },
      )
      write(`Created ${path}`)
      return 0
    }
    if (command === 'browser-run') {
      if (subcommand === 'create' && options.args[2])
        write(
          json(
            await client.createBrowserRun(
              options.args[2],
              option(options.args, '--agent'),
            ),
          ),
        )
      else if (subcommand === 'inspect' && options.args[2])
        write(json(await client.getBrowserRun(options.args[2])))
      else if (
        subcommand === 'decide' &&
        options.args[2] &&
        option(options.args, '--file')
      )
        write(
          json(
            await client.decideBrowserAction(
              options.args[2],
              JSON.parse(
                await readFile(option(options.args, '--file')!, 'utf8'),
              ),
            ),
          ),
        )
      else
        throw new Error(
          'Use browser-run create <projectId>, inspect <runId>, or decide <runId> --file decision.json',
        )
      return 0
    }
    if (command === 'projects') {
      const file = option(options.args, '--file')
      const revision = Number(option(options.args, '--revision'))
      if (subcommand === 'list') {
        write(json(await client.listProjects()))
        return 0
      }
      if (subcommand === 'get' && subject) {
        write(json(await client.getProject(subject)))
        return 0
      }
      if (subcommand === 'create' && file) {
        write(
          json(
            await client.createProject(
              gameDocumentSchema.parse(
                JSON.parse(await readFile(file, 'utf8')),
              ),
            ),
          ),
        )
        return 0
      }
      if (
        subcommand === 'update' &&
        subject &&
        file &&
        Number.isInteger(revision) &&
        revision > 0
      ) {
        write(
          json(
            await client.updateProject(
              subject,
              gameDocumentSchema.parse(
                JSON.parse(await readFile(file, 'utf8')),
              ),
              revision,
            ),
          ),
        )
        return 0
      }
      if (
        subcommand === 'publish' &&
        subject &&
        Number.isInteger(revision) &&
        revision > 0
      ) {
        write(json(await client.publishProject(subject, revision)))
        return 0
      }
      if (subcommand === 'test' && subject) {
        let run = await client.createProjectRun(subject, {
          seed: option(options.args, '--seed'),
        })
        while (run.status === 'running' && run.steps < 64)
          run = await client.stepProjectRun(run.runId, run.steps)
        write(json(run))
        return 0
      }
    }
    if (command === 'play' && subcommand) {
      const seatId = option(options.args, '--seat')
      if (!seatId) throw new Error('play requires --seat <seat-id>')
      const matchId = subcommand,
        controllerId = `cli-${crypto.randomUUID()}`
      await client.claimSeat({ matchId, seatId, controllerId })
      const session = await client.createSession({
        matchId,
        mode: 'control',
        seatId,
        controllerId,
      })
      const realtime = new RealtimeClient({
        url: `${session.realtimeUrl}?match=${encodeURIComponent(matchId)}`,
        matchId,
      })
      let lease = '',
        sequence = 0
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          realtime.close()
          reject(new Error('Play session reached its 10-minute limit.'))
        }, 600000)
        realtime.onMessage((message) => {
          const payload = message.payload as Record<string, any>
          if (message.type === 'control.granted') lease = payload.controlLease
          if (message.type === 'error') {
            clearTimeout(timeout)
            realtime.close()
            reject(new Error(String(payload.detail ?? 'Realtime error')))
          }
          if (
            message.type === 'observation.full' &&
            Array.isArray(payload.legalActions) &&
            payload.legalActions.length &&
            lease
          ) {
            realtime.submitAction({
              actionId: `act_${crypto.randomUUID().replaceAll('-', '')}`,
              matchId,
              seatId,
              controlLease: lease,
              clientSequence: ++sequence,
              basedOnStateSequence: payload.stateSequence,
              targetTurn: payload.turn,
              payload: payload.legalActions[0],
            })
          }
          if (
            (message.type === 'match.transition' &&
              payload.status === 'completed') ||
            (message.type === 'snapshot' &&
              payload.match?.status === 'completed')
          ) {
            write(json(payload))
            clearTimeout(timeout)
            realtime.close()
            resolve()
          }
        })
        realtime.connect(session.ticket).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })
      return 0
    }
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

    if (command === 'test' && subcommand === 'run') {
      const seed = option(options.args, '--seed')
      write(
        json(
          await client.createTestRun({
            ...(seed === undefined ? {} : { seed }),
            execution: options.args.includes('--step') ? 'step' : 'complete',
          }),
        ),
      )
      return 0
    }

    if (command === 'test' && subcommand === 'logs' && subject !== undefined) {
      write(json(await client.getTestDiagnostics(subject)))
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
