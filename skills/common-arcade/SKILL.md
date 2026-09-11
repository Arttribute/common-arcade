---
name: common-arcade
description: Create, revise, publish, discover and playtest Common Arcade web games using its portable API, SDK and browser bridge. Use for Arcade game projects and game interactions from any agent system.
---

Use the user's configured Arcade host; the hosted base is `https://arcade.agentcommons.io/api/arcade`. Discover its contract at `/.well-known/arcade.json` and `/openapi.json`. The wire protocol remains alpha. Authenticate with the user's scoped Arcade access key or Commons OAuth token in the Authorization bearer header. Keep credentials in the host process, never in game code or previews.

## Create and revise

Create a durable workspace with `POST /v1/projects` and `{ "document": ... }` before editing. Its returned `prj_` ID opens at `/studio/{id}`. General web games use:

```json
{
  "kind": "browser",
  "title": "My game",
  "description": "How to play",
  "entryFile": "index.html",
  "play": {
    "mode": "realtime",
    "seats": { "min": 2, "max": 2, "default": 2 },
    "maxDecisionsPerSecond": 10
  },
  "runtime": {
    "kind": "sandboxed-script",
    "entryFile": "server.js",
    "tickRate": 30,
    "memoryMiB": 16,
    "timeoutMs": 20
  },
  "files": [
    {
      "path": "index.html",
      "content": "<!doctype html><html><body><canvas id=game></canvas><script type=module src=main.js></script></body></html>"
    },
    {
      "path": "main.js",
      "content": "// Presentation and window.arcade bridge"
    },
    {
      "path": "server.js",
      "content": "// Authoritative globalThis.arcadeGame rules"
    }
  ]
}
```

Use HTML, CSS, JavaScript, TypeScript, JSX or TSX with local module imports. Declare engine/UI libraries in optional `dependencies`, mapping npm root package names to exact semver versions. The browser resolves them through esm.sh; include React dependencies when using JSX. Keep all authored source files in the project; current source limit is 120 KB / 60 files. Media belongs in separately hosted assets. Include instructions, controls, restart, score/outcome feedback and responsive presentation.

Fetch the project before changing it. `PUT /v1/projects/{id}` takes the entire document and `If-Match: {revision}`. On 409, reload and reconcile rather than overwrite. Publishing is `POST /v1/projects/{id}/publish` with the same revision header; it produces an immutable release. Report saved/published state only after successful responses.

## Play and test

Preview-only browser games run in an opaque-origin sandbox. Expose a local
semantic bridge for those previews where possible:

```js
window.arcade = {
  seats: () => [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue' },
  ],
  observe: (seatId) => ({
    phase: 'active',
    score,
    playerPosition,
    visibleObstacles,
    seatId,
    arcadeDecisionContext: {
      incomingThreats: [{ timeToImpactMs: 750, direction: 'left' }],
      rewardDelta: 0,
      actionScores: { left: -4, jump: 12 },
      preferredActions: ['jump'],
      avoidActions: [],
    },
  }),
  actions: (seatId) => [
    { id: 'left', label: 'Move left' },
    { id: 'jump', label: 'Jump' },
  ],
  step: (id, seatId) => applyGameAction(seatId, id),
}
```

The Studio copilot contract requires this full local bridge for preview-only
games. Managed live games use the authoritative server bridge described below
and must not duplicate authoritative state transitions in browser code.
Create it synchronously before the entry module finishes. Seat IDs and action
IDs must be stable, unique strings; `observe` must return only JSON-serializable
public state for the requested seat; `actions` must return only actions legal
for that seat at that moment; and `step` must reject an illegal or out-of-turn
action instead of applying it. Keep `play.seats.default` aligned with the seats
returned by the bridge and render the first playable state before initialization
finishes. Re-observe after every state change. Do not put secrets, prize logic,
wallet authority, or authoritative competitive outcomes in browser code.

Make observations useful for decisions rather than mirroring render state. At
minimum expose the current phase, objective/progress, the acting player's status
and position, visible opponents/obstacles, and derived timing for realtime
hazards. When an action's outcome becomes attributable, expose a bounded numeric
`arcadeDecisionContext.rewardDelta`. Games with unusual controls may also expose
bounded `actionScores` keyed by current legal action ID, plus
`preferredActions`/`avoidActions`; derive these only from information visible to
that seat. These semantic hints let the low-latency policy react between slower
model decisions without parsing pixels or rediscovering the game's physics.

For a live release, presentation assigns `window.arcade` with
`render(authoritativeState, context)` and calls `window.arcade.submit(action)`
from human controls. Arcade installs `submit`; game code must not implement or
recursively wrap it. Live seat observations and legal actions come from the
authoritative runtime, so browser `seats`, `observe`, `actions`, and `step`
functions are neither required nor authoritative. The separate server file assigns
`globalThis.arcadeGame` with pure synchronous methods:

```js
globalThis.arcadeGame = {
  initialize(context) {},
  validateAction(state, action, context) {},
  applyAction(state, action, context) {},
  tick(state, context) {}, // required for realtime and hybrid games
  observe(state, seatId, context) {},
  result(state) {},
}
```

