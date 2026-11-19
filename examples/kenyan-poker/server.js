// Kenyan Poker / Kadi. All mutable match state is serialized by Arcade.
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const PLAIN = ['4', '5', '6', '7', '9', '10']
function random(s) {
  let x = s.rng
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  s.rng = x >>> 0
  return s.rng / 4294967296
}
function shuffle(s, cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1))
    const card = cards[i]
    cards[i] = cards[j]
    cards[j] = card
  }
  return cards
}
function take(s, p, count) {
  let taken = 0
  while (taken < count) {
    if (!s.deck.length && s.discard.length > 1) {
      const top = s.discard.pop()
      s.deck = shuffle(s, s.discard)
      s.discard = [top]
    }
    if (!s.deck.length) break
    p.hand.push(s.deck.pop())
    taken++
  }
  p.kadi = false
  return taken
}
function current(s) {
  return s.players[s.turn]
}
function next(s, steps) {
  s.turn =
    (s.turn + s.direction * steps + s.players.length * 2) % s.players.length
  s.drawn = false
}
function playable(s, card) {
  const top = s.discard[s.discard.length - 1]
  if (card.rank === 'A') return true
  if (s.pendingDraw) return card.rank === s.pendingRank
  if (card.rank === 'joker')
    return (
      card.color === (['hearts', 'diamonds'].includes(s.suit) ? 'red' : 'black')
    )
  return card.suit === s.suit || (!s.demand && card.rank === top.rank)
}
function legal(s, seatId) {
  if (s.phase !== 'playing' || current(s).seatId !== seatId) return []
  const p = current(s)
  const actions = []
  for (const card of p.hand) {
    if (!playable(s, card)) continue
    if (card.rank === 'A') {
      for (const suit of SUITS)
        actions.push({
          type: 'play',
          cardId: card.id,
          suit,
          label: 'Ace: demand ' + suit,
        })
    } else
      actions.push({
        type: 'play',
        cardId: card.id,
        label: 'Play ' + card.label,
      })
  }
  if (p.hand.length === 2 && !p.kadi)
    actions.push({ type: 'kadi', label: 'Niko Kadi!' })
  if (s.pendingDraw)
    actions.push({ type: 'draw', label: 'Pick ' + s.pendingDraw })
  else if (!s.drawn)
    actions.push({
      type: 'draw',
      label: s.question ? 'Draw to answer' : 'Draw a card',
    })
  else actions.push({ type: 'pass', label: 'End turn' })
  return actions
}
function valid(s, a, seatId) {
  return (
    a &&
    legal(s, seatId).some(
      (x) => x.type === a.type && x.cardId === a.cardId && x.suit === a.suit,
    )
  )
}
function visible(s, seatId) {
  return {
    phase: s.phase,
    objective: 'Declare Niko Kadi at two cards, then finish with a plain card.',
    players: s.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      count: p.hand.length,
      kadi: p.kadi,
    })),
    turnSeatId: current(s).seatId,
    direction: s.direction,
    topCard: s.discard[s.discard.length - 1],
    suit: s.suit,
    demand: s.demand,
    pendingDraw: s.pendingDraw,
    question: s.question,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    move: s.move,
    message: s.message,
    history: s.history,
    winnerSeatId: s.winnerSeatId,
    hand: s.players.find((p) => p.seatId === seatId)?.hand || [],
    seatId: seatId || null,
  }
}
globalThis.arcadeGame = {
  initialize(context) {
    if (context.roster.length < 2 || context.roster.length > 4)
      throw new Error('Kadi requires 2–4 seats.')
    let seed = 2166136261
    for (const c of String(context.seed))
      seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0
    const s = {
      rng: seed || 1,
      deck: [],
      discard: [],
      turn: 0,
      direction: 1,
      pendingDraw: 0,
      pendingRank: null,
      suit: 'hearts',
      demand: false,
      question: false,
      drawn: false,
      phase: 'playing',
      move: 0,
      winnerSeatId: null,
      message: 'Karibu! Match the suit or rank.',
      history: [],
      players: context.roster.map((r, i) => ({
        seatId: r.seatId,
        name: 'Mchezaji ' + (i + 1),
        hand: [],
        kadi: false,
      })),
    }
    const symbols = ['♥', '♦', '♣', '♠']
    for (let i = 0; i < SUITS.length; i++)
      for (const rank of RANKS)
        s.deck.push({
          id: rank + '-' + SUITS[i],
          rank,
          suit: SUITS[i],
          label: rank + symbols[i],
        })
    for (const color of ['red', 'black'])
      s.deck.push({
        id: 'joker-' + color,
        rank: 'joker',
        suit: null,
        color,
        label: color + ' Joker',
      })
    shuffle(s, s.deck)
    for (let round = 0; round < 4; round++)
      for (const p of s.players) take(s, p, 1)
    // Begin with an ordinary card: the first player never inherits a penalty.
    const opening = s.deck.findIndex((c) => PLAIN.includes(c.rank))
    const card = s.deck.splice(opening, 1)[0]
    s.discard.push(card)
    s.suit = card.suit
    return s
  },
  validateAction(s, a, c) {
    return valid(s, a, c.seatId)
      ? null
      : 'Choose a legal action for your own turn.'
  },
  applyAction(state, a, c) {
    if (!valid(state, a, c.seatId))
      throw new Error('Illegal or out-of-turn action.')
    const s = JSON.parse(JSON.stringify(state))
    const p = current(s)
    const messages = []
    if (a.type === 'kadi') {
      p.kadi = true
      messages.push(p.name + ': Niko Kadi!')
    } else if (a.type === 'pass') {
      s.question = false
      next(s, 1)
      messages.push(p.name + ' ends their turn.')
    } else if (a.type === 'draw') {
      const penalty = s.pendingDraw
      const count = take(s, p, penalty || 1)
      messages.push(
        p.name + ' picks ' + count + (count === 1 ? ' card.' : ' cards.'),
      )
      s.pendingDraw = 0
      s.pendingRank = null
      s.question = false
      if (penalty) next(s, 1)
      else s.drawn = true
    } else {
      const card = p.hand.splice(
        p.hand.findIndex((x) => x.id === a.cardId),
        1,
      )[0]
      s.discard.push(card)
      s.drawn = false
      s.question = false
      s.demand = false
      if (card.suit) s.suit = card.suit
      messages.push(p.name + ' plays ' + card.label + '.')
      if (p.hand.length === 0 && PLAIN.includes(card.rank) && p.kadi) {
        s.phase = 'finished'
        s.winnerSeatId = p.seatId
        messages.push(p.name + ' wins. Hongera!')
      } else {
        if (p.hand.length === 1 && !p.kadi) {
          take(s, p, 1)
          messages.push('Missed Niko Kadi: pick 1.')
        }
        if (p.hand.length === 0) {
          take(s, p, 1)
          messages.push('Finish with a plain card: pick 1.')
        }
        if (p.hand.length !== 1) p.kadi = false
        if (card.rank === 'A') {
          s.suit = a.suit
          s.demand = true
          s.pendingDraw = 0
          s.pendingRank = null
          messages.push('Demand: ' + a.suit + '.')
          next(s, 1)
        } else if (['2', '3', 'joker'].includes(card.rank)) {
          s.pendingDraw += card.rank === 'joker' ? 5 : Number(card.rank)
          s.pendingRank = card.rank
          next(s, 1)
        } else if (card.rank === 'J') next(s, 2)
        else if (card.rank === 'K') {
          s.direction *= -1
          next(s, s.players.length === 2 ? 2 : 1)
        } else if (card.rank === '8' || card.rank === 'Q') s.question = true
        else next(s, 1)
      }
    }
    s.move++
    s.message = messages.join(' ')
    s.history = s.history.concat([s.message]).slice(-6)
    return {
      state: s,
      events: [
        {
          type: 'kadi.action',
          visibility: 'public',
          payload: { seatId: p.seatId, message: s.message, move: s.move },
        },
      ],
    }
  },
  observe(s, seatId) {
    const p = s.players.find((x) => x.seatId === seatId)
    const reward =
      s.phase === 'finished' ? (s.winnerSeatId === seatId ? 1 : -1) : 0
    return {
      visibleState: visible(s, seatId),
      legalActions: legal(s, seatId),
      feedback: {
        reward,
        outcome:
          s.phase === 'finished' ? (reward > 0 ? 'win' : 'loss') : 'playing',
        summary: s.message,
        metrics: { cardsRemaining: p ? p.hand.length : 0, move: s.move },
      },
    }
  },
  spectate(s) {
    return visible(s, null)
  },
  result(s) {
    return s.phase === 'finished'
      ? { winnerSeatId: s.winnerSeatId, outcome: 'win', moves: s.move }
      : null
  },
}
