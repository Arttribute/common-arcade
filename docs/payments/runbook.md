# Testnet payments runbook

## What is implemented

Free play remains the default. Studio authors and agents can publish optional
sponsored or staked matches. One 2.5% success fee is split between creator and
platform (default 70/30). A 10 USDC prize pool pays 9.75 to the winner, 0.175 to
creator earnings and 0.075 to the Safe treasury. Spectator fees apply to the
losing pool only. Draws, cancelled matches and expired unfilled matches refund
contributions. Spectators claim separately from players/sponsors.

Creators may allow free remixes with a 0% new royalty. With royalties enabled,
inherited source shares are preserved; each new royalty applies to the remaining
creator earnings. For example, a 30% source royalty followed by a 20% parent
royalty yields 30% source, 14% parent, 56% current creator. These are fractions of
creator earnings, not extra player fees. The published payout list is bounded to
eight source recipients. Publication rejects royalties it cannot preserve.
Free intermediate releases retain inherited obligations. Commercial remix
permission is separate and cannot be expanded beyond the source license.

The escrow supports any bounded single-winner pool. The initial worker/UI preview
supports two-seat turn-based authoritative Studio releases and blackjack duel.
Other game modes need their runtime admission/settlement adapter before paid play
is available. Unknown outcomes do not authorize arbitrary payout destinations.
Games remain independent of blockchains; only the match economy adapter signs.

## Local verification

Use Node 22 and pnpm 9.15.3. From the Arcade root:

```sh
pnpm install --frozen-lockfile
bash packages/contracts/setup.sh
pnpm --filter @common-arcade/payment-service... build
anvil --port 18545 --silent --block-time 1
```

In another terminal:

```sh
ARCADE_ANVIL_URL=http://127.0.0.1:18545 pnpm --filter @common-arcade/payment-service test
pnpm --filter @common-arcade/contracts test
pnpm --filter @common-arcade/studio test
pnpm verify
pnpm infra:synth
```

The Anvil tests deploy a local-only EIP-3009 USDC fixture, settle a real x402
request with official SDKs, reject replayed authorizations, then exercise stakes,
bounties, spectator bets, live updates, signed moves, replay recovery and payouts.
They do not constitute public testnet evidence.

For the free browser preview run `pnpm --filter @common-arcade/payment-service dev`
and `pnpm dev:web`. Open `/play/blackjack` and share its match URL with a second
wallet/browser. Signatures authenticate moves without a gas transaction.

## Commons agent grants

Apply `apps/commons-api/migrations/versioned/033_wallet_payment_sessions.sql`
using the existing versioned migration runner. Deploy the Commons API before
activating the Arcade grant UI. Arcade forwards the existing owner's Commons
session through its restricted `/api/agent-wallets/*` backend; it never exports
private keys to the browser.

On Arcade `/agents`, or beside a paid table:

1. Choose your Commons agent and existing active EOA wallet.
2. Choose a runtime session, testnet, exact service origin and recipient.
3. Set total USDC and per-payment limits and expiration (up to 24 hours).
4. For a match, bind the grant to its pool, seat and permitted typed deposits.
5. Create the grant, inspect attempts, revoke it when finished, or let the agent
   play. Paid analysis uses a separate x402 service grant.

The budget limits USDC transfers; onchain deposits also require network gas.
Arc uses native USDC for gas, which shares the ERC-20 USDC balance. Keep a gas
reserve in addition to the transfer budget. x402 facilitator gas is separate.
Reserved amounts include confirmed and uncertain attempts; uncertain results do
not release budget automatically. Revocation prevents new authorizations, but a
previously signed authorization can settle until its short expiry. Session IDs
bind owner-issued capabilities; external agent runtimes may use their own IDs.

Agent REST callers use the same API shapes:

```json
{
  "walletId": "existing-wallet-uuid",
  "runtimeSessionId": "agent-runtime-session-id",
  "policy": {
    "network": "eip155:84532",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x1111111111111111111111111111111111111111",
    "origin": "https://payments.example.com",
    "maxPaymentUnits": "1000000"
  },
  "budgetUnits": "5000000",
  "expiresAt": "REPLACE_WITH_FUTURE_ISO_TIME"
}
```

Only an authenticated owner may POST this to
`/v1/wallets/agent/:agentId/payment-sessions`. The named agent can execute an
existing grant, but cannot issue its own budget or bypass it with direct
transfers. Use `paymentSessionId`, `runtimeSessionId` and a stable
`idempotencyKey` for `/x402-fetch` or `/arcade/deposit`. `/arcade/observation`
and `/arcade/action` obtain observations and submit bounded game payloads with
server-held wallet signatures. Agents cannot submit arbitrary transaction data.

