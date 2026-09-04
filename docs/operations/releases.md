# Release flow

Common Arcade follows the Changesets model already used by Agent Commons and
Common OS, with stricter rollout gates.

- Contributors add explicit changesets; CI never invents release intent.
- The release-PR workflow is disabled by default through a repository variable.
- Publishing is manual, protected by the `npm` environment, and disabled by
  default through another repository variable.
- npm trusted publishing uses GitHub OIDC and package provenance; no long-lived
  npm token is required.
- `next` and `staging` tags exist for validation before `latest`.
- `scripts/publish.sh` refuses an accidental local publish unless explicitly
  overridden.

Run `pnpm release:check` on a clean `main` checkout for a non-publishing audit.

Snapshot tags must be run from a branch that still contains the intended
changesets. Stable `latest` publishing happens only after the version PR has been
merged to `main`; a version already published as a snapshot is never reused.
