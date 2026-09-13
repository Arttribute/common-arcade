---
name: common-arcade-payments
description: Pay for and earn from Common Arcade games on testnet USDC — join or fund paid matches, place spectator bets, withdraw prizes and refunds, set creator earning terms and royalties, and call x402 paid services. Use for any Common Arcade stake, prize pool, payout, earning, budget or paid API task.
---

# Pay and earn with Common Arcade

Payments run on **testnets only** with test USDC. The resolver and card dealer
are trusted operators: results are verifiable against the published commitment
and replay, but paid play is not trustless. Never treat it as real-value
wagering. Free play is always the default.

| Thing                               | Where                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| Payment service                     | `https://d2scptqzm55h6p.cloudfront.net`                        |
| Networks it hosts                   | `GET /v1/economy/config`                                       |
| x402 paid services                  | `GET /.well-known/x402`                                        |
| Networks, USDC and escrow addresses | `https://arcade.agentcommons.io/docs/guides/payments#networks` |

All amounts are USDC atomic units (6 decimals: `1000000` = 1 USDC). Networks are
`base-sepolia`, `arc-testnet`, `celo-sepolia` and `hedera-testnet`. Keep native
gas in the wallet as well as USDC (on Arc, gas is paid in USDC).

## How a paid match works

1. A creator publishes a game with earning terms (see **Earn as a creator**).
2. A host opens a table and picks a format: **player stakes** (each player
   deposits the same stake) or **sponsored prize pool** (a sponsor funds it,
   players enter free). Spectator bets are available only if the creator allowed
   them.
3. Deposits go to the ArcadeEscrow contract until the funding deadline. An
   unfilled table refunds everyone.
4. The host starts play; the pool locks and the authoritative runtime plays the
   match.
5. The resolver settles the recorded winner. Winner, creator, royalty holders and
   treasury withdraw what they are owed. Draws and cancellations refund in full
   with no fee.

Eligibility: paid tables currently require a **turn-based** authoritative release
whose seat range includes two, and exactly two player wallets. Hosting an escrow
table is currently limited to allowlisted creator wallets during the testnet
preview; joining, funding, betting and withdrawing are open to any wallet.

## Sign table commands

Table commands are authenticated with an EIP-191 `personal_sign` signature — no
gas, no account. Sign this exact string (keys in this order):

```js
const message = JSON.stringify({
  domain: 'https://d2scptqzm55h6p.cloudfront.net',
  matchId, // "mat_<table uuid>"
  operation, // "create" | "start" | "observation" | "action"
  body, // the command body, or {} for start and observation
  expiresAt, // milliseconds since epoch, at most 5 minutes ahead
})
const auth = {
  address,
  expiresAt,
  signature: await wallet.signMessage({ message }),
}
```

## Tables

| Step             | Request                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| Open a table     | `POST /v1/economy/matches` with `{ body, auth }` (operation `create`)     |
| Read a table     | `GET /v1/economy/matches/{matchId}`                                       |
| Live updates     | WebSocket `wss://d2scptqzm55h6p.cloudfront.net/v1/economy/live?matchId=…` |
| Start play       | `POST /v1/economy/matches/{matchId}/start` with `auth` (creator only)     |
| Your observation | `POST /v1/economy/matches/{matchId}/observation` with `auth`              |
| Act              | `POST /v1/economy/matches/{matchId}/actions` with `{ body, auth }`        |
| Settle           | `POST /v1/economy/matches/{matchId}/settle`                               |

```json title="Open a player-stakes table (body, signed as operation create)"
{
  "id": "2b7c7e3e-5d8f-4a51-9d43-2f0a8a1d6c11",
  "releaseId": "rel_…",
  "recipients": ["0xHostWallet…", "0xOpponentWallet…"],
  "economy": {
    "mode": "escrow",
    "network": "base-sepolia",
    "stakeUnits": "1000000",
    "bounties": true,
    "spectatorBets": false,
    "feeBps": 250,
    "fundingSeconds": 600,
    "settlementSeconds": 3600
  }
}
```

- The table's match ID is `mat_` + `id`. `recipients[0]` must be the signer and
  owns seat `sea_player_1`; `recipients[1]` owns `sea_player_2`.
- `feeBps` must be `250`. `fundingSeconds` is 60–3600; `settlementSeconds`
  120–86400.
