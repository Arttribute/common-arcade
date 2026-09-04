# Common Arcade implementation progress

Status date: 2026-09-04  
Protocol: `io.agentcommons.arcade/v0alpha1`  
Implementation baseline: `main` after the initial vertical-slice series  
Governing design: [`docs/architecture/common-arcade-system-design.md`](docs/architecture/common-arcade-system-design.md)

## Executive status

Common Arcade now has a working local vertical slice, not only scaffolding. A
caller can discover an immutable game release, create a match, claim seats,
mint a one-use session ticket, connect over WebSocket, play or spectate, resume
a disconnected controller, retrieve a deterministic replay, run two autonomous
policies in Test Arena, and inspect structured observation/decision/action
logs. The same control operations are available through TypeScript clients,
the CLI, MCP, and the Next.js product shell.

This is still a `v0alpha1` development system. The local runtime intentionally
uses process memory. The Lambda control deployment intentionally refuses match
operations until a durable service adapter is configured. The ECS stack is a
single-task protocol and packaging pilot, not a production multiplayer plane.

## Working end-to-end path

```text
Next.js / CLI / MCP / SDK
          |
          v
Hono control API ---- game + immutable release discovery
          |
          +---- match -> seat claim -> one-use session ticket
          |
          v
WebSocket gateway ---- welcome / sequence / ack / resume / resync
          |
          v
Authoritative worker ---- validate -> serialize -> apply -> hash -> checkpoint
          |
          +---- private seat observation
          +---- public spectator snapshot
          +---- canonical replay

Test Arena ---- Policy IR -> deterministic runner -> authority
          +---- structured diagnostics
          +---- step or complete
          +---- replay verification
```

## Implemented capabilities

### Protocol, release, and trust spine

- Versioned Zod contracts and generated JSON Schema 2020-12 documents for game
  manifests, game releases, discovery, matches, observations, actions, results,
  events, realtime envelopes, replays, and Problem Details.
- Opaque typed identifiers, lower-case SHA-256 digests, semantic versions,
  compatibility profiles, and strict unknown-field rejection.
- Canonical JSON, manifest hashing, Ed25519 manifest signatures, verification,
  and required/optional extension negotiation.
- Local principal parsing and exact-scope authorization primitives.
- Audience-, actor-, match-, seat-, controller-, and session-bound realtime
  tickets with short TTL and single-use nonce enforcement.
- `/.well-known/arcade.json`, OpenAPI draft, AsyncAPI draft, and local JWKS
  behavior.
- Explicit immutable release discovery separate from the stable game identity.

Primary implementation:

- `packages/protocol`
- `packages/manifest`
- `packages/auth`
- `schemas/v0alpha1`

### Deterministic authoritative runtime

- Generic `AuthoritativeMatch` lifecycle with state/event sequences, ownership
  epochs, fencing, legal action validation, stale-observation rejection, target
  turn validation, and action-id deduplication.
- Serialized authority operations so asynchronous hashing cannot reorder state
  transitions or checkpoints.
- Canonical command log, ordered events, state hashes, checkpoints, replay
  export, and replay verification.
- Declarative grid-placement interpreter and a complete Tic-tac-toe reference
  release with six game-level schemas and a content-addressed manifest.
- Tests for completion, turn legality, duplicates, concurrent submissions,
  stale ownership, replay agreement, and replay tampering.

Primary implementation:

- `packages/match-runtime`
- `examples/tic-tac-toe`

### Local control and realtime planes

- In-memory local platform boundary for release discovery, idempotent match
  creation, seat claims, session creation, observations, actions, lifecycle,
  subscriptions, and replay reads.
- Hono REST API with local development authentication, CORS allowlist,
  request IDs, strict input validation, stable Problem Details, and service
  readiness reporting.
- WebSocket gateway on the same local port with a versioned JSON envelope,
  one-use hello ticket, welcome negotiation, strictly increasing per-session
  server sequence, acknowledgements, ping/pong, bounded retained history,
  control grants, action results, public/private projection separation,
  event batches, flow notices, and graceful close.
- Thirty-second reconnect window with rotated single-use resume tokens. Resume
  restores the existing controller and requests a fresh authoritative
  projection instead of silently creating a second controller.
- Real HTTP/WebSocket integration coverage for play, spectator fan-out, ticket
  redemption, action acceptance, disconnect, resume, and resync.

Primary implementation:

