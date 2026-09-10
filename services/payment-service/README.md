# Arcade payment and blackjack preview service

Independent Hono/Node process, outside the Lambda control plane. WebSocket
spectators receive authoritative snapshots; signed HTTP commands submit
turn-based moves. Completed replay files are public; private shoes/checkpoints
remain on a persistent volume. Exactly one worker may own the file store.

From the root, build with `pnpm --filter @common-arcade/payment-service... build`,
then run `pnpm --filter @common-arcade/payment-service dev`. In another terminal,
run `pnpm dev:web` and open `/play/blackjack`. No configured chains means free mode.
Copy `.env.example` to `.env` for Docker Compose; local shell dev requires exporting
the variables. Compose binds to localhost; place an HTTPS/WebSocket reverse proxy
in front for a public testnet preview. Persist and back up the encrypted host disk.

`ARCADE_PAYMENT_CREATORS` restricts who can spend resolver gas creating paid pools.
Use proxy connection/request limits. The optional EVM facilitator must remain on a
private network. Run it separately with `pnpm --filter @common-arcade/payment-service
dev:facilitator`. Hedera uses Blocky402. No facilitator capability is assumed:
startup checks exact-v2 support for every configured rail.

See [runbook](../../docs/payments/runbook.md) for API shapes, Safe deployment,
Commons owner grants, and verified versus pending demo evidence.
