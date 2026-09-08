# x402 coaching service

A live, x402-gated pay-per-call service on Hedera. It sells move/strategy
coaching for an in-progress Common Arcade match, priced by requested analysis
depth (metered, not a flat per-call charge), and settles in HBAR on Hedera
through the **Blocky402** facilitator.

This service is intentionally standalone — it does not depend on any other
Common Arcade package — so it can be run, deployed, and demoed on its own.

## Architecture

```
 agent / MCP tool ──POST /v1/coach──▶ x402-inference-service ──verify/settle──▶ Blocky402 facilitator ──▶ Hedera testnet
        │                                    │
        │◀── 402 Payment Required (first) ───┤
        │──── retry with X-PAYMENT header ───▶│
        │◀────── 200 + coaching advice ───────┤
```

- **Framework**: [Hono](https://hono.dev), run via `@hono/node-server`.
- **Payment protocol**: [x402](https://x402.org) v2, via `@x402/core` +
  `@x402/hono` (middleware) + `@x402/hedera` (Hedera's "exact" scheme —
  a native Hedera transfer transaction, not an EVM EIP-3009 signature).
- **Facilitator**: [Blocky402](https://blocky402.com), a non-custodial x402
  facilitator with Hedera support. It verifies the payer's signed transfer
  transaction and submits it to the network (paying the network fee itself);
  it can never move funds without the payer's own signed authorization.
- **Asset**: native HBAR (`asset: "0.0.0"`), amount in tinybars.

## Payment flow

1. A client `POST`s `/v1/coach` with `{ position, depth }` and no payment.
2. The x402 middleware returns `402 Payment Required` with an `accepts` entry
   describing the Hedera payment option: network (`hedera:testnet` or
   `hedera:mainnet`), asset (`0.0.0` / HBAR), amount (tinybars — computed
   per-request from `depth`, see `priceForRequest` in `src/app.ts`), and the
   `payTo` Hedera account id.
3. The client's wallet (see the Agent Commons wallet's `x402Fetch` /
   `x402FetchHedera` in `agent-commons/apps/commons-api/src/wallet/wallet.service.ts`,
   or any `@x402/hedera` client) builds and signs a Hedera transfer
   transaction and retries the request with an `X-PAYMENT` header carrying
   the signed payload.
4. This service verifies the payload with Blocky402, and on success settles
   it (Blocky402 submits the transaction to Hedera) and returns `200` with
   the coaching response.

Price scales with `depth` (1–5): each additional unit of requested analysis
depth costs more HBAR (`X402_COACH_TINYBARS_PER_DEPTH` per unit, default
0.05 HBAR), rather than charging a flat fee regardless of what was asked for.

## Setup

```bash
pnpm install
```

Environment variables:

| Variable                        | Required | Description                                                          |
| ------------------------------- | -------- | -------------------------------------------------------------------- |
| `X402_HEDERA_PAYEE_ACCOUNT_ID`  | yes      | Hedera account id (`0.0.x`) that receives payment.                   |
| `X402_FACILITATOR_URL_HEDERA`   | yes      | Blocky402 facilitator base URL.                                      |
| `HEDERA_NETWORK`                | no       | `testnet` (default) or `mainnet`.                                    |
| `X402_COACH_TINYBARS_PER_DEPTH` | no       | Tinybars charged per unit of `depth`. Default `5000000` (0.05 HBAR). |
| `X402_INFERENCE_SERVICE_PORT`   | no       | Port for `pnpm dev` / `pnpm start`. Default `4300`.                  |

```bash
pnpm --filter @common-arcade/x402-inference-service dev
```

## Try it

```bash
# Unauthenticated — expect 402 with a hedera:testnet payment requirement
curl -i -X POST http://localhost:4300/v1/coach \
  -H 'content-type: application/json' \
  -d '{"position": "board state here", "depth": 3}'

# Paid — via a Hedera-capable x402 client (Agent Commons wallet, or any
# @x402/hedera client). See wallet.service.ts's x402FetchHedera for a full
# example, or the `arcade.pay_for_coaching` MCP tool in apps/mcp-server.
```

A successful paid call returns:

```json
{
  "suggestedMove": "advance-center",
  "confidence": 0.8,
  "depth": 3,
  "rationale": "Heuristic scan at depth 3 favors \"advance-center\" (confidence 0.80)."
}
```

## Testing

```bash
pnpm --filter @common-arcade/x402-inference-service test
```

Unit tests cover configuration validation and the unauthenticated health
check. They do not exercise a live payment (that requires a funded Hedera
testnet account and a reachable Blocky402 facilitator) — see the repo root
plan for the manual end-to-end verification steps.