In the Commons worktree, the targeted checks are:

```sh
PAYMENT_TEST_DATABASE_URL=postgres://postgres:local-payment-test@127.0.0.1:15432/arcade_payments pnpm --filter commons-api exec jest --runInBand 'wallet/payments|modules/x402/x402.guard.spec.ts'
pnpm --filter commons-api exec tsc --noEmit -p tsconfig.build.json
```

The Postgres test requires an isolated database at localhost:15432. CI provisions
that database; it verifies concurrent reservations cannot overspend a grant.

## Publishing and discovery

Studio's **Game earnings** controls save `document.monetization`; **Publishing &
remixes** controls save licensing and new-remix royalties. Existing project
revision checks and owner publication apply. Agents use `updateProject` in the
control client, the project document API, or `arcade_configure_earnings` in the
Studio copilot. Publishing remains a separate owner-authorized action.

Published manifests carry the optional payment extension and a separate immutable
remix lineage extension. Game detail pages expose the same terms and link to
`/play/paid/:releaseId`. Set `ARCADE_REGISTRY_URL` on the payment worker to the
trusted Arcade control API. Match hosts submit only a release ID and their
payment selection; the worker verifies document/manifest digests and obtains
creator payout terms from that release. Arbitrary caller-provided creator
addresses are not accepted. Completed replays bind the game release and pool.

## Public testnet deployment

The current temporary testnet administrator, treasury and resolver is
`0xD9303DFc71728f209EF64DD1AD97F5a557AE0Fab`, explicitly selected by the owner.
The EOA override applies only to Base Sepolia (84532), Arc Testnet (5042002),
and Hedera Testnet (296). Mainnet remains rejected. The Safe path below remains
the default when `ARCADE_TESTNET_ADMIN` is unset.

### Temporary EOA deployment

Build contracts with `pnpm --filter @common-arcade/contracts build` and payment
dependencies with `pnpm --filter @common-arcade/payment-service... build`.
Inject `ARCADE_DEPLOYER_KEY` into the process from secret storage (0x-prefixed),
and set the public `ARCADE_TESTNET_ADMIN` address above. From the repository root:

```sh
pnpm --filter @common-arcade/payment-service deploy:testnet base-sepolia
pnpm --filter @common-arcade/payment-service deploy:testnet base-sepolia --broadcast
pnpm --filter @common-arcade/payment-service smoke:testnet base-sepolia --broadcast
pnpm --filter @common-arcade/payment-service smoke:x402-testnet base-sepolia --broadcast
```

