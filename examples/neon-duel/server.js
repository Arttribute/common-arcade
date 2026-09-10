// The same rules power live and tactical builds. The build script toggles this.
const TACTICAL = false
const verbs = [
  {
    id: 'approach',
    label: 'Advance',
    control: { mode: 'hold', releaseActionId: 'stop' },
  },
  {
    id: 'retreat',
    label: 'Retreat',
    control: { mode: 'hold', releaseActionId: 'stop' },
  },
  { id: 'stop', label: 'Stand ready' },
  {
    id: 'block',
    label: 'Block',
    control: { mode: 'hold', releaseActionId: 'stop' },
  },
  { id: 'jab', label: 'Quick jab' },
  { id: 'kick', label: 'Heavy kick' },
  { id: 'uppercut', label: 'Uppercut' },
  { id: 'jump', label: 'Jump' },
]
function player(s, id) {
  return s.fighters.find((p) => p.seatId === id)
}
function other(s, id) {
  return s.fighters.find((p) => p.seatId !== id)
}
function legal(s, id) {
  const p = player(s, id)
  if (
    !p ||
    s.phase === 'ended' ||
    (TACTICAL && s.fighters[s.turn % 2].seatId !== id)
  )
    return []
  return verbs
    .filter(
      (a) =>
        !(['jab', 'kick', 'uppercut'].includes(a.id) && p.cooldown > 0) &&
        !(a.id === 'jump' && p.y > 0),
    )
    .map((a) => (TACTICAL ? { id: a.id, label: a.label } : a))
}
function finish(s) {
  if (s.fighters.every((p) => p.hp > 0) && s.elapsed < 60000) return
  s.phase = 'ended'
  const a = s.fighters[0],
    b = s.fighters[1]
  s.winnerSeatId = a.hp === b.hp ? null : a.hp > b.hp ? a.seatId : b.seatId
  s.message = s.winnerSeatId ? player(s, s.winnerSeatId).name + ' wins' : 'Draw'
}
function advance(s, ms) {
  const dt = ms / 1000
  s.elapsed += ms
  for (const p of s.fighters) {
    p.cooldown = Math.max(0, p.cooldown - ms)
    p.flash = Math.max(0, p.flash - ms)
    p.poseMs = Math.max(0, p.poseMs - ms)
    if (!p.poseMs) p.pose = p.intent === 'block' ? 'block' : 'ready'
    const o = other(s, p.seatId),
      dir = o.x > p.x ? 1 : -1
    if (p.intent === 'approach' && Math.abs(o.x - p.x) > 75)
      p.x += dir * 170 * dt
    if (p.intent === 'retreat') p.x -= dir * 145 * dt
    p.x = Math.max(70, Math.min(890, p.x))
    if (p.y > 0 || p.vy > 0) {
      p.y += p.vy * dt
      p.vy -= 1200 * dt
      if (p.y < 0) {
        p.y = 0
        p.vy = 0
      }
    }
  }
  finish(s)
}
globalThis.arcadeGame = {
  initialize(c) {
    return {
      phase: 'fight',
      elapsed: 0,
      turn: 0,
      winnerSeatId: null,
      message: 'FIGHT',
      fighters: c.roster.map((r, i) => ({
        seatId: r.seatId,
        name: i ? 'EMBER' : 'VOLT',
        x: i ? 700 : 260,
        y: 0,
        vy: 0,
        hp: 100,
        intent: 'stop',
        cooldown: 0,
        flash: 0,
        pose: 'ready',
        poseMs: 0,
        damageDealt: 0,
      })),
    }
  },
  validateAction(s, a, c) {
    return legal(s, c.seatId).some((v) => v.id === a?.id)
      ? null
      : 'Action is not available for this seat'
  },
  applyAction(s, a, c) {
    const p = player(s, c.seatId),
      o = other(s, c.seatId),
      events = []
    if (['approach', 'retreat', 'stop', 'block'].includes(a.id)) p.intent = a.id
    if (a.id === 'jump') {
      p.vy = 480
      p.pose = 'jump'
      p.poseMs = 450
    }
    const attack = {
      jab: [105, 7, 260],
      kick: [145, 12, 600],
      uppercut: [100, 17, 850],
    }[a.id]
    if (attack) {
      p.pose = a.id
      p.poseMs = 200
      p.cooldown = attack[2]
      p.intent = 'stop'
      if (Math.abs(p.x - o.x) <= attack[0] && Math.abs(p.y - o.y) < 75) {
        const blocked = o.intent === 'block' && a.id !== 'uppercut'
        const damage = blocked ? 2 : attack[1]
        o.hp = Math.max(0, o.hp - damage)
        o.flash = 180
        p.damageDealt += damage
        s.message = blocked
          ? 'BLOCK'
          : a.id === 'uppercut'
            ? 'RISING STRIKE'
            : a.id.toUpperCase()
        events.push({
          type: 'combat.hit',
          visibility: 'public',
          payload: { attacker: p.seatId, target: o.seatId, damage, blocked },
        })
      } else {
        s.message = 'Out of range'
      }
    }
    if (TACTICAL) {
      for (let i = 0; i < 15; i++) advance(s, 50)
      s.turn++
    } else finish(s)
    return { state: s, events }
  },
  tick(s, c) {
    if (s.phase !== 'ended') advance(s, c.deltaMs)
    return { state: s, events: [] }
  },
  observe(s, id) {
    const p = player(s, id)
    if (!p) return { visibleState: { phase: s.phase }, legalActions: [] }
    const o = other(s, id),
      distance = Math.abs(p.x - o.x),
      actions = legal(s, id)
    const scores = {
      approach: distance > 140 ? 40 : -35,
      retreat: p.hp < 25 && p.cooldown > 0 ? 30 : -30,
      stop: -20,
      jab: distance <= 105 ? 24 : -40,
      kick: distance <= 145 ? 35 : -40,
      uppercut: distance <= 100 && o.intent === 'block' ? 40 : -5,
      block: o.cooldown === 0 && p.cooldown > 0 && distance < 145 ? 30 : -25,
      jump: distance < 120 && p.cooldown > 0 ? 10 : -30,
    }
    return {
      visibleState: {
        ...s,
        you: { ...p, distance },
        opponent: o,
        arcadeDecisionContext: { actionScores: scores },
      },
      legalActions: actions,
      feedback: {
        reward: 0,
        outcome:
          s.phase === 'ended'
            ? s.winnerSeatId === id
              ? 'win'
              : s.winnerSeatId
                ? 'loss'
                : 'draw'
            : 'playing',
        summary: 'Health ' + p.hp + '; opponent ' + o.hp,
        metrics: {
          health: p.hp,
          opponentHealth: o.hp,
          damageDealt: p.damageDealt,
        },
      },
    }
  },
  result(s) {
    return s.phase === 'ended'
      ? {
          outcome: s.winnerSeatId ? 'win' : 'draw',
          winnerSeatId: s.winnerSeatId,
          draw: !s.winnerSeatId,
          message: s.message,
        }
      : null
  },
}
