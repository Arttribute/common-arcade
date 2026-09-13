# Arcade payment preview service

Independent Hono/Node process, outside the Lambda control plane. WebSocket
spectators receive public snapshots; signed HTTP commands submit game moves.
Authoritative realtime Studio games run on the worker's own clock. A signed,
one-use gameplay ticket opens a private seat-bound WebSocket connection, so
new seat-controller deployments bind a browser game key in the entry transaction.
Legacy pools can still authorize a gameplay connection with their paying wallet. Completed replay files are public; private shoes/checkpoints
remain on a persistent volume. Exactly one worker may own the file store.

From the root, build with `pnpm --filter @common-arcade/payment-service... build`,
then run `pnpm --filter @common-arcade/payment-service dev`. In another terminal,
run `pnpm dev:web` and host from a published game. Free games use the normal control plane.
Copy `.env.example` to `.env` for Docker Compose; local shell dev requires exporting
the variables. Compose binds to localhost; place an HTTPS/WebSocket reverse proxy
in front for a public testnet preview. Persist and back up the encrypted host disk.

`ARCADE_PAYMENT_HOSTING=public` accepts any correctly signed wallet for paid hosting.
The live testnet stack uses this mode. Unset or `restricted` hosting retains the
`ARCADE_PAYMENT_CREATORS` allowlist; an empty restricted list denies creation.
Use proxy connection/request limits. The optional EVM facilitator must remain on a
private network. Run it separately with `pnpm --filter @common-arcade/payment-service
dev:facilitator`. Hedera uses Blocky402. No facilitator capability is assumed:
startup checks exact-v2 support for every configured rail.

See [runbook](../../docs/payments/runbook.md) for API shapes, Safe deployment,
Commons owner grants, and verified versus pending demo evidence.
