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

The public app is `https://arcade.agentcommons.io`, with
`https://common-arcade.vercel.app` retained as a Vercel alias. DNS uses
`A arcade 76.76.21.21`. Set `ARCADE_WEB_URL=https://arcade.agentcommons.io`;
both callbacks are registered with Commons identity. OAuth grants must include
`agents:create` as well as read, write and run scopes. Agent execution uses the
signed-in account's Commons credits.

GitHub's immutable OIDC subject for this repository is
`repo:Arttribute@134047006/common-arcade@1356998598:environment:development`.
The AWS deployment role must trust that exact subject and `sts.amazonaws.com`
audience. A name-only trust will reject newly created GitHub repositories.

## Downloadable tools

`node scripts/bundle-tools.mjs 0.1.0-alpha.1` builds installable SDK and CLI
tarballs in `dist/releases`. It includes workspace code and SDK declarations;
only the public Zod package remains as a declaration dependency. Verify these
in a fresh installation before attaching them to a GitHub release. This is a
usable download channel while initial npm package registration and protected
OIDC publishing are being configured; it does not claim an npm publication.

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

## Browser projects and recordings

The browser compiler supports HTML/CSS/JS/TS/JSX/TSX, local imports and declared
exact-version npm packages. Runtime dependency downloads use esm.sh. This does
not grant generated code access to the application origin: previews run in
opaque sandboxed frames. Recordings play in a separate data-URL origin.

Set `ARCADE_RECORDINGS_BUCKET` on the control API. For self-hosted storage,
also set `ARCADE_OBJECT_STORE_ENDPOINT`, `AWS_REGION`, and the standard AWS
credential variables for your S3-compatible provider. Allow GET and POST CORS
from your frontend origin; signed POST policies constrain key, size and type.
The deployed AWS bucket has encryption, retention, blocked public access and
an incomplete-multipart cleanup rule. Spectator access is mediated by short-lived
signed downloads, and new recordings are private unless explicitly shared.

Downloads use the portable `commons.recording.v1` JSON format, optionally gzip
compressed. No storage subscription is required for local recording playback.
