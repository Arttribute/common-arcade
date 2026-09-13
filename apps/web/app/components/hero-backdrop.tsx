'use client'
import { useEffect, useRef } from 'react'
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'

/**
 * The landing hero's background, after the pixel fields on base.org: dense
 * clusters of tiny squares and thin dashes in the Arcade pair, lighting up in
 * a sweep across each cluster — like a signal passing over a game board.
 *
 * It follows the cursor: squares near the pointer glow as it passes (a
 * spotlight revealing a fully lit copy of the field, trailing on a spring),
 * and the whole field drifts a few pixels toward the pointer.
 *
 * Positions come from a fixed seed so server and client markup match. The
 * layer is decorative only — hidden from assistive tech and clear of pointer
 * events (it listens on the hero, never captures). Under reduced motion the
 * sweeps and drift stop; on touch screens there is no cursor to follow.
 */
type Cluster = {
  x: number // % of the hero's width
  y: number // % of the hero's height
  cols: number
  rows: number
  density: number // share of cells that hold a pixel
  sweep: 'right' | 'left' | 'down' | 'diagonal'
  offset: number // seconds before this cluster's first sweep
}

const clusters: Cluster[] = [
  { x: 58, y: 3, cols: 30, rows: 6, density: 0.62, sweep: 'right', offset: 0 },
  {
    x: 76,
    y: 24,
    cols: 20,
    rows: 9,
    density: 0.36,
    sweep: 'diagonal',
    offset: 1.4,
  },
  { x: 54, y: 40, cols: 14, rows: 4, density: 0.5, sweep: 'left', offset: 2.6 },
  { x: 90, y: 6, cols: 8, rows: 14, density: 0.5, sweep: 'down', offset: 0.8 },
]

const STEP = 10 // px between pixel origins
const SWEEP = 2.6 // seconds for a wave to cross a cluster
const CYCLE = 5.5 // seconds between waves

function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

type Pixel = {
  key: string
  left: string
  top: string
  width: number
  height: number
  color: string
  peak: number
  delay: number
}

const pixels: Pixel[] = clusters.flatMap((cluster, index) => {
  const random = seeded(index * 131 + 7)
  const cells: Pixel[] = []
  for (let row = 0; row < cluster.rows; row++)
    for (let col = 0; col < cluster.cols; col++) {
      // Thin the cluster toward its edges so it reads as a field, not a block.
      const edge = Math.min(
        col / cluster.cols,
        1 - col / cluster.cols,
        row / cluster.rows,
        1 - row / cluster.rows,
      )
      if (random() > cluster.density * (0.7 + edge * 2.4)) continue
      const tone = random()
      const dash = random() < 0.22
      const progress =
        cluster.sweep === 'right'
          ? col / cluster.cols
          : cluster.sweep === 'left'
            ? 1 - col / cluster.cols
            : cluster.sweep === 'down'
              ? row / cluster.rows
              : (col / cluster.cols + row / cluster.rows) / 2
      cells.push({
        key: `${index}-${row}-${col}`,
        left: `calc(${cluster.x}% + ${col * STEP}px)`,
        top: `calc(${cluster.y}% + ${row * STEP}px)`,
        width: dash ? 2 : 6,
        height: dash ? 10 : 6,
        color:
          tone < 0.42
            ? 'var(--hl-primary)'
            : tone < 0.78
              ? 'var(--hl-secondary)'
              : tone < 0.9
                ? 'var(--hl-primary-soft)'
                : 'var(--ink)',
        peak: tone < 0.9 ? 0.55 + random() * 0.45 : 0.22,
        delay: cluster.offset + progress * SWEEP + random() * 0.35,
      })
    }
  return cells
})

const DRIFT = 10 // px the field may move toward the cursor
const SPOTLIGHT = 90 // px radius of the glow around the cursor

export function HeroBackdrop() {
  const reduce = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  // Pointer position within the backdrop, and whether it is over the hero.
  const x = useMotionValue(-1000)
  const y = useMotionValue(-1000)
  const presence = useMotionValue(0)
  const spring = { stiffness: 180, damping: 26, mass: 0.6 }
  const sx = useSpring(x, spring)
  const sy = useSpring(y, spring)
  const glow = useSpring(presence, { stiffness: 120, damping: 20 })
  // Drift is a fraction of the pointer's offset from the backdrop's centre.
  const nx = useMotionValue(0)
  const ny = useMotionValue(0)
  const driftX = useSpring(
    useTransform(nx, (v) => v * DRIFT),
    spring,
  )
  const driftY = useSpring(
    useTransform(ny, (v) => v * DRIFT),
    spring,
  )
  const mask = useMotionTemplate`radial-gradient(circle ${SPOTLIGHT}px at ${sx}px ${sy}px, #000 0%, rgba(0,0,0,0.55) 45%, transparent 100%)`

  useEffect(() => {
    const layer = root.current
    const hero = layer?.parentElement
    if (!layer || !hero) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const move = (event: PointerEvent) => {
      const box = layer.getBoundingClientRect()
      x.set(event.clientX - box.left)
      y.set(event.clientY - box.top)
      nx.set(((event.clientX - box.left) / box.width - 0.5) * 2)
      ny.set(((event.clientY - box.top) / box.height - 0.5) * 2)
      presence.set(1)
    }
    const leave = () => {
      presence.set(0)
      nx.set(0)
      ny.set(0)
    }
    hero.addEventListener('pointermove', move)
    hero.addEventListener('pointerleave', leave)
    return () => {
      hero.removeEventListener('pointermove', move)
      hero.removeEventListener('pointerleave', leave)
    }
  }, [x, y, nx, ny, presence])

  const drift = reduce ? undefined : { x: driftX, y: driftY }
  return (
    <div className="hero-backdrop" aria-hidden ref={root}>
      <motion.div className="hero-field" style={drift}>
        {pixels.map((pixel) => (
          <motion.span
            key={pixel.key}
            className="hero-pixel"
            style={{
              left: pixel.left,
              top: pixel.top,
              width: pixel.width,
              height: pixel.height,
              background: pixel.color,
            }}
            initial={{ opacity: reduce ? pixel.peak * 0.3 : 0 }}
            animate={reduce ? undefined : { opacity: [0, pixel.peak, 0] }}
            transition={{
              duration: 1.6,
              delay: pixel.delay,
              repeat: Infinity,
              repeatDelay: CYCLE - 1.6,
              ease: 'easeInOut',
              times: [0, 0.3, 1],
            }}
          />
        ))}
      </motion.div>
      {/* The lit copy, revealed only around the cursor. The mask lives on a
          layer that does not drift, so it stays under the pointer; the pixels
          inside drift with the field, so they stay on top of their twins. */}
      <motion.div
        className="hero-field-lit"
        style={{ opacity: glow, WebkitMaskImage: mask, maskImage: mask }}
      >
        <motion.div className="hero-field" style={drift}>
          {pixels.map((pixel) => (
            <span
              key={pixel.key}
              className="hero-pixel"
              style={{
                left: pixel.left,
                top: pixel.top,
                width: pixel.width,
                height: pixel.height,
                background: pixel.color,
              }}
            />
          ))}
        </motion.div>
      </motion.div>
    </div>
  )
}
