import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = await readFile(new URL('server.js', import.meta.url), 'utf8')
const sandbox = vm.createContext({})
vm.runInContext(source, sandbox)
const game = sandbox.arcadeGame
const clone = (v) => JSON.parse(JSON.stringify(v))
function initial(seed = 'nairobi', seats = 2) {
  return clone(
    game.initialize({
      seed,
      roster: Array.from({ length: seats }, (_, i) => ({
        seatId: 'seat-' + i,
        role: 'player',
      })),
    }),
  )
}
function fixture(hands, top = '7-hearts') {
  const s = initial('scenario', hands.length)
  const all = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand)]
  const used = new Set([top, ...hands.flat()])
  s.deck = all.filter((c) => !used.has(c.id))
  s.discard = [all.find((c) => c.id === top)]
  s.suit = s.discard[0].suit
  s.players.forEach((p, i) => {
    p.hand = hands[i].map((id) => all.find((c) => c.id === id))
  })
  return s
}
function act(s, action, seatId = s.players[s.turn].seatId) {
  assert.equal(game.validateAction(s, action, { seatId }), null)
  return clone(game.applyAction(s, action, { seatId }).state)
}
function invariant(s) {
  const cards = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand)]
  assert.equal(cards.length, 54)
  assert.equal(new Set(cards.map((c) => c.id)).size, 54)
}
test('seeded deals are reproducible for 2, 3 and 4 players; different seeds change hands', () => {
  for (const count of [2, 3, 4]) {
    const s = initial('seed-a', count)
    assert.deepEqual(s, initial('seed-a', count))
    assert.notDeepEqual(
      s.players[0].hand,
      initial('seed-b', count).players[0].hand,
    )
    assert.ok(s.players.every((p) => p.hand.length === 4))
    assert.ok(['4', '5', '6', '7', '9', '10'].includes(s.discard[0].rank))
    invariant(s)
  }
})
test('players receive only their own hand; spectators receive no hand, deck or RNG', () => {
  const s = initial()
  for (const p of s.players) {
    const v = clone(game.observe(s, p.seatId).visibleState)
    assert.deepEqual(v.hand, p.hand)
    assert.ok(v.players.every((other) => !('hand' in other)))
    assert.ok(!('deck' in v) && !('rng' in v))
    const other = s.players.find((x) => x.seatId !== p.seatId)
    for (const c of other.hand) assert.ok(!JSON.stringify(v).includes(c.id))
  }
  const publicView = clone(game.spectate(s))
  assert.deepEqual(publicView.hand, [])
  assert.ok(!('deck' in publicView) && !('rng' in publicView))
})
test('rejects forged cards, unknown seats, wrong turns and invalid Ace suits', () => {
  const s = fixture([
    ['A-hearts', '4-clubs', '5-clubs'],
    ['9-spades', '10-spades', 'J-spades'],
  ])
  for (const [a, seatId] of [
    [{ type: 'play', cardId: '9-spades' }, 'seat-0'],
    [{ type: 'draw' }, 'seat-1'],
    [{ type: 'draw' }, 'unknown'],
    [{ type: 'play', cardId: 'A-hearts', suit: 'stars' }, 'seat-0'],
  ]) {
    assert.notEqual(game.validateAction(s, a, { seatId }), null)
    assert.throws(() => game.applyAction(s, a, { seatId }))
  }
})
test('stacks same-rank penalties, disallows mixing 2/3, and cancels with an Ace', () => {
  let s = fixture([
    ['2-hearts', '4-clubs', '5-clubs'],
    ['2-spades', '3-spades', 'A-spades', '9-clubs'],
  ])
  s = act(s, { type: 'play', cardId: '2-hearts' })
  assert.equal(s.pendingDraw, 2)
  assert.notEqual(
    game.validateAction(
      s,
      { type: 'play', cardId: '3-spades' },
      { seatId: 'seat-1' },
    ),
    null,
  )
  const stacked = act(s, { type: 'play', cardId: '2-spades' })
  assert.equal(stacked.pendingDraw, 4)
  const blocked = act(s, { type: 'play', cardId: 'A-spades', suit: 'diamonds' })
  assert.equal(blocked.pendingDraw, 0)
  assert.equal(blocked.suit, 'diamonds')
  const accepted = act(s, { type: 'draw' })
  assert.equal(accepted.players[1].hand.length, 6)
  assert.equal(accepted.turn, 0)
})
test('Ace demand requires the chosen suit, even when a card matches the Ace rank', () => {
  let s = fixture(
    [
      ['A-hearts', '4-clubs', '5-clubs'],
      ['7-hearts', '7-clubs', '4-spades'],
    ],
    '9-diamonds',
  )
  s = act(s, { type: 'play', cardId: 'A-hearts', suit: 'spades' })
  assert.notEqual(
    game.validateAction(
      s,
      { type: 'play', cardId: '7-hearts' },
      { seatId: 'seat-1' },
    ),
    null,
  )
  assert.equal(
    game.validateAction(
      s,
      { type: 'play', cardId: '4-spades' },
      { seatId: 'seat-1' },
    ),
    null,
  )
})
test('question cards retain the turn; Jack skips and King reverses', () => {
  for (const special of ['8-hearts', 'Q-hearts', 'J-hearts', 'K-hearts']) {
    const s = act(
      fixture([
        [special, '4-hearts', '5-clubs'],
        ['9-clubs', '10-clubs', 'J-clubs'],
      ]),
      { type: 'play', cardId: special },
    )
    assert.equal(s.turn, 0)
    assert.equal(
      s.question,
      special.startsWith('8-') || special.startsWith('Q-'),
    )
  }
  const reversed = act(
    fixture([
      ['K-hearts', '4-hearts', '5-clubs'],
      ['9-clubs'],
      ['10-clubs'],
      ['J-clubs'],
    ]),
    { type: 'play', cardId: 'K-hearts' },
  )
  assert.equal(reversed.turn, 3)
  assert.equal(reversed.direction, -1)
})
test('Niko Kadi is required and the last card must be plain', () => {
  let s = fixture([
    ['4-hearts', '5-hearts'],
    ['9-clubs', '10-clubs'],
  ])
  const missed = act(s, { type: 'play', cardId: '4-hearts' })
  assert.equal(missed.players[0].hand.length, 2)
  assert.match(missed.message, /Missed/)
  s = act(s, { type: 'kadi' })
  s = act(s, { type: 'play', cardId: '4-hearts' })
  s.turn = 0
  s = act(s, { type: 'play', cardId: '5-hearts' })
  assert.equal(game.result(s).winnerSeatId, 'seat-0')
  assert.equal(game.observe(s, 'seat-0').legalActions.length, 0)
  const lastSpecial = fixture([['J-hearts'], ['9-clubs', '10-clubs']])
  lastSpecial.players[0].kadi = true
  const noWin = act(lastSpecial, { type: 'play', cardId: 'J-hearts' })
  assert.equal(game.result(noWin), null)
  assert.equal(noWin.players[0].hand.length, 1)
  assert.equal(noWin.players[0].kadi, false)
})
test('drawing is bounded to once per turn and recycles discards without losing cards', () => {
  let s = initial()
  s = act(s, { type: 'draw' })
  assert.notEqual(
    game.validateAction(s, { type: 'draw' }, { seatId: 'seat-0' }),
    null,
  )
  assert.equal(
    game.validateAction(s, { type: 'pass' }, { seatId: 'seat-0' }),
    null,
  )
  s.discard = s.discard.concat(s.deck)
  s.deck = []
  s.drawn = false
  const top = s.discard.at(-1).id
  s = act(s, { type: 'draw' })
  invariant(s)
  assert.equal(s.discard.at(-1).id, top)
})
test('long legal games keep all 54 cards, provide legal actions and reach a result', () => {
  for (const seats of [2, 3, 4])
    for (let seed = 0; seed < 12; seed++) {
      let s = initial('simulation-' + seed, seats)
      for (let move = 0; move < 3000 && !game.result(s); move++) {
        const id = s.players[s.turn].seatId
        const actions = clone(game.observe(s, id).legalActions)
        assert.ok(actions.length)
        for (const a of actions)
          assert.equal(game.validateAction(s, a, { seatId: id }), null)
        const chosen =
          actions.find((a) => a.type === 'kadi') ||
          actions.find((a) => a.type === 'play') ||
          actions.at(-1)
        s = act(s, chosen)
        invariant(s)
      }
      assert.ok(
        game.result(s),
        'game must finish for seed ' + seed + ' with ' + seats + ' seats',
      )
    }
})