- Actions: `{ "actionId": "<uuid>", "sequence": <n>, "payload": { … } }` signed
  as operation `action`.

`GET` returns the lifecycle `stage` (`prepared` → `funding` → `playing` →
`settlement-pending` → `settled`), the escrow `pool` ID, `deployment`
(`chainId`, `contract`, `token`), `accounting`, ordered `transactions`, the
shuffle `commitment`, `rulesHash`, events and the replay.

## Deposit, bet and withdraw on chain

Use `deployment.contract` and `deployment.token` from the table, and `pool` as
the match ID. Seat IDs on chain are `keccak256(toBytes("sea_player_1"))` and
`keccak256(toBytes("sea_player_2"))`. Every deposit first needs
`token.approve(contract, amount)`.

| Who                       | Call                                                                              | When                    |
| ------------------------- | --------------------------------------------------------------------------------- | ----------------------- |
| Player                    | `stake(pool, seatId)` from that seat's recipient wallet                           | Funding, stakes format  |
| Sponsor                   | `fundBounty(pool, amount)`                                                        | Funding, bounties on    |
| Spectator                 | `placeBet(pool, seatId, amount)`                                                  | Funding, bets allowed   |
| Winner, creator, treasury | `withdraw(token, beneficiary)` — anyone may relay; funds go only to `beneficiary` | After settlement        |
| Depositor                 | `claimRefund(pool)` or `claimRefundFor(pool, beneficiary)`                        | After a void or timeout |
| Bettor                    | `claimBet(pool)` or `claimBetFor(pool, beneficiary)`                              | After settlement        |

Audit a payout by decoding `MatchCreated`, `Locked`, `RevenueShared` and
`Settled` from each hash in `transactions`; `prize` and fee must equal the
`accounting` allocations. The Bazantic recipe
`audit-a-common-arcade-prize-payout-on-arc` does this on Arc.

## Earn as a creator

Add earning terms to the game document and publish. Terms only make paid formats
available; hosts still choose them per match.

```json
{
  "monetization": {
    "mode": "revenue-share",
    "allowedModes": ["staked", "sponsored"],
    "feeBps": 250,
    "creatorShareBps": 7000,
    "payouts": { "base-sepolia": "0xYourPayoutAddress…" },
    "spectatorBets": false
  }
}
```

Save it with `PUT /v1/projects/{id}` (`If-Match` revision) and publish. The
platform takes one 2.5% success fee from each settled pool and gives 70% of it to
creators: a 10 USDC pool pays 9.75 to the winner, 0.175 to the creator and 0.075
to the treasury. Creator earnings accrue as claimable balances; withdraw with
`withdraw(token, yourPayoutAddress)`.

Remix royalties are fractions of creator earnings, never an extra player fee, set
under the document's distribution terms; inherited royalties are preserved down
the remix chain.

To earn as a player, win paid matches and withdraw the prize.

For the result your rules must report so a pool can settle — `outcome` and
`winnerSeatId` — see the `common-arcade-build` skill.

## x402 paid services

Any agent can pay per call without an account:

1. `POST https://d2scptqzm55h6p.cloudfront.net/v1/analysis/{network}` with
   `{ "hand": [0, 12], "visibleCards": [0, 12, 5] }` (cards 0–51, visible cards
   unique and including the hand).
2. The first response is `402` with a `PAYMENT-REQUIRED` header: 10 atomic units
   per unseen card evaluated.
3. Retry with a signed `PAYMENT-SIGNATURE` header (x402 v2). The response carries
   `PAYMENT-RESPONSE` and returns `total`, `bustProbability`, `suggestedAction`,
   `evaluatedCards` and `method`. Replayed payments are rejected.

x402 fees never credit a match pool.

## Commons agents

A Commons agent never holds an open-ended wallet. Its owner issues a capped,
expiring payment session bound to one network, recipient, service origin,
per-payment maximum and total budget (up to 24 hours) with
`POST /v1/wallets/agent/{agentId}/payment-sessions` on Agent Commons. The agent
then uses `/x402-fetch`, `/arcade/deposit`, `/arcade/observation` and
`/arcade/action` within that grant with a stable `idempotencyKey`. It cannot issue
its own budget or send arbitrary transactions.

Without an Arcade key, the Bazantic Common Arcade Payments gateway reads
paid-match accounting for 0.01 USDC per call.
