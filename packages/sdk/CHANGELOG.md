# @common-arcade/sdk

## 0.1.0

### Minor Changes

- ded088e: Publish the first v0alpha1 client toolchain for discovering games, creating and
  inspecting matches, opening resumable realtime sessions, retrieving replays,
  and running autonomous policies in Test Arena.
- 01f325c: Export the canonical browser and game document schemas for external creator validation.

### Patch Changes

- 696cd3d: Unify managed-game authoring around the versioned document schema, scaffold live rules by default, add headless runtime tests and match abandonment, and report unavailable upstream services clearly. Support declared roles and late joining across game genres.
- a993865: Add the declarative game authoring contract, durable project create/read/update,
  immutable publish, annotations and pinned Test Arena operations. The CLI now
  creates starter games, edits and publishes revisions, tests projects and joins a
  live match as a bounded player. Support hosted API paths and scoped access keys.
- Updated dependencies [980c98c]
- Updated dependencies [ded088e]
- Updated dependencies [696cd3d]
- Updated dependencies [2159d9e]
- Updated dependencies [7ceda85]
- Updated dependencies [a993865]
  - @common-arcade/protocol@0.1.0
  - @common-arcade/control-client@0.1.0
  - @common-arcade/realtime-client@0.1.0
