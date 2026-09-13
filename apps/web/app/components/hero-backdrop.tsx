'use client'
import { motion, useReducedMotion } from 'motion/react'

/**
 * The landing hero's background, after the pixel fields on base.org: dense
 * clusters of tiny squares and thin dashes in the Arcade pair, lighting up in
 * a sweep across each cluster — like a signal passing over a game board.
 *
 * Positions come from a fixed seed so server and client markup match. The
 * layer is decorative only — hidden from assistive tech, clear of pointer
 * events, and still under reduced motion.
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

export function HeroBackdrop() {
  const reduce = useReducedMotion()
  return (
    <div className="hero-backdrop" aria-hidden>
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
    </div>
  )
}