Transitions return `{ state, events }`; observations return
`{ visibleState, legalActions, feedback? }`; `result` returns `null` until the
game ends. All values must be JSON-serializable. The managed module runs in a
bounded QuickJS WebAssembly sandbox with no network, filesystem, process, host
clock, WebAssembly, or `Math.random`. Use initialization `context.seed` and
serialized state for deterministic randomness, and `context.elapsedMs` /
`context.deltaMs` for timing. Include derived timing such as time-to-impact in
realtime observations so agents act on authoritative facts rather than visual
guesswork.

Use `context.configuration` for host-selected game settings. Declare those
settings in the browser document's `configurationSchema` as a strict root object
with string, number, integer, or boolean properties and a typed default for every
property. Keep strings within 500 characters, enums within 32 choices, and the
resolved object within 16 KiB. Arcade validates and resolves the values before
initialization, and publication exercises advertised role and configuration
boundaries; never read authoritative settings from browser controls or ambient
globals.

Build the mechanics the creator asked for. Never replace a shooting, racing,
sports, strategy, card, simulation, 2D, or 3D request with a grid or
tic-tac-toe game unless the creator explicitly requested that mechanic. The
same custom live contract supports these genres; use a browser-only preview
only when the creator explicitly asks for a non-live prototype.

Previews intentionally omit `allow-same-origin`. Do not try to weaken the iframe
sandbox or depend on origin identity. Authored `localStorage` and
`sessionStorage` calls receive an in-memory compatibility store in Preview, so
gameplay must not require storage to initialize and must tolerate an empty store.
Use local project files for assets and imports, declare exact versions for npm
dependencies, and never fetch executable source from relative URLs or an HTML
route.

After writing a game, call the Arcade test tool. Treat schema, compilation,
sandbox, or agent-bridge failures as unfinished work: read the current revision,
repair it, save the complete document, and test again before reporting success.

A browser automation agent can use its Playwright frame to evaluate `window.arcade.observe(seatId)`, inspect `window.arcade.actions(seatId)`, and call `window.arcade.step(id, seatId)`. Without a bridge, use accessible browser controls. Observe again after each action. Do not guess hidden game state.

For durable diagnostics, create `POST /v1/projects/{id}/browser-runs` with one human or owned Commons agent controller per seat, then `POST /v1/studio/browser-runs/{runId}/decide` with `{step, seatId, observation:{state,actions}, actionId}`. Human or external controllers supply `actionId`; Commons agents choose through their durable per-seat Commons session. Update an agent at a safe decision boundary with `POST /v1/studio/browser-runs/{runId}/controllers/{seatId}/strategy` and `{prompt}`. Execute the returned action in the browser, then send the next observation. Sessions retain up to 200 decisions and can be listed from the project run endpoint. These are private, client-observed, unrated playtests and are never prize eligible; competitive rewards require the authoritative match runtime.

Managed releases support the authoritative match/WebSocket protocol regardless
of genre. Use manifest runtime capabilities to select live play; browser-only
releases remain private preview/test artifacts.

## Annotation context and recordings

Annotations identify a saved revision and normalized content geometry. Compiled previews use a fixed 1280 × 720 logical viewport. Read `context.viewport`, `context.moment`, the observation, and any recording reference together. Panel resizing changes display scale, not the logical coordinates. Do not reinterpret a highlighted region against a different revision or a responsive layout with a different viewport.

Recordings are opt-in and use the portable `commons.recording.v1` JSON format. They include rrweb events and interaction timing. Private is the default; publish spectator access only when the user asks. Downloads can be stored anywhere. Hosted uploads use signed forms backed by S3 or a self-hosted S3-compatible endpoint.

## Managed runtime diagnostics

Read `/v1/schemas/v0alpha1/game-document` for the authoritative authoring schema.
Before publishing, call `POST /v1/projects/{id}/runs` with `{ "steps": 60 }`
(or `seed`, `configuration`, and scripted `actions: [{step, seat, action}]`).
Step and seat indexes are zero-based. Check determinism, replay differences,
per-step timing, and feedback/perception warnings. Runtime values are bounded
at 192 KiB. Use an optional `prepare(context)` to compute immutable JSON level
resources once; methods read the frozen value from `globalThis.arcadePrepared`.
Mutable match data belongs in serialized state.

Declare role counts and optional teams in `play.roles`. Add `minCount` and
`maxCount` to a role only when hosts may vary that role; otherwise its `count` is
fixed. The resolved total must stay within `play.seats.min` and
`play.seats.max`. Declare spectator policy in `play.spectators` and late-join
policy in `play.lateJoin`. Emit per-seat
`feedback` with measurable reward, outcome, summary, and metrics. For realtime
agents, expose enough future context for the declared decision cadence.

For live control, acquire a seat and create a session, then wait for
`control.granted` after the WebSocket welcome before submitting an action.
Respect decision timing and action acknowledgements; do not flood ticks with
model requests. Owners can end abandoned matches with `DELETE /v1/matches/{id}`.
Inactive lobbies and disconnected running games expire automatically.
Configuration and role allocation are immutable during a round. Owner-controlled
series may submit validated replacements when starting the next round; occupied
seats cannot be removed.
