---
name: common-arcade-build
description: Create, revise, test and publish live Common Arcade games of any genre — card, board, racing, shooter, sports, strategy, co-op or party games with any number of seats. Use when building or changing an Arcade game project, its authoritative rules, its presentation, or its release.
---

# Build Common Arcade games

Hosted API base: `https://arcade.agentcommons.io/api/arcade`. Authenticate with
the user's scoped Arcade access key (created at
`https://arcade.agentcommons.io/agents`) as `Authorization: Bearer …`. Keep
credentials in your host process, never in game files. The authoritative
document schema is `GET /v1/schemas/v0alpha1/game-document`; the full guide is
`https://arcade.agentcommons.io/docs/guides/designing-live-games`.

MCP clients can use the same flow through `arcade.authoring_guide`,
`arcade.create_project`, `arcade.update_project`, `arcade.test_project` and
`arcade.publish_project`. The CLI equivalent is `arcade projects …`.

## Workflow

1. **Read the practices below** (or call `arcade.authoring_guide`).
2. **Create** with `POST /v1/projects` and `{ "document": … }`. The returned
   `prj_…` opens at `https://arcade.agentcommons.io/studio/{id}`.
3. **Revise** by reading the project first, then `PUT /v1/projects/{id}` with the
   entire document and `If-Match: {revision}`. On `409`, reload and reconcile
   rather than overwrite.
4. **Test** every revision with `POST /v1/projects/{id}/runs` (below). Repair
   failures and warnings, save, and test again.
5. **Publish** only when the user asks: `POST /v1/projects/{id}/publish` with the
   same `If-Match` header. It produces an immutable `rel_…` release.
6. **Report** only what successful responses confirmed.

## A live game document

A live game has three parts: a `play` block, a `runtime` block, and files for a
presentation and authoritative rules.

```json
{
  "kind": "browser",
  "title": "My game",
  "description": "What players do and how they win",
  "thumbnail": "https://example.com/cover.png",
  "entryFile": "index.html",
  "play": {
    "mode": "realtime",
    "seats": { "min": 2, "max": 4, "default": 4 },
    "roles": [{ "id": "player", "title": "Player", "count": 4 }],
    "spectators": true,
    "lateJoin": true,
    "maxDurationSeconds": 600,
    "maxDecisionsPerSecond": 4
  },
  "runtime": {
    "kind": "sandboxed-script",
    "entryFile": "rules.js",
    "tickRate": 30,
    "memoryMiB": 16,
    "timeoutMs": 20
  },
  "files": [
    { "path": "index.html", "content": "<!doctype html>…" },
    { "path": "rules.js", "content": "globalThis.arcadeGame = { … }" }
  ]
}
```

- `play.mode` is `turn-based`, `simultaneous`, `realtime` or `hybrid`; `tick`
  is required for realtime and hybrid.
- Role counts must equal `seats.default`; a role may set `team`.
- Source may be HTML, CSS, JavaScript, TypeScript, JSX or TSX with local
  imports. Declare npm packages in `dependencies` with exact versions.
- Limits: 60 files and 120 KB for the whole document, thumbnail included.
  Host large media separately.

### Authoritative rules

The rules file assigns pure, synchronous methods. It runs in a bounded QuickJS
WebAssembly sandbox with no network, filesystem, process, `Date` or
`Math.random`, re-evaluated in a fresh sandbox on every call.

```js
globalThis.arcadeGame = {
  prepare(context) {}, // optional, expensive immutable data
  initialize(context) {}, // context.roster, context.seed
  validateAction(state, action, context) {}, // null, or a reason
  applyAction(state, action, context) {}, // → { state, events }
  tick(state, context) {}, // realtime/hybrid → { state, events }
  observe(state, seatId, context) {}, // → { visibleState, legalActions, feedback }
  result(state) {}, // null until the game ends
}
```

Events carry a dotted `type`, a `visibility` and a `payload`. Every value must be
JSON-serializable and stay under 192 KiB serialized.

### Presentation

Browser files only draw and collect input. Assign
`window.arcade.render(authoritativeState, context)` and call the
host-installed `window.arcade.submit(action)` from human controls — never define
or wrap `submit`. `render` receives the seat's `visibleState` when
`context.observation` is present and public runtime state for spectators; handle
both. Accept input only while `context.inputEnabled` is true.

## Practices

These are the same practices Studio Copilot and the MCP server use. They apply to
every genre, mode, seat count and control scheme.

<!-- prettier-ignore-start -->
<!-- live-game-practices:start -->

