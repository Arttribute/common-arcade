# Spec: Arc-powered Agentic Match Economy for Common Arcade

Target: ETHOnline 2026, Circle Arc track.

## Why Arc

The target bounty is **"Best Agentic Economy Application with Circle Agent Stack"** ($1,667 of Arc's $10,000 pool), with a possible additional shot at **"Launch on Arc Testnet & Push to Mainnet"** ($3,500). It's the best fit in the full ETHOnline 2026 bounty list because:

- The bounty wants "agents with clear decision logic tied to real signals" and "autonomous spending/settlement in USDC." Common Arcade's core thesis — Commons agents that autonomously author and play games — already produces exactly that signal (a match result). We're not inventing a use case, we're wiring money onto one that already exists and is actively worked on (recent commits: live lobbies, adaptive playtests).
- Common Arcade currently has **zero** blockchain code. Arc gives the smallest path to real, judge-visible integration because USDC is the *native gas token* on Arc — no ERC20 approve/transferFrom plumbing, just plain value transfers, which keeps the new contract and code small under time pressure.
- agent-commons already has real, working wallet infrastructure (viem EOA keys, AES-256-GCM encrypted at rest, an x402 payment client) on Base Sepolia. Arc is EVM and a first-class viem chain, and the `agent_wallet` table already has a per-row `chainId` column sitting unused — so this isn't new wallet infra, it's turning on a dormant column plus a chain-resolution refactor. That's a materially smaller lift than building agent wallets from scratch.
- Circle's Agent Stack pattern (shell tool + CLI + approval gate before any USDC-moving command) maps almost exactly onto tool access Commons agents already have in Arcade (`runComputerCommand`, `readComputerFile`, `writeComputerFiles` via `startAgentComputer`). We install the Circle CLI into a sandbox that already exists rather than building new agent tooling.
- It sets up a cheap second bounty (Ledger — swap the approval-gate confirmation for a Ledger Key Ring signature, same code path) and a cheap third (Bazantic/Hedera x402 — agent-commons already has a working x402 client, `x402Fetch`, so gating an Arcade route behind x402 is mostly reuse, not new protocol work).

## Bounty facts (Arc / Circle track, $10,000 pool)

| Prize | Amount | Notes |
|---|---|---|
| Best DeFi/Onchain Finance Application | $1,667 | Not our primary target |
| **Best Agentic Economy Application with Circle Agent Stack** | **$1,667** | **Primary target** — agents transacting autonomously on Arc using USDC, via Agent Stack |
| Best DeFi or Agentic Application (Continuity track only) | $1,666 | Not applicable — we're not a continuity entrant |
| Launch on Arc Testnet & Push to Mainnet | $3,500 (1st $2,500 / 2nd $1,000) | See below |
| Launch on Arc Testnet & Push to Mainnet (Continuity) | $1,500 | Not applicable |

Universal submission requirements: working frontend + backend, an architecture diagram, a video demo, public GitHub repo, and effective use of Circle's developer tools.

## What is the mainnet-push prize?

**"Launch on Arc Testnet & Push to Mainnet"** ($3,500 total, $2,500 for 1st / $1,000 for 2nd) is a separate, stackable prize from the main "Agentic Economy" one. It rewards projects that go beyond a testnet demo:

- Integrate Arc into a commerce, fintech, wallet, DeFi, or AI-agent product with a **production-ready deployment**, not just a testnet proof of concept.
- Explicit deadline: **projects must be deployed, or deployment-ready, on Arc mainnet by September 30**.
- Judged as an add-on to the core submission — you build the same agentic-economy feature, then additionally show it's ready to run for real (real USDC, real settlement, no testnet-only shortcuts left in).

Practically: our escrow contract and control-api settlement flow should be written so a mainnet deploy is a config change (RPC URL, chain ID, contract redeploy) rather than a rewrite — e.g. no testnet-only assumptions baked into the contract or backend. Whether we actually *do* the mainnet push depends on time remaining after the core testnet submission is solid; it's an opportunistic stretch goal, not a requirement for the primary $1,667 prize.

## What gets touched

### agent-commons (`apps/commons-api/src/wallet/`) — additive only, Base Sepolia behavior untouched

- New Arc Testnet chain resolution (either a small `lib/arcTestnet.ts` mirroring `lib/baseSepolia.ts`, or import viem's built-in `arcTestnet` from `viem/chains` directly).
- `WalletService` refactor at ~4 call sites (`publicClient` field, `getBalance`, `transfer`, `x402Fetch`) to resolve chain/USDC-address from `chainId` instead of the hardcoded `baseSepolia` constant.
- Likely a second `agent_wallet` row per agent for `chainId: "5042002"` (same underlying key — no new keygen/encryption work needed, since the stored secret is already chain-agnostic).
- No schema migration needed — the `chainId` column already exists on `agent_wallet`.

### common-arcade — the actual game-economy feature, entirely new

- `contracts/arc/ArcadeEscrow.sol` — minimal native-value contract: `stake(matchId) payable`, `settle(matchId, winner)` (restricted to a server-held settler key), `refund(matchId)`. Deployed to Arc Testnet via Foundry/Hardhat, verified on `testnet.arcscan.app`.
- RFC-0001's `economy` manifest field goes from metadata-only to real (`entryFeeUsdc`, `escrowContractAddress`, `chainId`).
- New `apps/control-api` routes: stake-intent (returns unsigned calldata — Arcade never custodies keys, consistent with the existing "no wallet authority in browser/server code" rule already in the Studio skill), a watcher confirming stake landed before granting a seat, and a settlement hook fired off match completion in `match-runtime`.
- New skill (sibling to the existing `build-common-arcade-games` skill) teaching a Commons agent: check balance → decide to stake → run the Circle CLI (approval-gated) → call the existing `arcade.join_match` MCP tool → play.
- Optional stretch: an `@circle-fin/app-kit` bridge step, moving an agent's existing Base Sepolia USDC onto Arc on-camera during the demo, to visibly tie the submission back to agent-commons' real wallet infra rather than a faucet-only toy.

### Explicitly out of scope

Hosted multiplayer (`match-supervisor`, `registry-worker` — still stubs), building out any of the other example games (`duel`, `football-arena`, `swarm-tactics` — currently README-only placeholders), any bounty tracks beyond Arc/Ledger/x402.

Note: the economy feature itself (manifest `economy` field, stake-intent/settle routes, escrow contract) is built generically at the match/manifest layer, not hardcoded to any one game. Tic-tac-toe is used only as the **demo** because it's the sole example that's fully working end-to-end today; any game whose manifest opts into `economy` gets staking/settlement automatically, including games added later.

## Build order

1. Confirm Arc testnet access hands-on: faucet funds, RPC reachable, clone `circlefin/agent-stack-starter-kits` and read the actual CLI command surface (not yet verified beyond a README summary).
2. agent-commons: chain-resolution refactor in `WalletService`, second wallet row per agent for Arc, verify balance/transfer work against Arc testnet.
3. common-arcade: write + deploy `ArcadeEscrow.sol`, verify on arcscan.
4. common-arcade: wire manifest `economy` field + stake-intent/watch/settle routes in control-api, hook settlement into match-runtime's completion event.
5. common-arcade: new economy skill + Circle CLI installed in the agent sandbox.
6. End-to-end demo: two Commons agents stake, play tic-tac-toe, escrow settles the winner on Arc, show the explorer tx.
7. Ledger swap-in on the approval gate (second bounty) if time allows.
8. x402-gate one existing control-api route reusing agent-commons' `x402Fetch` (third bounty) if time allows.
9. Architecture diagram + video for submission.

## Open decisions still pending

- Wallet-row model: one `agent_wallet` row per chain (leaning yes — fits existing per-wallet balance/primary API shape) vs. resolving chain dynamically per request off a single row.
- Exact Circle CLI commands (`circle-tools` package) — needs a direct read of the starter kit source, not just its README.
- Whether to attempt the mainnet-push prize at all, given its September 30 deadline and separate judging bar.

## Reference: Arc Testnet network details

- Chain ID: `5042002`
- Native gas token: USDC (18 decimals)
- RPC: `https://rpc.testnet.arc.io` (also Blockdaemon/dRPC/QuickNode mirrors)
- Block explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`
- viem: built-in as `arcTestnet` from `viem/chains`
- App Kits: `@circle-fin/app-kit` + `@circle-fin/adapter-viem-v2` (bridge/swap/send/unified-balance across Viem, Ethers, Solana, Circle Wallets)
- Agent Stack starter kits: `github.com/circlefin/agent-stack-starter-kits` (LangChain, Claude Agent SDK, OpenAI Agents SDK, Vercel AI SDK, Google ADK, Mastra — shell/file/grep tool pattern with an approval gate before any USDC-moving CLI command)
