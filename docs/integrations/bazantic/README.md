# Bazantic integration

Common Arcade is listed on [Bazantic](https://bazantic.com) as two x402/MPP
gateways with generated MCP servers, plus recipes that package Arcade tasks as
single MCP tools. Public docs: `apps/web/content/docs/guides/bazantic.mdx`.

Nothing here changes Arcade's behaviour. The gateways front existing public
read routes; the specs and recipe definitions are static files.

## Pieces

| Piece                                 | Source of truth                                                |
| ------------------------------------- | -------------------------------------------------------------- |
| Common Arcade gateway spec            | `apps/web/public/bazantic/common-arcade.openapi.json`          |
| Common Arcade Payments gateway spec   | `apps/web/public/bazantic/common-arcade-payments.openapi.json` |
| Recipe: audit a prize payout on Arc   | `recipes/audit-arcade-prize-payout.json`                       |
| Recipe: find a game an agent can play | `recipes/find-arcade-game-for-agent.json`                      |
| Recipe comparison protocol            | `eval/README.md`                                               |

Specs are served by the web app at
`https://arcade.agentcommons.io/bazantic/<file>` and fetched server-side by
Bazantic. They cover only credential-free `GET` routes, so gateways use auth
type `x402-mpp` (no upstream credential).

| Gateway                | Upstream (`--endpoint`)                     |
| ---------------------- | ------------------------------------------- |
| Common Arcade          | `https://arcade.agentcommons.io/api/arcade` |
| Common Arcade Payments | `https://d2scptqzm55h6p.cloudfront.net`     |

The payment service's own x402 route (`POST /v1/analysis/{network}`) is
deliberately not in the gateway spec: it already answers `402`, and a Bazantic
gateway in front of it would double-charge.

## Registering or updating a gateway

```bash
npm i -g @bazantic/cli     # 0.8.0+ for recipes
baz login                  # device approval in a browser

baz gateway add \
  --spec-url https://arcade.agentcommons.io/bazantic/common-arcade.openapi.json \
  --endpoint https://arcade.agentcommons.io/api/arcade \
  --name "Common Arcade" --auth-type x402-mpp --status draft --json

baz gateway add \
  --spec-url https://arcade.agentcommons.io/bazantic/common-arcade-payments.openapi.json \
  --endpoint https://d2scptqzm55h6p.cloudfront.net \
  --name "Common Arcade Payments" --auth-type x402-mpp --status draft --json

baz gateway list --json | jq -r '.listings[] | [.slug, .status, .endpointUrl] | @tsv'
```

Then finish in the dashboard (`/gateways`): set per-method prices (default
0.01 USDC), add the product website `https://arcade.agentcommons.io` and docs
URL `https://arcade.agentcommons.io/docs/guides/bazantic`, and activate.
Confirm the MCP server with a free `tools/list` on `<endpointUrl>/mcp`.

## Recipes

Recipe files use placeholder slugs until gateways exist: replace
`ARCADE_GATEWAY_SLUG` and `ARCADE_PAYMENTS_GATEWAY_SLUG` with the 26-character
slugs from `baz gateway list --json`, and confirm tool names with `tools/list`
(they follow the spec `operationId`s). The Arc binding uses the Arc Testnet
gateway `jrra4aibtzhq5fqadqf34iweia`.

```bash
baz recipe create recipes/audit-arcade-prize-payout.json --json
# test the draft in the dashboard with a real match_id (free), then:
baz recipe publish <handle> --json
```

Test inputs with known answers:

- Settled Arc match, expected `VERIFIED`:
  `mat_b0018dc5-6c0b-4978-a914-305de6f20090`. Its onchain receipts show
  prize 9750 and fee 250 atomic USDC.
- Settled Base Sepolia match, expected `UNVERIFIABLE` (wrong network): the
  `matchId` in `packages/contracts/deployments/base-sepolia-hosted.json`.

## Prize tracks this supports

- **Agentify a new API.** Common Arcade and Common Arcade Payments are new
  services. The payout audit recipe combines the new payments service with
  Arc's existing gateway, and neither service can produce the verdict alone.
- **Help an agent use your project.** The game-finder recipe; run the protocol
  in `eval/README.md` and record both outputs.
- **Best recipe using sponsor APIs.** The payout audit recipe uses Arc.
