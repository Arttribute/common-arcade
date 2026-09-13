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
type `none`.

## Live listings

| Gateway                | Slug                         | Endpoint                                            | Upstream                                    |
| ---------------------- | ---------------------------- | --------------------------------------------------- | ------------------------------------------- |
| Common Arcade          | `idqnei5alresnbfes5pnwpgv6a` | `https://idqnei5alresnbfes5pnwpgv6a.bazgateway.com` | `https://arcade.agentcommons.io/api/arcade` |
| Common Arcade Payments | `ga4s6ugwlrh57kwd7ejatxx2ni` | `https://ga4s6ugwlrh57kwd7ejatxx2ni.bazgateway.com` | `https://d2scptqzm55h6p.cloudfront.net`     |

MCP servers are `<endpoint>/mcp`. Every method is priced at the default
0.01 USDC per call on Base. Two earlier draft registrations of the same names
(`bnu7qq5vk5c55ij5ws7xsv4riq`, `wivn5yvkm5ax3dzathcwmb77qu`) are unused.

| Recipe                                            | Bindings                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `audit-a-common-arcade-prize-payout-on-arc`       | Payments `getPaidMatch`; Arc `jrra4aibtzhq5fqadqf34iweia` `eth_chainId`, `eth_getTransactionReceipt`, `eth_getLogs` |
| `find-a-common-arcade-game-an-agent-can-play-now` | Common Arcade `getArcadeStatus`, `listGames`, `listGameReleases`, `listPublicMatches`                               |

Both are published at `https://bazantic.com/recipes/<handle>` and
`https://api.bazantic.com/v1/recipes/<handle>`.

The payment service's own x402 route (`POST /v1/analysis/{network}`) is
deliberately not in the gateway spec: it already answers `402`, and a Bazantic
gateway in front of it would double-charge.

## Re-registering a gateway

```bash
npm i -g @bazantic/cli && baz login
baz gateway add \
  --spec-url https://arcade.agentcommons.io/bazantic/common-arcade.openapi.json \
  --endpoint https://arcade.agentcommons.io/api/arcade \
  --name "Common Arcade" --auth-type none --status active --json
baz gateway list --json | jq -r '.listings[] | [.slug, .status, .endpointUrl] | @tsv'
```

After changing a spec, run `baz gateway resync <slug>` so the paid routes match
the tools. Per-method prices can only be changed in the dashboard.

## Updating a recipe

Published recipes are locked. Unpublish, update, test in the dashboard (free),
then publish again:

```bash
baz recipe unpublish <handle> --json
baz recipe update <handle> recipes/<file>.json --json
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
