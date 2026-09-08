import { describe, expect, it } from 'vitest'
import { AuthoritativeMatch, verifyReplay } from '@common-arcade/match-runtime'
import {
  assessLiveReadiness,
  compileGame,
  compilePresentation,
  documentDigest,
  gameDocumentSchema,
  rulesFor,
  starterDocument,
  emptyBrowserDocument,
  releaseManifest,
} from './index.js'
describe('bounded game authoring', () => {
  const realtimeDuel = gameDocumentSchema.parse({
    kind: 'browser',
    title: 'Pulse duel',
    description: 'A non-grid realtime projectile duel.',
    entryFile: 'index.html',
    play: {
      mode: 'realtime',
      seats: { min: 2, max: 2, default: 2 },
      maxDecisionsPerSecond: 10,
    },
    runtime: {
      kind: 'sandboxed-script',
      entryFile: 'server.js',
      tickRate: 20,
      memoryMiB: 8,
      timeoutMs: 20,
    },
    files: [
      {
        path: 'index.html',
        content: '<main id="arena"></main><script src="main.js"></script>',
      },
      {
        path: 'main.js',
        content:
          "window.arcade={seats:()=>[],observe:()=>({}),actions:()=>[],step:()=>false,render:(state)=>{document.querySelector('#arena').textContent=JSON.stringify(state)},submit:()=>false};",
      },
      {
        path: 'server.js',
        content: `globalThis.arcadeGame={
          initialize:c=>({players:c.roster.map(p=>({seatId:p.seatId,hp:3})),shots:[]}),
          validateAction:(s,a,c)=>s.players.some(p=>p.seatId===c.seatId&&p.hp>0)&&a&&a.type==='shoot'?null:'Cannot shoot',
          applyAction:(s,a,c)=>({state:{...s,shots:s.shots.concat([{owner:c.seatId,target:s.players.find(p=>p.seatId!==c.seatId).seatId,impactAt:c.elapsedMs+100}])},events:[{type:'duel.shot',visibility:'public',payload:{seatId:c.seatId}}]}),
          tick:(s,c)=>{const due=s.shots.filter(x=>x.impactAt<=c.elapsedMs+c.deltaMs),targets=new Set(due.map(x=>x.target));return {state:{players:s.players.map(p=>({...p,hp:p.hp-(targets.has(p.seatId)?1:0)})),shots:s.shots.filter(x=>x.impactAt>c.elapsedMs+c.deltaMs)},events:due.map(x=>({type:'duel.hit',visibility:'public',payload:{seatId:x.target}}))}},
          observe:(s,id,c)=>{const impacts=s.shots.filter(x=>x.target===id).map(x=>x.impactAt-c.elapsedMs);return {visibleState:s,legalActions:[{type:'shoot'}],feedback:{elapsedMs:c.elapsedMs,timeToImpact:impacts.length?Math.min(...impacts):null}}},
          result:s=>{const loser=s.players.find(p=>p.hp<=0);return loser?{winnerSeatId:s.players.find(p=>p.seatId!==loser.seatId).seatId}:null}
        };`,
      },
    ],
  })
  it('compiles complete horizontal, vertical and diagonal winning lines', () => {
    expect(
      rulesFor(starterDocument, 'rel_test', 'sha256:test').winningLines,
    ).toHaveLength(8)
    expect(
      rulesFor(
        { ...starterDocument, boardSize: 5, winLength: 4 },
        'rel_test',
        'sha256:test',
      ).winningLines,
    ).toHaveLength(28)
  })
  it('rejects impossible and unbounded game documents', () => {
    for (const patch of [
      { boardSize: 1000 },
      { winLength: 4 },
      { marks: ['X', 'X'] },
      { accent: 'red;}</style><script>bad()</script>' },
      { script: 'fetch(secret)' },
    ])
      expect(
        gameDocumentSchema.safeParse({ ...starterDocument, ...patch }).success,
      ).toBe(false)
  })
  it('pins content independently of input property order', async () => {
    const a = await documentDigest(starterDocument)
    expect(
      await documentDigest(
        Object.fromEntries(
          Object.entries(starterDocument).reverse(),
        ) as typeof starterDocument,
      ),
    ).toBe(a)
    expect(
      await documentDigest({ ...starterDocument, title: 'New title' }),
    ).not.toBe(a)
  })
  it('renders user text as data in a credential-free preview', () => {
    const html = compilePresentation({
      ...starterDocument,
      title: '</script><img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<img src=x')
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain('data-arcade-node="cell:0"')
  })
  it('compiles a larger board for the same authoritative legal-action interface', async () => {
    const game = await compileGame(
      { ...starterDocument, boardSize: 5, winLength: 4 },
      'rel_test',
      'sha256:test',
    )
    const state = game.initialize({
      matchId: 'mat_test',
      configuration: {},
      seed: 'test',
      roster: [
        { seatId: 'sea_one', role: 'player' },
        { seatId: 'sea_two', role: 'player' },
      ],
    })
    expect(
      game.projectObservation(state, 'sea_one', {
        matchId: 'mat_test',
        seatId: 'sea_one',
        stateSequence: 0,
        eventSequence: 0,
        elapsedMs: 0,
        authoritativeTime: '',
      }).legalActions,
    ).toHaveLength(25)
    expect(
      game.projectObservation(state, 'sea_two', {
        matchId: 'mat_test',
        seatId: 'sea_two',
        stateSequence: 0,
        eventSequence: 0,
        elapsedMs: 0,
        authoritativeTime: '',
      }).legalActions,
    ).toHaveLength(0)
  })
  it('distinguishes managed live runtimes from browser previews', () => {
    expect(assessLiveReadiness(starterDocument)).toMatchObject({
      liveReady: true,
      classification: 'arcade-managed',
      runtimeModule: 'grid-placement',
      blockers: [],
    })
    expect(assessLiveReadiness(emptyBrowserDocument)).toMatchObject({
      liveReady: false,
      classification: 'preview-only',
      runtimeModule: 'browser-presentation',
      blockers: expect.arrayContaining([
        expect.stringContaining('not an authoritative'),
      ]),
    })
    expect(
      assessLiveReadiness({
        ...emptyBrowserDocument,
        capabilities: {
          genres: [],
          world: {
            persistence: 'session',
            authority: 'arcade-managed',
            cadence: 'turn',
            checkpointing: 'end-only',
          },
          presentation: { dimension: '2d', engine: 'dom' },
          teams: {
            enabled: false,
            maxTeams: 1,
            membersPerTeam: 1,
            control: 'individual',
            sharedStrategy: false,
          },
          economy: { payments: 'disabled', valueMode: 'none', hooks: [] },
        },
      }).blockers[0],
    ).toContain('only browser presentation source')
  })
  it('runs and deterministically replays a non-grid fixed-tick duel', async () => {
    const game = await compileGame(
      realtimeDuel,
      'rel_pulse_duel',
      `sha256:${'1'.repeat(64)}`,
    )
    const match = await AuthoritativeMatch.create({
      matchId: 'mat_pulse_duel',
      game,
      seed: 'fixed-seed',
      configuration: {},
      roster: [
        { seatId: 'sea_player_one', role: 'player' },
        { seatId: 'sea_player_two', role: 'player' },
      ],
    })
    match.start()
    expect(
      await match.submitAction(
        {
          actionId: 'act_pulse_shot',
          matchId: 'mat_pulse_duel',
          seatId: 'sea_player_one',
          controlLease: 'test-control-lease',
          clientSequence: 1,
          basedOnStateSequence: 0,
          targetTick: 1,
          payload: { type: 'shoot' },
        },
        match.getOwnershipEpoch(),
      ),
    ).toMatchObject({ disposition: 'accepted' })
    await match.advanceTick(50)
    await match.advanceTick(50)
    expect(match.observation('sea_player_two').feedback).toMatchObject({
      elapsedMs: 100,
    })
    expect(
      await match.submitAction(
        {
          actionId: 'act_pulse_response',
          matchId: 'mat_pulse_duel',
          seatId: 'sea_player_two',
          controlLease: 'test-control-lease',
          clientSequence: 1,
          basedOnStateSequence: 0,
          targetTick: 3,
          payload: { type: 'shoot' },
        },
        match.getOwnershipEpoch(),
      ),
    ).toMatchObject({ disposition: 'accepted', acceptedForTick: 3 })
    const replay = match.exportReplay()
    expect(replay.timeline?.map((step) => step.kind)).toEqual([
      'action',
      'tick',
      'tick',
      'action',
    ])
    expect(await verifyReplay(game, replay)).toMatchObject({ valid: true })
  })
  it('connects managed presentation input and authoritative state without a grid renderer', () => {
    const html = compilePresentation(realtimeDuel)
    expect(html).toContain('arcade.authoritative-state')
    expect(html).toContain('arcade.action')
    expect(html).toContain('api.submit=')
  })
  it('gives browser games bounded seats and an opaque-origin storage fallback', () => {
    const parsed = gameDocumentSchema.parse(emptyBrowserDocument)
    expect('play' in parsed && parsed.play?.seats.default).toBe(2)
    const html = compilePresentation(emptyBrowserDocument)
    expect(html).toContain("if(location.origin==='null')return createStorage()")
    expect(html).toContain('Object.defineProperty(window,name')
    expect(html).toContain('installArcadeSeats()')
    expect(html).toContain('Object.hasOwn(projectFiles,path)')
    expect(html).toContain('async function start(id)')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('__ARCADE_PLAY__')
  })
  it('publishes extensible world, team, 3D, and payment-ready declarations as metadata', async () => {
    const document = gameDocumentSchema.parse({
      ...emptyBrowserDocument,
      play: {
        mode: 'hybrid',
        seats: { min: 2, max: 16, default: 4 },
        maxDecisionsPerSecond: 10,
      },
      capabilities: {
        genres: ['strategy', 'team-sport'],
        world: {
          persistence: 'persistent-world',
          authority: 'external-conformant-host',
          cadence: 'fixed-tick',
          checkpointing: 'event-and-periodic',
        },
        presentation: {
          dimension: '3d',
          engine: 'three',
          contentPipeline: {
            authoringTools: ['blender'],
            runtimeFormats: ['gltf', 'glb', 'ktx2'],
          },
        },
        teams: {
          enabled: true,
          maxTeams: 4,
          membersPerTeam: 8,
          control: 'hybrid',
          sharedStrategy: true,
        },
        economy: {
          payments: 'integration-ready',
          valueMode: 'regulated',
          hooks: ['entry-authorization', 'settlement-proposal'],
        },
      },
    })
    const manifest = await releaseManifest(
      {
        id: 'prj_capabilities',
        ownerId: 'creator',
        revision: 1,
        digest: 'sha256:' + '0'.repeat(64),
        document,
        annotations: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      'rel_capabilities',
    )
    expect(manifest.spec.mode).toBe('hybrid')
    expect(manifest.metadata.tags).toEqual(
      expect.arrayContaining(['strategy', '3d', 'teams', 'payments-ready']),
    )
    expect(manifest.spec.extensions.map((extension) => extension.id)).toEqual(
      expect.arrayContaining([
        'https://arcade.agentcommons.io/extensions/world/v1',
        'https://arcade.agentcommons.io/extensions/presentation/v1',
        'https://arcade.agentcommons.io/extensions/teams/v1',
        'https://arcade.agentcommons.io/extensions/economy/v1',
      ]),
    )
  })
})
