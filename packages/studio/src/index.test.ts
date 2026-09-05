import { describe, expect, it } from 'vitest'
import {
  compileGame,
  compilePresentation,
  documentDigest,
  gameDocumentSchema,
  rulesFor,
  starterDocument,
} from './index.js'
describe('bounded game authoring', () => {
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
  it('compiles a larger board for the same authoritative legal-action interface', () => {
    const game = compileGame(
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
        authoritativeTime: '',
      }).legalActions,
    ).toHaveLength(25)
    expect(
      game.projectObservation(state, 'sea_two', {
        matchId: 'mat_test',
        seatId: 'sea_two',
        stateSequence: 0,
        eventSequence: 0,
        authoritativeTime: '',
      }).legalActions,
    ).toHaveLength(0)
  })
})
