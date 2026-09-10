import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import {
  gameDocumentSchema,
  documentDigest,
  createBrowserPolicy,
  livePolicyObservation,
} from '../src/index.js'
import { compileGame, testGameRuntime } from '../src/runtime.js'
import { AuthoritativeMatch } from '@common-arcade/match-runtime'
const evidence = []
for (const path of process.argv.slice(2)) {
  const document = gameDocumentSchema.parse(
    JSON.parse(await readFile(path, 'utf8')),
  )
  const digest = await documentDigest(document)
  const test = await testGameRuntime(document, digest, { steps: 60 })
  assert.equal(test.deterministic, true)
  const game = await compileGame(document, 'rel_verify', digest)
  const roster = [
    { seatId: 'sea_alpha', role: 'home' },
    { seatId: 'sea_beta', role: 'away' },
  ]
  const match = await AuthoritativeMatch.create({
    game,
    matchId: 'mat_verify',
    seed: 'fixture',
    roster,
    configuration: {},
    now: () => new Date(0),
  })
  match.start()
  const policy = createBrowserPolicy()
  let sequence = 0
  const actions = [new Set<string>(), new Set<string>()]
  const first = roster.map((r) => match.observation(r.seatId).visibleState)
  for (let step = 0; step < 6000 && match.getStatus() === 'running'; step++) {
    if (!game.advanceTick || step % 3 === 0)
      for (const [i, seat] of roster.entries()) {
        const o = match.observation(seat.seatId)
        if (!o.legalActions.length) continue
        const input = livePolicyObservation(o)
        const d = policy.choose(
          {
            ...input.observation,
            state: policy.enrich(input.observation.state),
          },
          { seatId: seat.seatId, strategy: 'Play to win legally' },
          sequence,
        )
        const payload = input.payloads.get(d.actionId)!
        const result = await match.submitAction(
          {
            actionId: `act_verify_${++sequence}`,
            matchId: 'mat_verify',
            seatId: seat.seatId,
            controlLease: 'test',
            clientSequence: sequence,
            basedOnStateSequence: o.stateSequence,
            payload,
          },
          1,
        )
        assert.equal(result.disposition, 'accepted', JSON.stringify(result))
        actions[i]!.add(JSON.stringify(payload))
        if (match.getStatus() !== 'running') break
      }
    if (game.advanceTick && match.getStatus() === 'running')
      await match.advanceTick(33)
  }
  const last = roster.map((r) => match.observation(r.seatId).visibleState)
  const counts = actions.map((a) => a.size)
  assert.ok(
    counts.every((n) => n >= 2),
    'Each seat must execute varied actions',
  )
  evidence.push({
    title: document.title,
    digest,
    deterministic: test.deterministic,
    timing: test.timing,
    status: match.getStatus(),
    actions: sequence,
    distinctActions: counts,
    first,
    last,
    result: (await match.snapshot()).result,
  })
  console.log(
    JSON.stringify({
      title: document.title,
      status: match.getStatus(),
      actions: sequence,
      distinctActions: counts,
      p95: test.timing.p95Ms,
      result: (await match.snapshot()).result,
    }),
  )
}
await writeFile(
  process.env.ARCADE_EVIDENCE_PATH ?? 'headless-evidence.json',
  JSON.stringify(evidence, null, 2),
)
