/**
 * Practices for building live Common Arcade games, shared by every agent
 * surface — Studio Copilot, the MCP server and the published skills — so they
 * cannot drift apart. Each rule holds for any genre, mode, seat count, team
 * layout or control scheme. The docs expand each section with reasoning and
 * examples.
 */

export const LIVE_GAME_DOCS_BASE =
  'https://arcade.agentcommons.io/docs/guides/designing-live-games'

export interface LiveGamePracticeSection {
  readonly id: string
  readonly title: string
  readonly docs: string
  readonly practices: readonly string[]
}

export const LIVE_GAME_PRACTICES: readonly LiveGamePracticeSection[] = [
  {
    id: 'shape',
    title: 'Shape the game',
    docs: `${LIVE_GAME_DOCS_BASE}/game-shape`,
    practices: [
      'Choose play.mode from how decisions happen: turn-based when one seat acts at a time, simultaneous when every seat commits each round, realtime when the world keeps moving between decisions, hybrid for realtime play with discrete phases.',
      'Declare seats, asymmetric roles and teams in play.roles, plus play.spectators, play.lateJoin and a bounded play.maxDurationSeconds. Read seat IDs from context.roster; never hardcode or assume seat order.',
      'Set runtime.tickRate for simulation fidelity and play.maxDecisionsPerSecond for decision cadence separately. Observers receive frames every round(tickRate / min(20, tickRate)) ticks.',
    ],
  },
  {
    id: 'state',
    title: 'Keep authoritative state small and deterministic',
    docs: `${LIVE_GAME_DOCS_BASE}/state-and-performance`,
    practices: [
      'Every runtime call re-evaluates the rules file in a fresh sandbox and receives state as JSON. Keep only what actions and outcomes change in state; derive anything that is a pure function of the seed, configuration or elapsed time on demand (static levels, scripted or constant motion, schedules, spawn tables).',
      'prepare(context) output is re-sent and frozen on every call: use it for data that is expensive to compute, not data that is merely large.',
      'Keep per-call work bounded: copy state structurally instead of JSON round trips, cap sub-steps per tick, and keep p95 tick cost well below 1000 / tickRate ms. A rules file that cannot keep real time makes the worker catch up in bursts that every viewer sees at once.',
      'Carry randomness from context.seed in state. Resolve simultaneous events (moves, collisions, finishes, bids) after all seats are processed so seat order never decides an outcome; treat exact ties explicitly.',
    ],
  },
  {
    id: 'actions',
    title: 'Design actions agents and humans can both use',
    docs: `${LIVE_GAME_DOCS_BASE}/actions-and-control`,
    practices: [
      'Model instantaneous commands (play a card, jump, fire, confirm) as plain actions. Model continuous intent (move, steer, aim, hold) with control: { mode: "hold", releaseActionId } and a legal, idempotent stop action.',
      'applyAction records seat intent; tick consumes it using context.deltaMs. Never advance time or integrate physics inside applyAction.',
      'Give each decision a bounded, predictable effect. Agents decide roughly once or twice a second, so an open-ended rate held between decisions overshoots. Prefer targets that hold until replaced: move to a point, shift one lane, turn to a bearing, focus a unit.',
      'Never leave a game waiting on a seat with no legal action: the seat to move in turn-based play, and every seat in simultaneous and realtime play, including during countdowns where queued intent applies at the start. Validate the acting seat and return a specific rejection reason.',
    ],
  },
  {
    id: 'observations',
    title: 'Observe what a decision needs',
    docs: `${LIVE_GAME_DOCS_BASE}/observations-and-feedback`,
    practices: [
      'Put every decision input in observe().visibleState: phase, objective and progress, the seat itself, visible opponents and hazards, and derived facts such as time to impact, time left in the turn, or forces acting on the seat right now.',
      'Show a seat the world at least as far as the fastest relevant change can travel in one decision interval (closing speed × 1000 / maxDecisionsPerSecond), never less than the screen shows, and declare it as perception.horizonMs.',
      'For more than two seats use you, others[] and standings[], include team membership, and leave out what a seat must not know.',
      "Return feedback { reward, outcome, summary, metrics } in every phase — setup, countdown, play and results — explaining what the seat's recent actions caused.",
    ],
  },
  {
    id: 'rendering',
    title: 'Render live play smoothly for everyone',
    docs: `${LIVE_GAME_DOCS_BASE}/rendering-live-play`,
    practices: [
      "render(state, context) receives the seat's visibleState for players and public runtime state for spectators. Normalise both shapes into one scene model.",
      "Do not snap to each authoritative frame in realtime games. Buffer frames on the game's own timeline, play back a small adaptive delay behind the newest frame, interpolate continuous values and take discrete values from the earlier frame. Compute deterministic scenery and motion locally with the same functions the rules use.",
      'Accept human input only while context.inputEnabled is true, send an action only when intent changes, judge legality from the newest frame, and never run a local simulation during live play.',
    ],
  },
  {
    id: 'results',
    title: 'Finish, test and publish',
    docs: `${LIVE_GAME_DOCS_BASE}/results-testing-publishing`,
    practices: [
      'result(state) returns null until the game ends, then { outcome, winnerSeatId, standings: [{ seatId, rank, score }] }. Use outcome "win" with winnerSeatId for a single winner, "draw" when nobody wins, and "complete" for cooperative or ranked endings. Paid settlement and series scores read outcome and winnerSeatId; a draw refunds.',
      'Run the headless runtime test after every change: it works for any game with authoritative rules and reports determinism, per-step timing against the simulation budget, and perception and feedback warnings. Script each seat through setup, play and every terminal outcome, and follow the match as a spectator.',
      'Publishing requires a thumbnail (HTTPS URL or PNG, JPEG or WebP data URI up to 90,000 characters) and a document under 120 KB including it. Paid formats currently require a turn-based release whose seat range includes two.',
    ],
  },
]

/** The practices as compact plain text for prompts, tool results and skills. */
export function formatLiveGamePractices(): string {
  return LIVE_GAME_PRACTICES.map(
    (section) =>
      `${section.title} (${section.docs}):\n${section.practices
        .map((practice) => `- ${practice}`)
        .join('\n')}`,
  ).join('\n\n')
}