- `services/match-worker`
- `apps/control-api`
- `apps/realtime-gateway`

### Agent policies, adaptation, and team coordination

- Strict Policy IR with compatibility declarations, bounded state/rule count,
  safe action selectors, priorities, cooldowns, fallbacks, step/action/memory
  budgets, canonical serialization, and content digest.
- A bounded CEL-style expression subset interpreted without `eval`, ambient
  network, filesystem, environment, or wall-clock access.
- Deterministic policy runtime with stable priority/tie resolution, legal-action
  selection, explicit state transitions, cooldowns, budget reporting, and
  structured explanations.
- Learning/Adaptation Contract intersection that rejects hidden metrics or
  game-forbidden update points.
- Game-independent strategy controller with evidence windows, minimum dwell,
  cooldown, transition-rate limits, strategy epochs, and explicit commit
  records.
- Team Policy schema and hybrid/centralized/decentralized coordinator model,
  typed/rate-limited messages, future atomic strategy epochs,
  acknowledgements, and expiring leases for scarce responsibilities.

Primary implementation:

- `packages/policy-ir`
- `packages/policy-runtime`
- `packages/adaptation`
- `packages/team-policy`

### Test Arena and diagnostics

- Private Tic-tac-toe policy-versus-policy runs pinned to a seed and compiled
  policy digests.
- Paused creation, single-step execution, and run-to-completion execution.
- Structured test-owner diagnostics for delivered observations, matched policy
  rules, proposed actions, policy budget state, and authoritative action
  results.
- Correlation by run, match, seat, observation sequence, action, turn, source,
  category, level, and event type.
- Owner-scoped diagnostic API with filters and bounded local retention.
- Canonical replay attached to each run and verified in automated tests.

Primary implementation:

- `packages/diagnostics`
- `packages/test-arena`
- Test-run routes in `apps/control-api`

### Developer and agent access

- Typed control client for games, releases, matches, claims, sessions, replays,
  test runs, stepping, and diagnostic queries.
- Transport-neutral realtime client with WebSocket injection, connection state,
  message subscriptions, sequence tracking, acknowledgements, action submit,
  flow preference, ping, close, and resume.
- Aggregated TypeScript SDK exports.
- CLI commands for status, doctor, game search/info, match create/inspect,
  replay display, Test Arena run, and Test Arena logs.
- Current MCP TypeScript SDK server over stdio with nine tools:
  discovery, game inspection, match creation/join, match/replay reads, Test
  Arena creation/read, and diagnostic query.
- MCP instructions explicitly move autonomous/realtime play to the persistent
  runner/WebSocket path rather than one model tool call per tick.

Primary implementation:

- `packages/control-client`
- `packages/realtime-client`
- `packages/sdk`
- `packages/cli`
- `apps/mcp-server`

### Human-facing product shell

- Registry-backed Discover view with compatibility signals and an explicit
  offline state.
- Game detail view with profiles, runtime/policy constraints, canonical
  manifest inspection, immutable release lookup, and match creation.
- Match shell with roster, local actor identity, seat claim, spectator mode,
  realtime connection state, generated Tic-tac-toe controls, public/private
  projections, action results, sequences, and reconnect control.
- Studio Test Arena view with seed/actor controls, autonomous run, paused run,
  single step, compiled board output, agent seats, budget/status summary,
  structured timeline, and selected-record raw inspection.
- Production Next.js build succeeds with dynamic registry/game routes and
  static home/play/studio shells.

Primary implementation: `apps/web`

### Conformance and deployment scaffolding

- Executable conformance reports for base, turn-based, replay,
  generic-controls, and policy profiles.
- Reference manifest conformance and checkpoint-for-checkpoint replay
  conformance tests.
- Existing Lambda/API Gateway, DynamoDB, S3, SQS/EventBridge, and ECR
  foundations remain synthesizable.
- Added a multi-stage realtime-gateway container and a public-subnet,
  single-task ALB/ECS Fargate pilot with CloudWatch logs, health checks,
  deployment circuit breaker, and explicit development-only outputs.
- CDK synthesis completes for Foundation, ControlPlane, and RealtimePilot.

Primary implementation:

- `packages/conformance`
- `infra/aws`
- `apps/realtime-gateway/Dockerfile`

## Verification completed

The following checks passed on the implementation baseline:

- workspace manifest validation;
- repository formatting;
- TypeScript checks across all workspace packages;
- all repository tests, including real REST/WebSocket integration;
- package and application builds;
- optimized Next.js production build;
- AWS CDK synthesis for all three stacks;
- live local control API status and game discovery through the built CLI;
- live local nine-turn autonomous Test Arena run with a draw, 27 structured
  diagnostic records, accepted authoritative commands, and replay checkpoints;
- live Next.js server rendering of Discover, game detail, and Studio against
  the running Hono stack.

Docker image compilation was not executed because no Docker daemon was
available in the development environment. CDK asset synthesis and the package
build used by that Dockerfile did complete.

## Design invariants currently upheld

- The match worker, never the browser or an LLM, owns state and outcomes.
- Acceptance and game effect remain distinct through action results and later
  state/events.
- Player observations and spectator state use different projections.
- MCP carries discovery and durable control, not the hot loop.
- A policy is immutable compiled input; changing source produces a new digest.
- Online strategy changes are explicit epoch commits, not hidden source edits.
- Team responsibilities are leased and team strategy changes have one future
  effective epoch.
- Replay is authoritative; diagnostics explain it but cannot alter it.
- Local development needs no AWS account or cloud credential.
- The standalone repository integrates through public contracts rather than
  importing Agent Commons internals.

## Remaining work, in design order

### Phase 0 gates still open

1. Ratify the protocol RFCs and ADRs rather than treating the design document
   plus implementation as approval.
2. Complete the threat model and data-classification map for games, policies,
   learning data, team communication, Test Arena, preview, registry, and
   identity.
3. Benchmark synthetic 20/30/60 Hz workers, fan-out, queue pressure, and unit
   economics.
4. Demonstrate killed-owner replacement with a durable lease and fencing
   across processes, not only stale-epoch rejection inside one process.
5. Select and prove the Wasm component host with fuel, memory, deterministic
   clock/RNG, no network, and cross-platform hash fixtures.
6. Complete the Nakama, GameLift, and build-sandbox/MicroVM time-boxed spikes.

### Phase 1 protocol completeness

1. Publish JSON Schemas for Learning Contract, Adaptation Contract, Team Policy,
   coordination messages, scenario, TestRun, diagnostics, policy candidates,
   evaluation, and experience provenance. Some exist today as TypeScript/Zod
   package contracts but are not all in the public schema bundle.
2. Replace the bounded CEL subset with the selected conformant CEL engine or
   formally specify and test the subset as an Arcade profile.
3. Add simultaneous, realtime-authoritative, hidden-information,
   adaptive-policy, team-coordination, diagnostics, semantic-presentation,
   competitive, and external-host conformance suites.
4. Add adversarial/fuzz/property fixtures, language-neutral golden vectors, and
   an independent second parser/client implementation.
5. Expand OpenAPI/AsyncAPI from route/message indexes into complete request,
   response, security, error, and example documents.
6. Ratify compatibility, extension, deprecation, governance, and signature/key
   rotation policy.

### Phase 2 local vertical slice gaps

1. Build Duel v2 with the selected Wasm/custom-logic tier and a stable
   realtime clock independent of observers.
2. Add replay fork from checkpoint, scenario fixtures, assertions,
   breakpoints, restart, speed control, and chaos/network injection.
3. Add an installed local policy-runner process that claims a seat and survives
   independently of an MCP/model turn.
4. Test reconnect under packet loss, bounded-history replay, slow consumers,
   pressure/coalescing, ticket expiry, and simultaneous takeover races.
5. Validate the stdio MCP server with Codex and another independent MCP host.
6. Add the deferred local quick-start/tutorial docs once the v0alpha1 surface
   settles.

### Phase 3 hosted multiplayer alpha

1. Replace process maps with Aurora/DynamoDB/S3-backed repositories and define
   migrations, retention, encryption, export, and deletion behavior.
2. Connect Lambda control routes to durable services. Hosted match routes
   currently return `503 SERVICE_UNAVAILABLE` by design.
3. Build supervisor/placement services, durable ownership epochs, gateway to
   worker routing, draining, recovery, and multi-task operation.
4. Add ACM TLS, Route 53/CloudFront routing, WAF/rate limits, private subnets or
   reviewed egress, service discovery, and least-privilege task roles.
5. Implement OAuth/OIDC/PKCE, CLI device flow, service identities, federation,
   KMS-backed signing keys, revocation, and scoped hosted MCP authorization.