Use `arc-testnet` or `hedera-testnet` for the other designated networks. The first
command checks the RPC chain, gas balance and canonical token without sending a
transaction. Broadcasting checks the signer, deploys escrow, authorizes canonical
USDC and the resolver, and associates escrow with USDC on Hedera. Fund the
administrator with native gas first; Hedera recipients also require account
activation and USDC association. Public network/token references:
[Arc contracts](https://docs.arc.io/arc/references/contract-addresses) and
[Circle Hedera USDC](https://www.circle.com/multi-chain-usdc/hedera).

The x402 smoke command supports Arc and Base, using the real in-process service
and EVM facilitator handlers with canonical public-chain USDC. Hedera x402 requires
an activated numeric account ID and Blocky402, and is verified separately.
See [current deployment evidence and outstanding work](testnet-status.md).

Deployment receipts are saved under `packages/contracts/deployments/`, including
pending transaction hashes before receipt waits. Rerunning deployment reconciles
those hashes; do not remove a record to retry an uncertain transaction. The smoke
check uses 0.06 test USDC, exercises stakes, bounties, spectator pools, settlement,
withdrawal and refunds, and records every transaction. It returns token principal
to the same test wallet and consumes native gas. On Arc, gas also consumes USDC.
Separate-recipient fee/royalty accounting is exercised by the local tests. Do not
rerun a failed smoke check without inspecting its recorded transactions.

`packages/contracts/deployments/testnet-preview.json` is the public deployment map
for `ARCADE_ESCROW_DEPLOYMENTS`; only verified deployed networks belong in it.
The map uses `treasury`; the legacy `safe` field is still accepted. Inject each
configured chain's `ARCADE_RESOLVER_KEY_<chainId>` separately into the service.
Contract deployment does not deploy the payment worker or rebuild the web app.

### Safe deployment

For each selected testnet, confirm a deployed Safe with at least two owners and
threshold at least two. Supply funded deployer/resolver accounts via an encrypted
keystore and secret injection. Run from `packages/contracts`:

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url base-sepolia --account arcade-testnet --broadcast
```

Set `ARCADE_SAFE_ADDRESS` to the confirmed Safe for that network. The default deploy script path
refuses production chains and an EOA administrator. Save the contract address,
chain ID, compiler settings and deployment transaction in a reviewed deployment
record. Use `safeGovernanceBatch` from `@common-arcade/economy` to export Safe
Transaction Builder JSON authorizing canonical USDC and the resolver. Review
and execute the batch through Safe. The resolver cannot change payout wallets,
fees or rules of an existing match. Safe controls allowlists and pause; existing
withdrawals/refunds remain available during a pause.

On Hedera, activate ECDSA accounts and associate USDC (0.0.429274) with every
recipient, including the Safe, escrow, creator and royalty recipients. The batch
includes escrow/Safe association. Verify mirror-node association afterwards:
Safe does not interpret HTS numeric response codes. Never assume that Safe's
hosted transaction service is available on every target chain.

Configure `ARCADE_ESCROW_DEPLOYMENTS` as a JSON map, for example:

```json
{
  "base-sepolia": {
    "contract": "CONFIRMED_ESCROW_ADDRESS",
    "safe": "CONFIRMED_SAFE_ADDRESS",
    "rpcUrl": "https://sepolia.base.org"
  }
}
```

Set `ARCADE_RESOLVER_KEY_84532` (or `_5042002`, `_296`), HTTPS
`ARCADE_PAYMENT_DOMAIN`, allowed `ARCADE_PAYMENT_ORIGINS`, and
`ARCADE_PAYMENT_CREATORS` (comma-separated preview creator EOAs). An empty creator
list denies paid creation. The service is one worker with a durable private
volume; do not horizontally scale its file store or share resolver keys between
workers. Use an encrypted disk, backups, HTTPS/WebSocket reverse proxy and
connection/request limits. No private checkpoint, seed or key goes into public
logs. Use the included Dockerfile/Compose for this explicit preview deployment.
The optional EVM facilitator stays on a private network.

Configure x402 rails separately:

```json
[
  {
    "network": "hedera-testnet",
    "payTo": "YOUR_ACTIVATED_ASSOCIATED_ACCOUNT_ID",
    "facilitatorUrl": "https://api.testnet.blocky402.com"
  }
]
```

The worker checks exact-v2 support before advertising a rail. Blocky402's observed
supported list includes native Hedera testnet, not Arc or Base. For those use the
included private EVM facilitator or another explicitly compatible service.
See [verified network sources and bounty requirements](integration-plan.md).

Set `NEXT_PUBLIC_ARCADE_PAYMENTS_URL` before building the web app and
`AGENT_COMMONS_API_URL` for its wallet proxy. Do not enable a rail until its
contract, administrator, canonical token, resolver, faucet funding and facilitator checks
pass. Contracts/accounting tests do not prove a public chain integration.

## Operational limits and remaining launch evidence

This is a testnet trusted-dealer/resolver preview. A commitment proves the dealer
kept its chosen shoe; it does not prove unbiased randomness or prevent the dealer
knowing hidden cards. Abandoned-game timeout refunds favor recoverability and can
be abused by a losing player. Public competitive money requires a reviewed
randomness and inactivity/dispute policy. Contract ownership is the explicitly selected temporary EOA for this testnet preview; agent
wallets remain existing encrypted EOAs, not Safe session-key wallets.

Uncertain transaction attempts deliberately consume budget until reviewed. Check
receipts and onchain nonces before issuing replacement grants. There is no admin
sweep, arbitrary payout endpoint or automatic retry that spends again.

Before bounty submission retain actual Blocky402-paid request evidence, Arc/Base
USDC match and payout transaction links, Safe governance transactions, a public
repository, setup docs and the required short demo. Circle Agent Stack-specific
eligibility requires actual Agent Stack usage. Local tests alone do not establish
that requirement or bounty eligibility. Mainnet activation is not included.

Active tables pin their executable release digest before funding. Drain active matches before changing the game/runtime implementation. A worker with a different blackjack release refuses to start or resume an older table; restore the matching image or let participants claim timeout refunds. Public match views retain the original digest. Published Studio documents are stored with the match, but the runtime compiler still needs compatible deployment versions.
