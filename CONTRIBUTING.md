# Contributing

Use Node.js 22+ and pnpm 9.15.3. Create a focused branch, keep package boundaries
explicit, and run `pnpm verify` before opening a pull request.

Changes to a public package require `pnpm changeset`. Protocol-facing changes
also require an RFC under `rfcs/` and corresponding fixtures under `schemas/` or
`tests/protocol-vectors/` once those formats are approved.

Do not place secrets in `.env.example`, source files, workflow files, fixtures,
or logs. Use local ignored environment files and protected GitHub environments.
