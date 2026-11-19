// Presentation only. Legal moves and private observations come from Arcade.
const $ = (id) => document.getElementById(id)
const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
let view = null
let context = {}
let actions = []
let selectedAce = null
let busy = false
let lastKey = ''
function cardContents(card) {
  const symbol = symbols[card.suit] || '✦'
  return (
    '<span class="corner">' +
    (card.rank === 'joker' ? 'JK' : card.rank) +
    '<i>' +
    symbol +
    '</i></span><span class="pip">' +
    symbol +
    '</span>'
  )
}
function isRed(card) {
  return (
    card.suit === 'hearts' || card.suit === 'diamonds' || card.color === 'red'
  )
}
async function submit(action) {
  if (!context.inputEnabled || busy || !action) return
  busy = true
  $('error').textContent = ''
  paint()
  try {
    await window.arcade.submit(action)
  } catch (e) {
    $('error').textContent =
      e instanceof Error ? e.message : 'That move was not accepted. Try again.'
  } finally {
    busy = false
    paint()
  }
}
function actionButton(label, action, className = '') {
  const b = document.createElement('button')
  b.className = 'action ' + className
  b.textContent = label
  b.disabled = !context.inputEnabled || busy
  b.onclick = () => submit(action)
  return b
}
function paint() {
  if (!view || !Array.isArray(view.players)) return
  const own = view.players.find((p) => p.seatId === view.seatId)
  const turn = view.players.find((p) => p.seatId === view.turnSeatId)
  const myTurn =
    own && own.seatId === view.turnSeatId && view.phase === 'playing'
  $('table-label').textContent =
    view.players.length +
    '-PLAYER TABLE / ' +
    (view.direction === 1 ? 'CLOCKWISE' : 'COUNTERCLOCKWISE')
  $('move').textContent = 'Move ' + view.move
  $('hand-label').textContent = own
    ? 'YOUR HAND / ' + own.name.toUpperCase()
    : 'AT THE TABLE'
  $('hand-count').textContent = own
    ? own.count +
      (own.count === 1 ? ' card' : ' cards') +
      (own.kadi ? ' · Niko Kadi!' : '')
    : 'Spectating'
  $('turn-label').textContent =
    view.phase === 'finished'
      ? view.winnerSeatId === view.seatId
        ? 'Hongera! You won.'
        : 'Hongera, ' +
          view.players.find((p) => p.seatId === view.winnerSeatId)?.name +
          '!'
      : myTurn
        ? 'Your turn. Cheza!'
        : (turn?.name || 'Next player') + ' is playing'
  $('opponents').replaceChildren()
  for (const p of view.players.filter((p) => p.seatId !== view.seatId)) {
    const node = document.createElement('div')
    node.className =
      'opponent' + (p.seatId === view.turnSeatId ? ' active' : '')
    const name = document.createElement('span')
    name.className = 'opponent-name'
    name.textContent = p.name
    const backs = document.createElement('div')
    backs.className = 'mini-cards'
    backs.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < Math.min(p.count, 8); i++) {
      const back = document.createElement('span')
      back.className = 'mini-card'
      backs.append(back)
    }
    const count = document.createElement('small')
    count.textContent = p.kadi ? 'NIKO KADI!' : p.count + ' cards'
    node.append(name, backs, count)
    $('opponents').append(node)
  }
  const top = view.topCard
  if (top) {
    $('discard').className = 'card face' + (isRed(top) ? ' red' : '')
    $('discard').innerHTML = cardContents(top)
    $('discard').setAttribute('aria-label', 'Top card: ' + top.label)
  }
  $('deck-count').textContent = view.deckCount + ' TO DRAW'
  $('suit').textContent = view.pendingDraw
    ? 'Pick ' + view.pendingDraw + ' · stack the same rank or block with an Ace'
    : view.question
      ? 'Question! Answer with another card.'
      : (view.demand ? 'Demanded: ' : 'In play: ') +
        symbols[view.suit] +
        ' ' +
        view.suit
  $('table-message').textContent = view.message
  $('hand').replaceChildren()
  for (const card of view.hand || []) {
    const moves = actions.filter(
      (a) => a.type === 'play' && a.cardId === card.id,
    )
    const b = document.createElement('button')
    b.className =
      'card face' +
      (isRed(card) ? ' red' : '') +
      (moves.length && context.inputEnabled ? ' playable' : '')
    b.innerHTML = cardContents(card)
    b.setAttribute(
      'aria-label',
      card.label + (moves.length ? ', playable' : ''),
    )
    b.disabled = !moves.length || !context.inputEnabled || busy
    b.onclick = () => {
      if (moves.length > 1) {
        selectedAce = card.id
        paint()
      } else submit(moves[0])
    }
    $('hand').append(b)
  }
  const draw = actions.find((a) => a.type === 'draw')
  $('draw-pile').disabled = !draw || !context.inputEnabled || busy
  $('draw-pile').onclick = () => submit(draw)
  $('actions').replaceChildren()
  for (const a of actions.filter((a) => a.type !== 'play'))
    $('actions').append(
      actionButton(a.label, a, a.type === 'kadi' ? 'kadi' : ''),
    )
  if (!actions.length && own && view.phase !== 'finished') {
    const note = document.createElement('span')
    note.className = 'muted'
    note.textContent =
      'Waiting for the other player' + (view.players.length > 2 ? 's' : '')
    $('actions').append(note)
  }
  const aceMoves = actions.filter(
    (a) => a.type === 'play' && a.cardId === selectedAce,
  )
  $('suits').hidden = !aceMoves.length
  $('suits')
    .querySelector('div')
    .replaceChildren(
      ...aceMoves.map((a) => actionButton(symbols[a.suit] + ' ' + a.suit, a)),
    )
  $('hint').textContent =
    view.phase === 'finished'
      ? 'Use the live session’s rematch control to deal again.'
      : !own
        ? 'Take an open seat in the live session to receive your private hand.'
        : !context.inputEnabled
          ? 'Waiting for live control. Cards become playable when the session grants your seat.'
          : myTurn
            ? own.count === 2 && !own.kadi
              ? 'Two cards left: call Niko Kadi before playing your next card.'
              : 'Tap a highlighted card to play. Aces let you choose the next suit.'
            : 'Your hand stays private. The highlighted player has the turn.'
}
$('rules-toggle').onclick = () => {
  const open = $('rules').hidden
  $('rules').hidden = !open
  $('rules-toggle').setAttribute('aria-expanded', String(open))
}
window.arcade = {
  render(state, nextContext = {}) {
    context = nextContext
    view = state
    actions = nextContext.observation?.legalActions || []
    const key =
      String(state?.move) +
      ':' +
      String(state?.seatId) +
      ':' +
      String(nextContext.inputEnabled)
    if (key !== lastKey) {
      selectedAce = null
      lastKey = key
    }
    paint()
  },
}
