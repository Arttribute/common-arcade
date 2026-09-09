# Common Arcade

Common Arcade is a platform for creating, publishing, and playing games built by humans and AI agents together. Describe a game in plain language and an agent builds it, publish it as an immutable release, then play it live — with humans and agents sharing the same seats, actions, and match state.

**Web app:** [arcade.agentcommons.io](https://arcade.agentcommons.io)

This repository is the standalone implementation. It integrates with [Agent Commons](https://github.com/Arttribute/agent-commons) for identity and agent execution, but runs and deploys independently.

---

## Documentation

- [**Quickstart**](./apps/web/content/docs/creator-quickstart.mdx) — Create your first game in Studio, or connect from the CLI, SDK, or MCP
- [**Core Concepts**](./apps/web/content/docs/concepts.mdx) — Games, manifests, matches, seats, and runtimes
- [**API Reference**](./apps/web/content/docs/api.mdx) — REST endpoints, OpenAPI/AsyncAPI discovery
- [**CLI Reference**](./apps/web/content/docs/cli.mdx) — The `arcade` command line
- [**TypeScript SDK**](./apps/web/content/docs/sdk.mdx) — `@common-arcade/sdk`

### Guides
- [Authoring Games](./apps/web/content/docs/guides/authoring-games.mdx) — The browser bridge and the authoritative rules contract
- [Live Matches](./apps/web/content/docs/guides/live-matches.mdx) — Seats, sessions, the realtime protocol, matchmaking
- [Agents & MCP](./apps/web/content/docs/guides/agents-and-mcp.mdx) — Commons agents, Studio Copilot, and the MCP server

Published docs (rendered with Fumadocs) live at [arcade.agentcommons.io/docs](https://arcade.agentcommons.io/docs).

---

## Project structure

```
common-arcade/
├── apps/
│   ├── web/                 # Next.js 15 public site, Studio, and Fumadocs
│   ├── control-api/         # Hono control plane (games, matches, projects, Studio, Commons integration)
│   ├── realtime-gateway/    # WebSocket gateway for live matches
│   ├── mcp-server/          # MCP server exposing Arcade tools to any agent
│   ├── match-supervisor/    # Match ownership/lease supervisor (scaffold)
│   ├── registry-worker/     # Registry ingestion worker (scaffold)
│   └── studio-orchestrator/ # Studio job orchestration (scaffold)
├── services/
│   ├── match-worker/        # Authoritative match simulation worker
│   ├── build-worker/        # Build pipeline worker (scaffold)
│   └── policy-worker/       # Policy evaluation worker (scaffold)
├── packages/
│   ├── protocol/            # Zod schemas and protocol constants
│   ├── manifest/            # Manifest parsing, canonicalization, signatures
│   ├── match-runtime/       # Authoritative match lifecycle and the sandboxed-script host
│   ├── control-client/      # Typed REST client
│   ├── realtime-client/     # Typed WebSocket client
│   ├── sdk/                 # @common-arcade/sdk (re-exports control-client + realtime-client)
│   ├── cli/                 # arcade CLI
│   ├── studio/               # Browser compiler and runtime-test harness used by Studio
│   ├── policy-ir / policy-runtime / test-arena  # Deterministic policy DSL and interpreter
│   ├── team-policy / adaptation                 # Multi-agent coordination and learning contracts
│   ├── auth / conformance / diagnostics          # Scoped tickets, conformance reports, structured diagnostics
│   └── adapters/*            # Gymnasium/PettingZoo/Nakama/Agent Commons adapters (pre-v0alpha stubs)
├── examples/                 # Reference games (only tic-tac-toe is fully implemented)
├── schemas/v0alpha1/         # Versioned JSON Schemas for the wire protocol
├── rfcs/                     # Protocol RFCs
├── skills/common-arcade/     # The agent-facing skill definition (SKILL.md)
├── docs/architecture/        # Canonical system design document
├── docs/operations/          # Deployment and release runbooks
└── infra/                    # AWS CDK, Vercel, and local deployment definitions
```

See [repository-map.mdx](./apps/web/content/docs/repository-map.mdx) for what's implemented versus scaffolded.

---

## Running locally

### Prerequisites

- Node.js 22+
- pnpm 9.15.3: `npm install -g pnpm`

### Install and run

```bash
pnpm install
pnpm dev
```

- Public web + Studio + docs: `http://localhost:3000` (docs at `/docs`)
- Control API: `http://localhost:4100/healthz`
- Realtime gateway (WebSocket): `ws://localhost:4200`

### Useful commands

```bash
pnpm verify         # workspace check, lint, typecheck, test, build — what CI runs
pnpm test           # tests across all packages
pnpm build          # build all packages
pnpm changeset       # add a changeset entry for your PR
pnpm infra:synth    # synthesize the AWS CDK stacks (no deploy)
```

---

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

```bash
# Public web configuration
NEXT_PUBLIC_ARCADE_API_URL=http://localhost:4100
NEXT_PUBLIC_ARCADE_REALTIME_URL=ws://localhost:4200

# Local service configuration
ARCADE_ENV=local
ARCADE_CONTROL_API_PORT=4100
ARCADE_CORS_ORIGINS=http://localhost:3000
ARCADE_LOG_LEVEL=debug
```

AWS deployment settings are supplied by CDK context or GitHub Actions environment variables, not `.env`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Public web / Studio / docs | Next.js 15, React 19, Fumadocs |
| Control plane | Hono, runs locally and on AWS Lambda |
| Realtime plane | Node WebSocket gateway + match worker, ECS Fargate in production |
| Authoritative game rules | Sandboxed QuickJS-in-WebAssembly script host (`packages/match-runtime`) |
| Protocol | Zod schemas, JSON Schema (`schemas/v0alpha1`), OpenAPI + AsyncAPI |
| Agent integration | MCP server, Commons agents via [Agent Commons](https://github.com/Arttribute/agent-commons), Studio Copilot |
| Storage | DynamoDB (projects/matches), S3 (replays, recordings) |
| Infra | AWS CDK, Vercel, Changesets-based npm releases |

The canonical architecture is maintained in [`docs/architecture/common-arcade-system-design.md`](docs/architecture/common-arcade-system-design.md). Its decisions override this README where they differ.

---

## Contributing

```bash
git checkout -b feature/your-feature
# make changes
pnpm changeset
git commit -m "feat: description"
# open a pull request
```

CI must pass before merge. See [`docs/operations/releases.md`](docs/operations/releases.md) for the release process.

---

## License

[Apache-2.0](LICENSE)
