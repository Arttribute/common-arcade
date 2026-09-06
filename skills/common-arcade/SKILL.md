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
  "files": [
    {
      "path": "index.html",
      "content": "<!doctype html><html><body><canvas id=game></canvas><script type=module src=main.js></script></body></html>"
    },
    { "path": "main.js", "content": "// Game implementation" }
  ]
}
```

Use HTML, CSS, JavaScript, TypeScript, JSX or TSX with local module imports. Declare engine/UI libraries in optional `dependencies`, mapping npm root package names to exact semver versions. The browser resolves them through esm.sh; include React dependencies when using JSX. Keep all authored source files in the project; current source limit is 120 KB / 60 files. Media belongs in separately hosted assets. Include instructions, controls, restart, score/outcome feedback and responsive presentation. The grid placement document is an explicit template, not the general game model.

Fetch the project before changing it. `PUT /v1/projects/{id}` takes the entire document and `If-Match: {revision}`. On 409, reload and reconcile rather than overwrite. Publishing is `POST /v1/projects/{id}/publish` with the same revision header; it produces an immutable release. Report saved/published state only after successful responses.

## Play and test

General browser games run in an opaque-origin sandbox. Expose a semantic bridge where possible:

```js
window.arcade = {
  observe: () => ({ score, state, playerPosition }),
  actions: () => [
    { id: 'left', label: 'Move left' },
    { id: 'jump', label: 'Jump' },
  ],
  step: (id) => applyGameAction(id),
}
```

A browser automation agent can use its Playwright frame to evaluate `window.arcade.observe()`, inspect available actions, and call `window.arcade.step(id)`. Without a bridge, use accessible browser controls. Observe again after each action. Do not guess hidden game state.

For durable diagnostics, create `POST /v1/projects/{id}/browser-runs` (optional owned Commons `agentId`), then `POST /v1/studio/browser-runs/{runId}/decide` with `{step, observation:{state,actions}, actionId}`. External agents supply their chosen actionId; Commons agents may choose it through the host. Execute the returned action in the browser, then send the next observation. Maximum 20 decisions per run. These are client-observed playtests, not authoritative ranked results. Read the run and its decisions with GET on the run URL.

Grid releases also support the authoritative match/WebSocket protocol. Use manifest runtime capabilities to select the appropriate path; do not send browser-only games to the grid match runtime.

## Annotation context and recordings

Annotations identify a saved revision and normalized content geometry. Compiled previews use a fixed 1280 × 720 logical viewport. Read `context.viewport`, `context.moment`, the observation, and any recording reference together. Panel resizing changes display scale, not the logical coordinates. Do not reinterpret a highlighted region against a different revision or a responsive layout with a different viewport.

Recordings are opt-in and use the portable `commons.recording.v1` JSON format. They include rrweb events and interaction timing. Private is the default; publish spectator access only when the user asks. Downloads can be stored anywhere. Hosted uploads use signed forms backed by S3 or a self-hosted S3-compatible endpoint.
