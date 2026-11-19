import { expect, it } from 'vitest'
import { gameDocumentSchema } from '@common-arcade/protocol'
import { documentDigest, releaseManifest } from '@common-arcade/studio'
import { LocalArcadePlatform } from './index.js'

it.each([true, false])(
  'projects spectator state without private cards or referee events (projection: %s)',
  async (withProjection) => {
    const document = gameDocumentSchema.parse({
      kind: 'browser',
      title: 'Private cards',
      description: 'Privacy regression',
      entryFile: 'index.html',
      play: {
        mode: 'turn-based',
        seats: { min: 2, max: 2, default: 2 },
        spectators: true,
      },
      runtime: {
        kind: 'sandboxed-script',
        entryFile: 'server.js',
        memoryMiB: 8,
        timeoutMs: 20,
      },
      files: [
        { path: 'index.html', content: '<main>Cards</main>' },
        {
          path: 'server.js',
          content: `globalThis.arcadeGame={
      initialize:c=>({secret:'private-deck',roster:c.roster,count:0}),
      validateAction:()=>null,
      applyAction:s=>({state:{...s,count:s.count+1},events:[{type:'cards.played',visibility:'public',payload:{}},{type:'cards.dealt',visibility:'referee',payload:{secret:'private-hand'}}]}),
      observe:(s,id)=>({visibleState:{hand:'private-'+id},legalActions:[{type:'play'}]}),
      ${withProjection ? 'spectate:s=>({count:s.count}),' : ''}
      result:()=>null
    };`,
        },
      ],
    })
    const digest = await documentDigest(document)
    const project = {
      id: 'prj_privacytest',
      ownerId: 'owner',
      revision: 1,
      digest,
      document,
      annotations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const release = {
      id: 'rel_privacy',
      projectId: project.id,
      revision: 1,
      document,
      digest,
      manifest: await releaseManifest(project, 'rel_privacy'),
      publishedAt: new Date().toISOString(),
    }
    const platform = await LocalArcadePlatform.create({
      loadRelease: async () => release,
    })
    try {
      const match = await platform.createMatch({
        releaseId: release.id,
        idempotencyKey: 'private-cards-' + withProjection,
        ownerId: 'owner',
      })
      for (let i = 0; i < match.seats.length; i++)
        await platform.claimSeat({
          matchId: match.id,
          seatId: match.seats[i]!.id,
          actorId: 'actor' + i,
          controllerId: 'controller' + i,
        })
      expect((await platform.getMatchView(match.id)).publicState).toEqual(
        withProjection ? { count: 0 } : null,
      )
      const ticket = await platform.createSession({
        matchId: match.id,
        mode: 'control',
        seatId: match.seats[0]!.id,
        actorId: 'actor0',
        controllerId: 'controller0',
      })
      const session = await platform.connectWithTicket(ticket.ticket, match.id)
      const observation = platform.observation(session.sessionId)
      expect(observation.visibleState).toEqual({
        hand: 'private-' + match.seats[0]!.id,
      })
      await platform.submitAction(session.sessionId, {
        actionId: 'act_privacy',
        matchId: match.id,
        seatId: match.seats[0]!.id,
        controlLease: session.controlLease!,
        clientSequence: 1,
        basedOnStateSequence: observation.stateSequence,
        payload: { type: 'play' },
      })
      const view = await platform.getMatchView(match.id)
      expect(view.publicState).toEqual(withProjection ? { count: 1 } : null)
      expect(view.events.every((event) => event.visibility === 'public')).toBe(
        true,
      )
      expect(JSON.stringify(view)).not.toContain('private-deck')
      expect(JSON.stringify(view)).not.toContain('private-hand')
    } finally {
      platform.close()
    }
  },
)