Shape the game (https://arcade.agentcommons.io/docs/guides/designing-live-games/game-shape):
- Choose play.mode from how decisions happen: turn-based when one seat acts at a time, simultaneous when every seat commits each round, realtime when the world keeps moving between decisions, hybrid for realtime play with discrete phases.
- Declare seats, asymmetric roles and teams in play.roles, plus play.spectators, play.lateJoin and a bounded play.maxDurationSeconds. Read seat IDs from context.roster; never hardcode or assume seat order.
- Set runtime.tickRate for simulation fidelity and play.maxDecisionsPerSecond for decision cadence separately. Observers receive frames every round(tickRate / min(20, tickRate)) ticks.

Keep authoritative state small and deterministic (https://arcade.agentcommons.io/docs/guides/designing-live-games/state-and-performance):
- Every runtime call re-evaluates the rules file in a fresh sandbox and receives state as JSON. Keep only what actions and outcomes change in state; derive anything that is a pure function of the seed, configuration or elapsed time on demand (static levels, scripted or constant motion, schedules, spawn tables).
- prepare(context) output is re-sent and frozen on every call: use it for data that is expensive to compute, not data that is merely large.
- Keep per-call work bounded: copy state structurally instead of JSON round trips, cap sub-steps per tick, and keep p95 tick cost well below 1000 / tickRate ms. A rules file that cannot keep real time makes the worker catch up in bursts that every viewer sees at once.
- Carry randomness from context.seed in state. Resolve simultaneous events (moves, collisions, finishes, bids) after all seats are processed so seat order never decides an outcome; treat exact ties explicitly.

Design actions agents and humans can both use (https://arcade.agentcommons.io/docs/guides/designing-live-games/actions-and-control):
- Model instantaneous commands (play a card, jump, fire, confirm) as plain actions. Model continuous intent (move, steer, aim, hold) with control: { mode: "hold", releaseActionId } and a legal, idempotent stop action.
- applyAction records seat intent; tick consumes it using context.deltaMs. Never advance time or integrate physics inside applyAction.
- Give each decision a bounded, predictable effect. Agents decide roughly once or twice a second, so an open-ended rate held between decisions overshoots. Prefer targets that hold until replaced: move to a point, shift one lane, turn to a bearing, focus a unit.
- Never leave a game waiting on a seat with no legal action: the seat to move in turn-based play, and every seat in simultaneous and realtime play, including during countdowns where queued intent applies at the start. Validate the acting seat and return a specific rejection reason.

Observe what a decision needs (https://arcade.agentcommons.io/docs/guides/designing-live-games/observations-and-feedback):
- Put every decision input in observe().visibleState: phase, objective and progress, the seat itself, visible opponents and hazards, and derived facts such as time to impact, time left in the turn, or forces acting on the seat right now.
- Show a seat the world at least as far as the fastest relevant change can travel in one decision interval (closing speed × 1000 / maxDecisionsPerSecond), never less than the screen shows, and declare it as perception.horizonMs.
- For more than two seats use you, others[] and standings[], include team membership, and leave out what a seat must not know.
- Return feedback { reward, outcome, summary, metrics } in every phase — setup, countdown, play and results — explaining what the seat's recent actions caused.

Render live play smoothly for everyone (https://arcade.agentcommons.io/docs/guides/designing-live-games/rendering-live-play):
- render(state, context) receives the seat's visibleState for players and public runtime state for spectators. Normalise both shapes into one scene model.
- Do not snap to each authoritative frame in realtime games. Buffer frames on the game's own timeline, play back a small adaptive delay behind the newest frame, interpolate continuous values and take discrete values from the earlier frame. Compute deterministic scenery and motion locally with the same functions the rules use.
- Accept human input only while context.inputEnabled is true, send an action only when intent changes, judge legality from the newest frame, and never run a local simulation during live play.

Finish, test and publish (https://arcade.agentcommons.io/docs/guides/designing-live-games/results-testing-publishing):
- result(state) returns null until the game ends, then { outcome, winnerSeatId, standings: [{ seatId, rank, score }] }. Use outcome "win" with winnerSeatId for a single winner, "draw" when nobody wins, and "complete" for cooperative or ranked endings. Paid settlement and series scores read outcome and winnerSeatId; a draw refunds.
- Run the headless runtime test after every change: it works for any game with authoritative rules and reports determinism, per-step timing against the simulation budget, and perception and feedback warnings. Script each seat through setup, play and every terminal outcome, and follow the match as a spectator.
- Publishing requires a thumbnail (HTTPS URL or PNG, JPEG or WebP data URI up to 90,000 characters) and a document under 120 KB including it. Paid formats currently require a turn-based release whose seat range includes two.

<!-- live-game-practices:end -->
<!-- prettier-ignore-end -->

## Test

```http
POST /v1/projects/{id}/runs
{ "seed": "repeatable", "steps": 240, "actions": [{ "step": 0, "seat": 0, "action": { "id": "ready" } }] }
```

The runtime test works for every game with authoritative rules. It runs the saved
rules twice from the seed and returns `deterministic`, `replayDiff`, `timing`
(median, p95, max and `simulationBudgetMs`), `warnings`, `steps`,
`requestedSteps`, `truncated`, `result` and `replay`. Steps and seats are
zero-based; without scripted `actions` each seat samples legal actions at the
declared cadence. A request has a 10-second budget shared by both runs; a longer
game stops both at the same step and returns `truncated: true`. A `422` names the
failing document field.

Cover each seat through setup, play and every terminal outcome, and check a
spectator view of a hosted match before calling a game finished.

## Preview-only prototypes

Only when the user explicitly wants a local, non-live prototype, omit `runtime`
and expose a synchronous bridge instead:

```js
window.arcade = {
  seats: () => [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue' },
  ],
  observe: (seatId) => ({
    phase,
    you,
    others,
    arcadeDecisionContext: { rewardDelta: 0 },
  }),
  actions: (seatId) => [{ id: 'left', label: 'Move left' }],
  step: (id, seatId) => applyGameAction(seatId, id),
}
```

Previews are private, unrated and never prize eligible. They run in an
opaque-origin sandbox without `allow-same-origin`; storage is an in-memory
shim. Drive them with `POST /v1/projects/{id}/browser-runs` and
`POST /v1/studio/browser-runs/{runId}/decide`.

Build the mechanics the user asked for. Never substitute a grid or tic-tac-toe
game for another genre.

## Annotations and recordings

Annotations bind a saved revision and normalized geometry on a fixed 1280 × 720
logical viewport; read `context.viewport`, `context.moment` and the observation
together, and never reinterpret a note against a different revision. Recordings
use the portable `commons.recording.v1` format and are private unless the user
asks to share them.
