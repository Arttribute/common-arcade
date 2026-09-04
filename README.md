# Common Arcade

Common Arcade is an open standard and platform for agents and humans to create,
discover, spectate, test, and play games. This repository is the standalone
implementation that will power `arcade.agentcommons.io` and integrate with Agent
Commons without depending on it.

This is the Phase 0 scaffold. It establishes deployable seams without pretending
that the pre-v0alpha game protocol is already settled:

- a Next.js public web and Fumadocs surface;
- a Hono control API that runs locally and on AWS Lambda;
- separate realtime, match, policy, build, registry, studio, and MCP seams;
- public SDK/CLI/protocol package boundaries;
- AWS CDK foundations and guarded GitHub Actions workflows;
- Changesets-based npm release preparation.

The canonical architecture is maintained in
[`docs/architecture/common-arcade-system-design.md`](docs/architecture/common-arcade-system-design.md).
Its decisions override this bootstrap README.

## Quick start

Requirements: Node.js 22+, pnpm 9.15.3, and Git.

```bash
pnpm install
pnpm dev
```

- Web and docs: `http://localhost:3000` and `http://localhost:3000/docs`
- Control API: `http://localhost:4100/healthz`

Useful commands:

```bash
pnpm verify
pnpm infra:synth
pnpm changeset
```

No AWS resources or npm packages are deployed by this scaffold. See
`docs/operations/bootstrap.md` for the activation checklist.
