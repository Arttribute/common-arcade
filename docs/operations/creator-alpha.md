# Hosted creator alpha

## Release boundaries

The web app on Vercel calls the Hono Lambda function URL for durable projects,
revisions, annotations, access keys and agent orchestration. Commons OAuth uses
PKCE, state, encrypted HTTP-only sessions, explicit agent scopes and consent.
External agents use hashed, expiring, revocable Arcade keys. Local bearer IDs
are disabled whenever ARCADE_ENV is set.

The control API delegates online match commands to the existing CloudFront/ALB/
ECS worker. Clients connect directly to its WSS URL. Lambda never runs the online
match loop. A retained, encrypted DynamoDB table with PITR contains creator data
and accepted match replays. Recovery verifies a replay before restoring state,
increases the worker epoch, and commits a conditional version before accepting
new work. Stale workers fail before acknowledging mutations. This pilot retains
one ECS task and uses stop/start deployment; it is not a multi-worker scheduler.

## Deploy

Run `pnpm verify` and `pnpm infra:synth`. Review `pnpm infra:diff --context
stage=development`. Use the manually dispatched `Plan or deploy AWS` workflow
with the protected `development` environment, `operation=deploy`, `confirm=deploy`.
The existing deployment role assumes CDK bootstrap roles with GitHub OIDC.
There is no automatic production deployment enablement.

After deployment set Vercel `ARCADE_API_URL` to the ControlPlane `StudioApiUrl`
output and `NEXT_PUBLIC_ARCADE_API_URL` to the same endpoint for compatibility.
OAuth and session secret values are configured in Vercel, never in source. The
identity bootstrap lives in the Agent Commons repository at
`apps/commons-identity/scripts/bootstrap-arcade-client.ts` and writes client
credentials only to an operator-selected protected file.

The public app is `https://common-arcade.vercel.app`. The custom hostname is
attached in Vercel but needs the GoDaddy DNS record `A arcade 76.76.21.21`.
After DNS verification, set `ARCADE_WEB_URL=https://arcade.agentcommons.io` and
redeploy; both callbacks are registered with Commons identity.

## Verification

Check `/healthz`, `/v1/games`, and `/v1/me`. Anonymous writes and local identity
tokens must return 401. Check cross-owner denial, stale revision conflicts, key
scope denial and immediate revocation. Create/publish a game, run a pinned test,
complete an online match through two SDK clients, export/verify the replay,
and verify the game and match remain available after worker replacement.

## Rollback

Restore the previous Vercel deployment if the web layer fails. ECS has deployment
circuit-breaker rollback. Do not roll the worker back to the unauthenticated
scaffold; pause public access if a rollback predates the identity boundary.
DynamoDB is retained and PITR enabled. No destructive data migration is included.
