import { readFile, writeFile } from 'node:fs/promises'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import {
  livePolicyObservation,
  releaseManifest,
  type StudioRelease,
} from '@common-arcade/studio'
import { planCoaching } from '../src/coaching.js'

const projectPath = process.argv[2]
if (!projectPath)
  throw new Error(
    'Usage: tsx scripts/coaching-experiment.ts project.json [commons-config.json] [agent-id]',
  )
const project = JSON.parse(await readFile(projectPath, 'utf8'))
const release = {
  id: project.releaseId,
  document: project.document,
  digest: project.digest,
  manifest: await releaseManifest(project, project.releaseId),
} as StudioRelease
const platform = await LocalArcadePlatform.create({
  loadRelease: async () => release,
})
const match = await platform.createMatch({
  releaseId: release.id,
  idempotencyKey: crypto.randomUUID(),
  ownerId: 'experiment',
  seed: 'coaching-experiment',
})
let sequence = 0
const sessions: { sessionId: string; controlLease?: string }[] = []
try {
  for (const seat of match.seats) {
    await platform.claimSeat({
      matchId: match.id,
      seatId: seat.id,
      actorId: 'experiment',
      controllerId: seat.id,
      controllerKind: 'agent',
    })
    const ticket = await platform.createSession({
      matchId: match.id,
      seatId: seat.id,
      actorId: 'experiment',
      controllerId: seat.id,
      mode: 'control',
    })
    sessions.push(await platform.connectWithTicket(ticket.ticket, match.id))
  }
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!,
      seat = match.seats[i]!
    const observation = platform.observation(session.sessionId)
    const lock = observation.legalActions.find(
      (action: any) => action.id === 'lockCar',
    )
    if (!lock)
      throw new Error('This experiment expects Redline Run car selection.')
    await platform.submitAction(session.sessionId, {
      actionId: `act_setup${++sequence}`,
      matchId: match.id,
      seatId: seat.id,
      controlLease: session.controlLease!,
      clientSequence: sequence,
      basedOnStateSequence: observation.stateSequence,
      payload: lock,
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 4300))
  const seat = match.seats[0]!
  const originalSession = sessions[0]!
  const prepare = () => platform.beginCoaching(match.id, seat.id, 'experiment')
  const input = livePolicyObservation(
    platform.observation(originalSession.sessionId),
  )
  const brakeId = [...input.payloads].find(
    ([, p]: any) => p.id === 'brake',
  )?.[0]
  if (!brakeId) throw new Error('No legal brake action')
  const baseline = prepare()
  await platform.applyCoaching(
    match.id,
    seat.id,
    'experiment',
    baseline.requestId,
    seat.id,
    {
      strategy: 'Prefer brake.',
      reason: 'Controlled braking baseline.',
      executableStrategy: {
        actionWeights: { [brakeId]: 100 },
        avoidActions: [],
        rules: [],
      },
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
  const before: any = platform.observation(
    originalSession.sessionId,
  ).visibleState
  const request = prepare()
  const planningStarted = performance.now()
  let planned: any
  if (process.argv[3]) {
    const config = JSON.parse(await readFile(process.argv[3], 'utf8'))
    if (
      config.sessionToken &&
      config.accessTokenExpiresAt < Date.now() + 60000
    ) {
      const refreshed = await fetch(`${config.identityUrl}/api/auth/token`, {
        headers: { Authorization: `Bearer ${config.sessionToken}` },
      })
      if (!refreshed.ok)
        throw new Error(`Commons login refresh failed (${refreshed.status})`)
      config.accessToken = ((await refreshed.json()) as { token: string }).token
    }

    planned = await planCoaching(
      {
        id: config.userId,
        token: config.accessToken,
        provider: 'commons',
        scopes: ['matches:play'],
      },
      {
        agentId: process.argv[4] ?? config.defaultAgentId,
        strategy: request.strategy,
      },
      'Stop braking. Accelerate and build speed immediately. Keep near the middle of the road and steer away from approaching traffic. Use the visible racing state to make conditional steering rules.',
      request.observation,
    )
  } else {
    const accelerateId = [...input.payloads].find(
      ([, p]: any) => p.id === 'accelerate',
    )?.[0]
    if (!accelerateId) throw new Error('No legal accelerate action')
    planned = {
      strategy: 'Accelerate immediately.',
      reason: 'Replace braking with acceleration.',
      executableStrategy: {
        actionWeights: { [accelerateId]: 100 },
        avoidActions: [brakeId],
        rules: [],
      },
    }
  }
  const planningMs = performance.now() - planningStarted
  const commandsBefore = platform.getReplay(match.id, 'experiment').commands
    .length
  const readyAt = performance.now()
  const applied = await platform.applyCoaching(
    match.id,
    seat.id,
    'experiment',
    request.requestId,
    seat.id,
    planned,
  )
  const applyMs = performance.now() - readyAt
  const firstActions = platform
    .getReplay(match.id, 'experiment')
    .commands.slice(commandsBefore)
    .map((c) => ({
      payload: c.action.payload,
      policy: c.action.policyExecutionId,
    }))
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const after: any = platform.observation(
    originalSession.sessionId,
  ).visibleState
  const report = {
    projectId: project.id,
    title: project.document.title,
    revision: project.revision,
    source: process.argv[3]
      ? 'Commons agent coaching'
      : 'deterministic replacement experiment',
    planningMs,
    applyMs,
    strategy: applied.strategy,
    epoch: applied.strategyEpoch,
    firstActions,
    before: before.you,
    after: after.you,
    accelerated: after.you.speedPercent > before.you.speedPercent,
    oldStrategyReturned: platform
      .getReplay(match.id, 'experiment')
      .commands.slice(commandsBefore + firstActions.length)
      .some((c) => c.action.policyExecutionId === 'coached-strategy-1'),
  }
  await writeFile(
    '/private/tmp/arcade-coaching-experiment.json',
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
  if (!report.accelerated || report.oldStrategyReturned) process.exitCode = 1
} finally {
  await platform.pauseMatch(match.id)
}
