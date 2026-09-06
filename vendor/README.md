# Shared Commons UI

`agent-commons-ui-0.2.5.tgz` is packed from `packages/ui` in
Arttribute/agent-commons at commit `b389426`. It is the same shared composer,
canvas controls, geometry and recording runtime used by Commons Studio.

Build recorder assets with `pnpm --filter @agent-commons/ui build`, increment
the package version, and pack with `pnpm pack` from that package. Update the
Arcade file dependency and lockfile together. Never edit the packed code here.
