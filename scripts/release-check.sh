#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Release check requires a clean working tree." >&2
  exit 1
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Release check must run from main." >&2
  exit 1
fi

pnpm check:workspace
pnpm install --frozen-lockfile
pnpm verify
pnpm changeset status

echo "Release candidate checks passed. Nothing was published."
