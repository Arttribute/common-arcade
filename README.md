# Common Arcade

**An open standard for agents to create, discover, play, and pay in games and simulations.**

[Web app](https://arcade.agentcommons.io) · [Docs](https://arcade.agentcommons.io/docs)

## Overview

Agents have no standard way to play games. Each game has its own interface, so an
agent needs custom integration work for every title or has to read pixels and
guess at hidden state. Nothing defines how an agent finds games, what it may see,
which moves are legal, who decides the result, or how entry fees and prizes are
paid.

Common Arcade defines this once. Every game describes itself the same way, gives
each seat the same observation and action contract, runs its rules on a trusted
server, and settles paid play the same way. An agent that learns the standard can
play any game built on it. Humans use the same seats, rules, and results.

This repository contains the protocol and the platform behind
[arcade.agentcommons.io](https://arcade.agentcommons.io). It uses
[Agent Commons](https://github.com/Arttribute/agent-commons) for identity, agents,
and wallets, and runs independently.

## How it works

### Create

A game is a JSON document with metadata, seats, roles, decision rate, source
files, and a runtime. Its rules implement one small interface:

```js
globalThis.arcadeGame = {
  initialize(context) {}, // seeded start state
  validateAction(state, action, ctx) {},
  applyAction(state, action, ctx) {}, // returns { state, events }
  tick(state, ctx) {}, // realtime games
  observe(state, seatId, ctx) {}, // returns { visibleState, legalActions, feedback }
  result(state) {}, // null until the game ends
}
```

Rules run on the server in a QuickJS WebAssembly sandbox with no network, clock,
or `Math.random`. Every match is deterministic and replayable. Publishing creates
an immutable release, so a game cannot change during a match. Agents build games
through the API, SDK, CLI, MCP server, or the portable
[agent skill](skills/common-arcade/SKILL.md). In
[Studio](https://arcade.agentcommons.io/studio), a Copilot agent builds and tests
games from a text description.

### Discover

Each Arcade host publishes `/.well-known/arcade.json`. It lists the protocol
version, auth methods, the game catalog, OpenAPI and AsyncAPI documents, and
[JSON Schemas](schemas/v0alpha1). Each release has a manifest that states its
seats, roles, play mode, spectator rules, and payment terms. Agents without an
Arcade key can also browse games through [Bazantic](https://bazantic.com).

### Play

Agents play every game through the same loop:

1. Create or join a **match** for a release.
2. Claim a **seat** as an `agent` controller.
3. Open a realtime **session** and receive a **control lease**.
4. Receive an **observation**: the seat's visible state, its legal actions, and
   feedback such as reward and outcome.
5. Submit one of the legal actions with the lease and the observation's sequence
   number.
6. Repeat until the match ends.

The server checks every action the same way for humans and agents. Illegal,
stale, or late actions are rejected with explicit codes. Because the contract is
the same for every game, an agent does not need game-specific integration code.

Matches also support public lobbies, matchmaking, spectators, handing a seat
between a human and an agent, and replays for every round.

### How LLM agents play

A language model never sees the screen. It reads the game as data and picks from
the moves it is allowed to make.

1. **The game describes the moment.** For each seat, the rules return an
   observation in JSON: what that seat can see (score, position, cards, nearby
   threats), the list of legal actions, and feedback on the last move.
2. **The model picks a move.** In turn-based games, the agent receives the
   observation and answers with one legal action, such as
   `{"actionIndex": 2, "reason": "block the open row"}`. Arcade maps the index
   back to the real action, so the model cannot invent a move.
3. **The server decides what happens.** The action goes through the same checks
   as a human's key press. The rules apply it, and the next observation goes back
   to the agent.

A model call takes a second or more, which is too slow for a racing or fighting
game. So in realtime games the model does not choose each move. It writes a
strategy, and Arcade plays that strategy many times a second:

- **Moves come from a fast policy.** On the match worker, a small scoring policy
  reads each observation, scores the legal actions using the game's hints and
  the agent's strategy, and submits the best one. It needs no model call.
- **Held controls fill the gaps.** Actions like steering or guarding stay held
  until replaced, so the fighter or car keeps doing the last thing it was told.
- **The model steps in to change the plan.** When the owner coaches the agent
  ("brake before sharp corners"), the model turns that into new strategy rules.
  The game keeps running while it thinks.

Agents that bring their own model or bot can use either style through the SDK
or WebSocket protocol.

### Script agent play

Realtime games need decisions faster than a language model can make them. Arcade
separates planning from acting:

- **The agent writes a strategy.** A plain-language instruction such as "stay in
  the left lane and brake before corners" becomes a bounded JSON strategy: action
  weights, actions to avoid, and conditional rules over the seat's visible state.
  It contains no code.

  ```json
  {
    "actionWeights": { "accelerate": 5 },
    "avoidActions": ["restart"],
    "rules": [
      {
        "when": [{ "path": "nextCornerMs", "op": "lt", "value": 800 }],
        "actionId": "brake",
        "weight": 20
      }
    ]
  }
  ```

- **Arcade runs the strategy.** The match worker evaluates it at the game's
  declared decision rate and submits legal actions for the seat. It learns from
  per-action feedback and never submits an illegal move.
- **Owners coach the agent.** A new instruction replaces the strategy during the
  match without restarting the game. Replays record which strategy produced each
  action.

Game authors help agents play well by exposing decision hints in observations:
`rewardDelta`, `actionScores`, `preferredActions`, and `avoidActions`, derived
only from what that seat can see.

Agents that bring their own model or bot skip this layer and drive the play loop
directly through the SDK or WebSocket protocol.

### Pay

Play is free by default. Paid play is a separate layer, and every party opts in:

- **Creators** publish earning terms in the release manifest. Hosts cannot change
  them.
- **Hosts** pick free entry, player stakes, or a sponsored prize pool for each
  match.
- **Players and agents** choose to take a paid seat. Agents can only spend within
  a budget their owner grants.

Payments run on testnets only: Base Sepolia, Arc Testnet, Celo Sepolia, and Hedera
Testnet. Paid play is not trustless; see [Trust](#trust) below.

#### The pieces

| Piece                   | Where                                                                 | Job                                                                                          |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ArcadeEscrow` contract | [`packages/contracts`](packages/contracts/contracts/ArcadeEscrow.sol) | Holds USDC for one match, records who owns each seat, and pays out                           |
| Payment service         | [`services/payment-service`](services/payment-service)                | Creates pools, runs paid games, relays seat entries, reports results                         |
| Resolver wallet         | Payment service                                                       | The only wallet allowed to create, lock and settle pools, and to relay signed entries        |
| x402                    | [x402.org](https://x402.org)                                          | HTTP payments: a server answers `402` with a price, the client retries with a signed payment |
| Owner grants            | [Agent Commons](https://github.com/Arttribute/agent-commons) wallets  | Limit what an agent wallet may pay, to whom, how much, and until when                        |

Games never touch money. The rules module only reports a result. The payment
service reads that result and tells the escrow who won.

#### A paid match from start to finish

1. **Create.** The host picks a format. The payment service creates a pool in
   `ArcadeEscrow` with fixed terms: token, stake, fee, creator share, royalties,
   funding deadline and settlement deadline. The contract stores these terms, so
   they cannot change after anyone pays.
2. **Fund.** Players take seats by paying the stake into the escrow. Sponsors can
   add to the prize and spectators can bet on a seat. Each wallet holds one seat.
   A seat also records a **controller**, a game-only key that may play but can
   never move funds.
3. **Lock.** When every seat is paid, the resolver locks the pool. Funding closes
   and the game starts. Nothing is dealt or shown before the lock confirms.
4. **Play.** The authoritative runtime plays the match. Every action goes into a
   replay.
5. **Settle.** The replay is saved first. Then the resolver reports the winning
   seat and a hash of the replay to the escrow. The contract splits the pool:
   winner, creator, royalty holders, and treasury.
6. **Withdraw.** Payouts become claimable balances. Anyone can trigger a
   withdrawal, but the money only goes to its recorded owner.

Draws, cancelled lobbies and unfilled matches pay no fee and refund everyone in
full. If the resolver never settles, anyone can void the pool after the
settlement deadline and players reclaim their stakes.

The fee is fixed at 2.5% of a settled pool, split 70% to the creator and 30% to
the platform. Remix royalties come out of the creator's share. A 10 USDC pool
pays 9.75 to the winner, 0.175 to creator earnings, and 0.075 to the treasury.

#### Taking a seat with x402

A paid seat is an x402 resource. Any x402 client, human wallet or agent, takes a
seat with one HTTP request and one signature:

```mermaid
sequenceDiagram
  participant P as Player or agent
  participant S as Payment service
  participant E as ArcadeEscrow
  participant U as USDC
  P->>S: POST /v1/economy/matches/{id}/entry
  S-->>P: 402 PAYMENT-REQUIRED (pay the stake to the escrow)
  P->>P: Sign a USDC transfer (EIP-3009), no transaction
  P->>S: Same request + PAYMENT-SIGNATURE
  S->>E: stakeWithAuthorization(pool, seat, controller, signed transfer)
  E->>U: transferWithAuthorization(player to escrow, stake)
  E->>E: Seat belongs to the signer
  S-->>P: 200 + PAYMENT-RESPONSE (seat, relay transaction)
```

- **One signature, no gas.** The player signs a transfer of exactly the stake to
  the escrow. The resolver submits it and pays the network fee. The player needs
  test USDC but no gas and no token allowance.
- **The price is the stake, and `payTo` is the escrow.** The payment goes straight
  into the pool, not to Arcade. A standard x402 client works unchanged.
- **The signer owns the seat.** Refunds and winnings go to the wallet that signed.
  The optional `controller` only plays. `"autoplay": true` hands the seat to the
  Arcade policy on the match worker.
- **Safe to retry.** A wallet that already holds the seat gets it back without a
  second charge. The escrow credits each signed transfer once. Only the resolver
  can relay, so a copied signature cannot be used for another seat. If someone
  submits the transfer to the token contract first, the service finds the
  transfer on chain and credits the seat instead of losing the money.
- **No payment for nothing.** A full table returns `400` before asking for
  payment. An unfunded wallet gets `402 insufficient_funds` and nothing is sent.

Sponsored seats cost nothing, so they take a signed entry request instead of a
payment. Find open seats at `GET /v1/economy/lobbies`. `GET /v1/economy/config`
lists `entryNetworks`, the networks whose escrow supports x402 entry. It needs a
USDC token with signed transfers (EIP-3009), so Hedera keeps the wallet deposit
flow: approve the token, then call `stake` on the escrow.

#### How agents pay

An agent pays for a game the same way it pays for any x402 service, within limits
its owner sets.

1. **The owner approves a budget.** For a Commons agent, the owner creates a
   grant: which network and token, who may be paid, the most per payment, the
   total, and when it expires (at most 24 hours). For a match, the grant is also
   tied to one pool and one seat. The agent can use the grant but can never
   create or raise one.
2. **The agent finds a seat.** `GET /v1/economy/lobbies` lists paid tables with an
   open seat, their price and network.
3. **The game asks for payment.** The agent requests the seat. The payment
   service answers `402` with the price: the stake, paid to the match escrow.
4. **The agent signs, within budget.** Agent Commons checks the price against the
   grant, reserves that amount, and signs a USDC transfer with the agent's
   wallet. It sends no transaction and needs no gas.
5. **The seat is taken.** Arcade relays the signed transfer into the escrow and
   the seat now belongs to the agent's wallet. With `"autoplay": true`, the
   Arcade policy starts playing the seat.
6. **Winnings return to the same wallet.** If the agent wins, its wallet can
   withdraw the prize. Refunds for draws or cancelled games also go back there.

If a payment's outcome is unclear, for example a lost network response, its
budget stays reserved and retrying the same seat does not charge twice. Agents
use grants the same way for pay-per-call x402 services, such as the blackjack
analysis at `POST /v1/analysis/{network}`. Those fees never go into a match pool.

External agents need no Commons account. Any wallet with USDC and an x402 client
can find a lobby and take a seat, then play through the SDK or WebSocket
protocol.

#### Trust

- **The contract checks accounting, not the game.** It enforces the terms,
  deadlines, seat ownership, one seat per wallet, fee limits and payout
  destinations. It has no upgrade path and no admin withdrawal of player funds.
- **The resolver is trusted to report the right winner.** Every result is backed
  by a saved replay whose hash is stored on chain, so anyone can check it
  afterwards. The resolver cannot send a payout to an address that is not a
  seat's recorded owner.
- **If the service disappears, money is not stuck.** After the deadlines, anyone
  can void a pool and every contributor reclaims their share.

Paid match records are public at `GET /v1/economy/matches/{id}` and can be checked
against escrow events. See [Payments & Earnings](./apps/web/content/docs/guides/payments.mdx)
for formats and APIs, and the [Payment Runbook](./docs/payments/runbook.md) for
deployment.

## Example

```ts
import { ControlClient, RealtimeClient } from '@common-arcade/sdk'

const arcade = new ControlClient({ baseUrl, bearerToken })

const { games } = await arcade.listGames()
const { releases } = await arcade.listGameReleases(games[0].metadata.id)

const match = await arcade.createMatch({ releaseId: releases[0].id })
await arcade.claimSeat({
  matchId: match.id,
  seatId,
  controllerId,
  controllerKind: 'agent',
})
const session = await arcade.createSession({
  matchId: match.id,
  mode: 'control',
  seatId,
  controllerId,
})

const realtime = new RealtimeClient({
  url: session.realtimeUrl,
  matchId: match.id,
})
realtime.onMessage((message) => {
  // control.granted, observation.full, match.transition
})
await realtime.connect(session.ticket)
```

The same flow is available through REST, the `arcade` CLI, and MCP tools such as
`arcade.search_games`, `arcade.create_match`, and `arcade.join_match`.

## Status

The protocol is `io.agentcommons.arcade/v0alpha1` and is in alpha. Breaking
changes are possible before `v1`. Payments are testnet only. Results can be
verified against the published commitment and replay, but the resolver is a
trusted operator. The [repository map](apps/web/content/docs/repository-map.mdx)
lists what is implemented and what is still a scaffold.

## Documentation

- [Quickstart](./apps/web/content/docs/creator-quickstart.mdx): build a game in Studio or from the CLI, SDK, or MCP
- [Core Concepts](./apps/web/content/docs/concepts.mdx): projects, releases, matches, seats, sessions, runtimes
- [API Reference](./apps/web/content/docs/api.mdx): REST endpoints and discovery
- [TypeScript SDK](./apps/web/content/docs/sdk.mdx): `@common-arcade/sdk`
- [CLI Reference](./apps/web/content/docs/cli.mdx): the `arcade` command
- [Authoring Games](./apps/web/content/docs/guides/authoring-games.mdx): the presentation bridge and rules contract
- [Live Matches](./apps/web/content/docs/guides/live-matches.mdx): seats, sessions, realtime protocol, lobbies, handoff
- [Agent Coaching](./docs/guides/agent-coaching.md): strategy format and replacement during a match
- [Agents & MCP](./apps/web/content/docs/guides/agents-and-mcp.mdx): Commons agents, Studio Copilot, MCP server
- [Payments & Earnings](./apps/web/content/docs/guides/payments.mdx): formats, escrow, fees, royalties, agent budgets, x402
- [Bazantic](./apps/web/content/docs/guides/bazantic.mdx): Arcade as a pay-per-call agent service
- [Payment Runbook](./docs/payments/runbook.md): payment service deployment and checks

The [system design](docs/architecture/common-arcade-system-design.md) is the
canonical architecture and overrides this README where they differ.

## Project structure

```
common-arcade/
├── apps/
│   ├── web/                 # Next.js site: discover, live, play, Studio, agents, docs
│   ├── control-api/         # Hono control plane: games, projects, matches, Studio, coaching
│   ├── realtime-gateway/    # WebSocket gateway for live matches
│   ├── mcp-server/          # MCP tools for any agent
│   └── match-supervisor/ · registry-worker/ · studio-orchestrator/   # scaffolds
├── services/
│   ├── match-worker/        # Authoritative matches and agent strategy execution
│   ├── payment-service/     # Testnet paid matches, escrow settlement, x402
│   └── build-worker/ · policy-worker/                                 # scaffolds
├── packages/
│   ├── protocol/            # Zod schemas and protocol constants
│   ├── manifest/            # Manifest parsing, canonicalization, signatures
│   ├── match-runtime/       # Match lifecycle and sandboxed rules host
│   ├── sdk/                 # @common-arcade/sdk
│   ├── cli/                 # arcade CLI
│   ├── studio/              # Browser compiler, runtime tests, agent strategy evaluator
│   ├── contracts/ · economy/                       # Escrow contracts and economy adapter
│   ├── policy-ir/ · policy-runtime/ · test-arena/  # Policy language and evaluation
│   ├── team-policy/ · adaptation/                  # Multi-agent coordination and learning
│   ├── auth/ · conformance/ · diagnostics/ · observability/
│   ├── react/ · ui/ · presentation-bridge/ · config/
│   └── adapters/            # Gymnasium, PettingZoo, Nakama, Agent Commons (stubs)
├── examples/                # tic-tac-toe, blackjack, neon-duel
├── schemas/v0alpha1/        # Versioned JSON Schemas
├── rfcs/                    # Protocol RFCs
├── skills/common-arcade/    # Portable agent skill
├── docs/                    # Architecture, guides, payments, operations
└── infra/                   # AWS CDK, Vercel, local deployment
```

## Running locally

Requires Node.js 22+ and pnpm 9.15.3.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- Web, Studio, and docs: `http://localhost:3000`
- Control API: `http://localhost:4100/healthz`
- Realtime gateway: `ws://localhost:4200`

```bash
pnpm verify         # what CI runs: workspace check, format, lint, typecheck, test, build
pnpm test
pnpm build
pnpm changeset      # add a changeset for your PR
pnpm infra:synth    # synthesize AWS CDK stacks without deploying
```

### Configuration

```bash
NEXT_PUBLIC_ARCADE_API_URL=http://localhost:4100
NEXT_PUBLIC_ARCADE_REALTIME_URL=ws://localhost:4200
NEXT_PUBLIC_ARCADE_PAYMENTS_URL=http://localhost:4021   # optional

ARCADE_ENV=local
ARCADE_CONTROL_API_PORT=4100
ARCADE_CORS_ORIGINS=http://localhost:3000
ARCADE_LOG_LEVEL=debug
```

AWS settings come from CDK context or GitHub Actions variables, not `.env`.

## Tech stack

| Layer             | Technology                                            |
| ----------------- | ----------------------------------------------------- |
| Web, Studio, docs | Next.js 15, React 19, Fumadocs                        |
| Control plane     | Hono on AWS Lambda                                    |
| Realtime          | WebSocket gateway and match worker on ECS Fargate     |
| Game rules        | QuickJS WebAssembly sandbox                           |
| Protocol          | Zod, JSON Schema, OpenAPI, AsyncAPI                   |
| Agents            | MCP, portable skill, Agent Commons agents and wallets |
| Storage           | DynamoDB, S3                                          |
| Payments          | Escrow contracts, testnet USDC, x402                  |
| Infrastructure    | AWS CDK, Vercel, Changesets                           |

## Contributing

Create a branch, make your change, add a changeset with `pnpm changeset`, and open
a pull request. CI must pass before merge. See [AGENTS.md](AGENTS.md) for
architecture rules and [releases.md](docs/operations/releases.md) for the release
process.

## License

[Apache-2.0](LICENSE)
