#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_TAG="${1:-latest}"

if [[ "${CI:-}" != "true" && "${COMMON_ARCADE_ALLOW_LOCAL_PUBLISH:-}" != "1" ]]; then
  echo "Refusing local publish. Use the protected GitHub workflow or set COMMON_ARCADE_ALLOW_LOCAL_PUBLISH=1 explicitly." >&2
  exit 1
fi

case "$DIST_TAG" in
  latest|staging|next) ;;
  *) echo "Unsupported npm dist-tag: $DIST_TAG" >&2; exit 1 ;;
esac

cd "$REPO_ROOT"
pnpm check:workspace
pnpm build
pnpm changeset publish --tag "$DIST_TAG"
