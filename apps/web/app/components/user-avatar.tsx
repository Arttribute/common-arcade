/**
 * The placeholder avatar, matching Agent Commons: a three-stop pastel gradient
 * chosen from a stable hash of the account, with the first letters of the name
 * set in black. The same account always gets the same gradient, in either app.
 */
const tailwind = {
  red: ['#fecaca', '#fca5a5'],
  yellow: ['#fef08a', '#fde047'],
  green: ['#bbf7d0', '#86efac'],
  blue: ['#bfdbfe', '#93c5fd'],
  purple: ['#e9d5ff', '#d8b4fe'],
  pink: ['#fbcfe8', '#f9a8d4'],
  indigo: ['#c7d2fe', '#a5b4fc'],
  fuchsia: ['#f5d0fe', '#f0abfc'],
  orange: ['#fed7aa', '#fdba74'],
  teal: ['#99f6e4', '#5eead4'],
  lime: ['#d9f99d', '#bef264'],
  rose: ['#fecdd3', '#fda4af'],
  cyan: ['#a5f3fc', '#67e8f9'],
  sky: ['#bae6fd', '#7dd3fc'],
  violet: ['#ddd6fe', '#c4b5fd'],
  emerald: ['#a7f3d0', '#6ee7b7'],
  amber: ['#fde68a', '#fcd34d'],
} as const
type Hue = keyof typeof tailwind

// The same trios, in the same order, as Commons' RandomAvatar.
const trios: [Hue, Hue, Hue][] = [
  ['red', 'yellow', 'green'],
  ['blue', 'purple', 'pink'],
  ['indigo', 'fuchsia', 'orange'],
  ['teal', 'green', 'lime'],
  ['rose', 'pink', 'purple'],
  ['cyan', 'sky', 'blue'],
  ['violet', 'purple', 'fuchsia'],
  ['emerald', 'green', 'lime'],
  ['amber', 'yellow', 'lime'],
]
const directions = ['to right', 'to left', 'to top', 'to bottom']

function hashCode(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

export function avatarGradient(seed: string) {
  // Commons enumerates direction x shade x trio; index into the same grid.
  const index =
    hashCode(seed || 'default') % (directions.length * 2 * trios.length)
  const direction = directions[Math.floor(index / (2 * trios.length))]!
  const shade = Math.floor(index / trios.length) % 2
  const [a, b, c] = trios[index % trios.length]!
  return `linear-gradient(${direction}, ${tailwind[a][shade]}, ${tailwind[b][shade]}, ${tailwind[c][shade]})`
}

export function UserAvatar({
  seed,
  name,
  size = 28,
}: {
  seed: string
  name: string
  size?: number
}) {
  return (
    <span
      className="arcade-avatar"
      style={{
        width: size,
        height: size,
        backgroundImage: avatarGradient(seed),
        fontSize: Math.max(size * 0.3, 8),
      }}
      aria-hidden
    >
      {(name || seed).trim().slice(0, 3).toLowerCase()}
    </span>
  )
}