6. Implement release ingestion, provenance/SBOM/scanning, moderation,
   quarantine/revocation, signed lifecycle webhooks, and registry indexing.
7. Deploy development and staging, then execute load, failure, backup/restore,
   cost, security, and observability gates. No cloud deployment has been run.

### Phase 4 autonomous play depth

1. Compile policies against exact observation/action schemas, prove bounded
   constructs, and enforce CPU/fuel, wall-time, rate, and memory at a hardened
   process or Wasm boundary.
2. Add transactional declared memory updates, deterministic random streams,
   timers/counters, hysteresis operators, richer planners, and game-defined
   safe fallback/forfeit rules.
3. Add slow model/coach nodes with summaries, schema output, deadlines, cost
   budgets, caching, late-result behavior, and recorded immutable inputs.
4. Persist strategy commits, policy memory hashes, team messages, assignments,
   and controller changes into replay so adaptive/team decisions reproduce
   end-to-end.
5. Build experience projections with consent/redaction/provenance and immutable
   candidate/evaluation/promotion/rollback workflows.
6. Build seeded leagues, comparison statistics, unfamiliar-opponent suites,
   exploit/fairness checks, and Agent Garage.
7. Implement Python SDK plus Gymnasium/PettingZoo adapters, A2A invitation, and
   audited human/agent takeover modes.
8. Build Football Arena v2 and Swarm Tactics to prove multi-agent team cadence,
   partial observations, coordination, high spectator fan-out, and pressure.

### Phase 5 Studio and publication

1. Add project/source/revision/build models and ephemeral source, dependency,
   build, and preview sandboxes with no ambient production access.
2. Render compiled code artifacts in the central Studio frame through the
   presentation bridge; the current Test Arena renders only the built-in
   semantic Tic-tac-toe state.
3. Add DOM/SVG and engine semantic adapters, entity/source maps, inspect mode,
   camera/world anchors, and annotation rebind/orphan workflows.
4. Stream live diagnostics rather than returning the complete in-memory list;
   add segmented retention, pagination, redaction, quota, and export.
5. Add scenario authoring, breakpoints, replay fork, run comparison, batch
   matrices, regression suites, and conformance UI.
6. Add creator release review/publish/rollback/deprecate flows and accessible
   generated UI fallback tests.

### Agent Commons workstream

No Agent Commons code was modified in this implementation cycle. The design
document remains the contract for that separate work:

1. App manifest/lifecycle/capability model, durable App Storage, secret slots,
   delegated token exchange, egress policy, jobs/events/webhooks, and a real
   shared `@agent-commons/ui` package.
2. Spaces v2 identity binding, distributed presence/membership, durable
   resources/events, and removal of unauthenticated publication/fallback
   paths.
3. Agent Runtime Adapter, explicit seat delegation/revocation, heartbeat for
   scheduling only, and direct Arcade realtime connections for play.
4. Shared artifact/revision/annotation bridge and embedded Arcade Studio.
5. Common Arcade App installation, OAuth federation, watch-party shell,
   linked game/replay/result artifacts, and create-a-Commons-agent onboarding.

## Recommended next implementation slice

The next slice should stay narrow and close the largest architectural risk:

1. implement the durable match repository and ownership-lease interfaces;
2. run the local gateway and worker as separate processes through a supervisor;
3. recover a killed worker from snapshot/log while fencing the former epoch;
4. persist replay segments and session resume cursors;
5. add a synthetic fixed-tick game and load/chaos harness;
6. use the resulting evidence to finalize the realtime/ownership ADR before
   expanding Studio or adding more game engines.

After that, build Duel v2 on the selected Wasm host. This sequence tests the
hardest claims in the system design before product breadth makes the contracts
expensive to change.

## Commit history for this implementation cycle

- `a08d406` — protocol contract spine
- `515f815` — manifest integrity and realtime tickets
- `154dd4c` — deterministic Tic-tac-toe runtime
- `7a82d95` — local Hono control plane
- `fca812d` — realtime stream and resume
- `fa864dd` — typed control/realtime SDK and CLI
- `6efdd2b` — policies, adaptation, team coordination, and Test Arena
- `5cb14de` — MCP durable agent tools
- `8fdb0f3` — Discover, Play, and Studio Test Arena web views
- `c0e0feb` — executable conformance
- `076ffcb` — ALB/ECS realtime pilot infrastructure
- `690fde9` — immutable release discovery
- `a06525a` — synthesized asset test isolation
