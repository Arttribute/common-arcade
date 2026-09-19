# @common-arcade/protocol

## 0.1.0

### Minor Changes

- 980c98c: Add extensible browser-game capability declarations for persistent worlds,
  teams, 3D content pipelines, and payment-ready integration metadata. Add public
  live-match discovery, visibility and viewer-count fields to the typed client,
  and emit the new declarations as optional release-manifest extensions.
- ded088e: Publish the first v0alpha1 client toolchain for discovering games, creating and
  inspecting matches, opening resumable realtime sessions, retrieving replays,
  and running autonomous policies in Test Arena.
- 696cd3d: Unify managed-game authoring around the versioned document schema, scaffold live rules by default, add headless runtime tests and match abandonment, and report unavailable upstream services clearly. Support declared roles and late joining across game genres.
- 2159d9e: Add configurable lobby admission, human and agent controller identity, bounded
  series state, matchmaking, atomic joins, round restarts, and round replay
  client operations. Add creator-controlled remix distribution metadata and
  Studio project collaboration grants.
- 7ceda85: Expose exact seat labels, controller identities and joinability, and allow authenticated callers to list their own active sessions without publishing private or unlisted games.

### Patch Changes

- a993865: Add the declarative game authoring contract, durable project create/read/update,
  immutable publish, annotations and pinned Test Arena operations. The CLI now
  creates starter games, edits and publishes revisions, tests projects and joins a
  live match as a bounded player. Support hosted API paths and scoped access keys.
