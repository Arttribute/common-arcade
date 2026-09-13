'use client'
import { motion, useReducedMotion } from 'motion/react'

/**
 * The landing hero's background: a few quiet clusters of pixels that light up
 * and fade out in turn, like a game board idling between turns.
 *
 * Positions come from a fixed seed so the server and client render the same
 * markup. The layer is decorative only — hidden from assistive tech, clear of
 * pointer events, and static when the reader prefers reduced motion.
 */
const clusters = [
  { x: 74, y: 4, cols: 7, rows: 3 },
  { x: 60, y: 34, cols: 5, rows: 3 },
  { x: 86, y: 26, cols: 4, rows: 5 },
]

const palette = ['var(--hl-primary)', 'var(--hl-secondary)', 'var(--ink)']

function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

const pixels = clusters.flatMap((cluster, clusterIndex) => {
  const random = seeded(clusterIndex * 97 + 13)
  const cells = []
  for (let row = 0; row < cluster.rows; row++)
    for (let col = 0; col < cluster.cols; col++) {
      if (random() < 0.45) continue
      const tone = random()
      cells.push({
        key: `${clusterIndex}-${row}-${col}`,
        left: `calc(${cluster.x}% + ${col * 22}px)`,
        top: `calc(${cluster.y}% + ${row * 22}px)`,
        color: palette[tone < 0.5 ? 0 : tone < 0.8 ? 1 : 2]!,
        peak: tone < 0.8 ? 0.9 : 0.18,
        delay: random() * 6,
        duration: 3.2 + random() * 2.4,
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
            background: pixel.color,
          }}
          initial={{ opacity: reduce ? pixel.peak * 0.35 : 0, scale: 1 }}
          animate={
            reduce
              ? undefined
              : {
                  opacity: [0, pixel.peak, pixel.peak, 0],
                  scale: [0.6, 1, 1, 0.6],
                }
          }
          transition={{
            duration: pixel.duration,
            delay: pixel.delay,
            repeat: Infinity,
            repeatDelay: 1.5,
            ease: 'easeInOut',
            times: [0, 0.25, 0.7, 1],
          }}
        />
      ))}
    </div>
  )
}
