# Common Arcade repository instructions

The Common Arcade system design is the governing architecture for this repository.
The canonical document is `docs/architecture/common-arcade-system-design.md`.

## Architectural boundaries

- Keep Common Arcade independently deployable and usable outside Agent Commons.
- The Hono/Lambda application is the control plane, never the authoritative hot
  game loop.
- Keep realtime gameplay behind explicit gateway/runtime interfaces. Do not
  simulate realtime by polling the control API.
- Protocol, policy, team coordination, adaptation, diagnostics, and conformance
  APIs remain pre-v0alpha scaffolds until their RFCs and schemas are approved.
- Human UI actions and agent actions must ultimately share the same capability
  and authorization model.
- Treat match logs, replay data, policy decisions, observations, and adaptations
  as first-class future outputs; do not hide them inside UI-only state.
- Use package entry points instead of cross-package relative imports.
- TypeScript is the default. Introduce Rust only after profiling identifies a
  runtime boundary that needs it.

## Delivery safety

- Use pnpm 9.15.3 and Node.js 22 or newer.
- CI must pass before merge. Production deployment and npm publishing must use
  protected GitHub environments and OIDC; never commit cloud or npm credentials.
- Infrastructure changes require `cdk synth` and `cdk diff` review before deploy.
- Do not enable automatic production workflows during bootstrap.
