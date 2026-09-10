const canvas = document.getElementById('arena'),
  ctx = canvas.getContext('2d')
let state = null,
  context = {},
  lastRender = 0,
  previous = null,
  buttons = new Map(),
  held = new Set()
const keys = {
  KeyA: 'retreat',
  KeyD: 'approach',
  KeyJ: 'jab',
  KeyK: 'kick',
  KeyL: 'uppercut',
  KeyW: 'jump',
  Space: 'block',
}
function send(id) {
  if (!context.inputEnabled) return
  const a = context.observation?.legalActions?.find((a) => a.id === id)
  if (a) window.arcade.submit(a)
}
function release(id) {
  if (!held.delete(id)) return
  if (['approach', 'retreat', 'block'].includes(id)) {
    const continuing = [...held].find((key) =>
      ['approach', 'retreat', 'block'].includes(key),
    )
    send(continuing ?? 'stop')
  }
}
addEventListener('keydown', (e) => {
  const id = keys[e.code]
  if (!id) return
  e.preventDefault()
  if (e.repeat) return
  held.add(id)
  send(id)
})
addEventListener('keyup', (e) => {
  const id = keys[e.code]
  if (id) {
    e.preventDefault()
    release(id)
  }
})
addEventListener('blur', () => {
  for (const id of held) release(id)
})
window.arcade = {
  render(s, c) {
    if (!s?.fighters) return
    previous = state
    state = s
    context = c
    lastRender = performance.now()
    document.getElementById('status').textContent = c.inputEnabled
      ? 'You control ' + (s.you?.name ?? 'VOLT')
      : (s.message ?? 'Spectating')
    const legal = c.observation?.legalActions ?? []
    for (const [id, b] of buttons)
      b.disabled = !c.inputEnabled || !legal.some((a) => a.id === id)
    for (const a of legal) {
      if (buttons.has(a.id)) continue
      const b = document.createElement('button')
      b.textContent = a.label
      b.onpointerdown = (e) => {
        e.preventDefault()
        b.setPointerCapture(e.pointerId)
        held.add(a.id)
        send(a.id)
      }
      b.onpointerup = () => release(a.id)
      b.onpointercancel = () => release(a.id)
      document.getElementById('controls').appendChild(b)
      buttons.set(a.id, b)
    }
  },
}
function fighter(p, i, x) {
  const facing = i ? -1 : 1,
    color = i ? '#ff754f' : '#63e4ff',
    y = 385 - p.y
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(facing, 1)
  ctx.lineCap = 'round'
  ctx.strokeStyle = p.flash ? 'white' : color
  ctx.lineWidth = 15
  ctx.shadowColor = color
  ctx.shadowBlur = 15
  ctx.beginPath()
  ctx.moveTo(-16, 0)
  ctx.lineTo(-12, -45)
  ctx.lineTo(4, -80)
  ctx.lineTo(13, -115)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(20, 0)
  ctx.lineTo(17, -42)
  ctx.lineTo(4, -80)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(10, -102)
  ctx.lineTo(32, -85)
  ctx.lineTo(p.pose === 'jab' ? 94 : 48, -110)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(8, -100)
  ctx.lineTo(-20, -83)
  ctx.lineTo(p.pose === 'block' ? 46 : -30, p.pose === 'uppercut' ? -165 : -110)
  ctx.stroke()
  if (p.pose === 'kick') {
    ctx.beginPath()
    ctx.moveTo(4, -60)
    ctx.lineTo(115, -75)
    ctx.stroke()
  }
  ctx.fillStyle = '#f2d1bf'
  ctx.beginPath()
  ctx.arc(15, -137, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.fillRect(-7, -150, 44, 8)
  ctx.restore()
}
function draw(t) {
  ctx.fillStyle = '#0b1023'
  ctx.fillRect(0, 0, 960, 500)
  const g = ctx.createLinearGradient(0, 140, 0, 420)
  g.addColorStop(0, '#171d40')
  g.addColorStop(1, '#322440')
  ctx.fillStyle = g
  ctx.fillRect(0, 130, 960, 300)
  ctx.strokeStyle = '#6973d43a'
  ctx.lineWidth = 1
  for (let i = 0; i < 20; i++) {
    ctx.beginPath()
    ctx.moveTo(480, 225)
    ctx.lineTo(i * 80 - 280, 500)
    ctx.stroke()
  }
  for (let y = 390; y < 500; y += 22) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(960, y)
    ctx.stroke()
  }
  ctx.fillStyle = '#8b93ff'
  ctx.fillRect(0, 390, 960, 2)
  ctx.font = 'bold 14px system-ui'
  if (state) {
    const blend = Math.min(1, (t - lastRender) / 33)
    state.fighters.forEach((p, i) => {
      const old = previous?.fighters[i],
        x = old ? old.x + (p.x - old.x) * blend : p.x
      fighter(p, i, x)
      const bx = i ? 540 : 40
      ctx.fillStyle = '#293148'
      ctx.fillRect(bx, 32, 380, 20)
      ctx.fillStyle = i ? '#ff754f' : '#63e4ff'
      ctx.fillRect(bx, 32, (380 * p.hp) / 100, 20)
      ctx.fillStyle = 'white'
      ctx.fillText(p.name + '  ' + p.hp, bx, 23)
    })
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.font = 'bold 30px system-ui'
    ctx.fillText(
      String(Math.max(0, Math.ceil((60000 - state.elapsed) / 1000))),
      480,
      54,
    )
    ctx.font = 'bold 18px system-ui'
    ctx.fillStyle = '#d1d5fb'
    ctx.fillText(state.message, 480, 110)
    if (state.phase === 'ended') {
      ctx.fillStyle = '#050719c9'
      ctx.fillRect(0, 170, 960, 140)
      ctx.fillStyle = 'white'
      ctx.font = 'bold 48px system-ui'
      ctx.fillText(state.message.toUpperCase(), 480, 255)
    }
    ctx.textAlign = 'left'
  }
  requestAnimationFrame(draw)
}
requestAnimationFrame(draw)
