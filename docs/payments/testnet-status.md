# Testnet deployment status — 2026-09-10

Temporary administrator, deployer, treasury and resolver:
`0xD9303DFc71728f209EF64DD1AD97F5a557AE0Fab`.
The supplied key was checked against this address and used only in process
memory. No key is included in source or deployment records.

| Network              | Status                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Base Sepolia, 84532  | Escrow deployed; canonical USDC and resolver authorized; escrow and x402 public-chain checks passed.                              |
| Arc Testnet, 5042002 | Canonical USDC/RPC checks passed. Wallet has zero native USDC for gas; deployment and payment checks pending funding.             |
| Hedera Testnet, 296  | Canonical USDC/RPC checks passed. Wallet has zero HBAR; deployment, account/token association and payment checks pending funding. |

## Base Sepolia evidence

Escrow: [`0x45699ed8ccda0d7b29008e7af90e287a79de08de`](https://sepolia.basescan.org/address/0x45699ed8ccda0d7b29008e7af90e287a79de08de).
Deployment: [transaction](https://sepolia.basescan.org/tx/0xf89ee0e0926c6ba9fdab5aa2506b49c0600f690af619425aa24798fe2acc270e).

- Stakes, sponsor funding and both spectator outcomes were deposited in canonical USDC.
- [Settlement](https://sepolia.basescan.org/tx/0x3087233d7e9110c8795b60c542b07b1caaf70c77c88be0468017580957930f20) and fee accounting passed.
- [Withdrawal](https://sepolia.basescan.org/tx/0xcc11685188871074d0ed61850e124ab1a41ea9f9072fe06c1d06c3f344ef4b9e) and [cancelled-pool refund](https://sepolia.basescan.org/tx/0x4e696eb07a61de61507988cd4d3b4b16f240e85f078a7e182d97aeaa3ad5a98a) passed.
- Escrow token balance conservation passed, claimable balances were cleared, and token allowance was reset to zero.
- [x402 settlement](https://sepolia.basescan.org/tx/0xcf3f43d7261b3e3a26a270172ea1f076d4bc52fd8ba96493cf04a461f803b322) transferred 480 atomic USDC units. Analysis was delivered after settlement; a replay returned 402. This exercised the actual service/facilitator handlers in-process against public-chain USDC.

Public-chain checks used the same temporary wallet for all participant roles.
Local Anvil and contract tests cover separate recipients and royalty accounting.
These checks do not establish public HTTP hosting, browser wallet integration,
Commons agent grants, or Hedera Blocky402 operation.

Full receipts, compiler settings, smoke checks and the verified service deployment
map are in `packages/contracts/deployments/`.

## Application fix and verification

Enabling **Offer optional paid matches** creates an incomplete payout draft.
Studio previously parsed that draft from `useMemo` and threw an uncaught ZodError.
Readiness now reports validation blockers; the earnings panel prompts for a
complete payout address. Save, compilation and publication retain strict validation.

Passed: 18 Foundry contract tests, 27 Studio tests, 10 payment-service tests
(including Anvil escrow and x402), web/payment-service type checks, and the full
web build. The worker also starts with the verified deployment map and advertises
Base Sepolia through `/v1/economy/config`.

The updated web app and public payment worker have not been deployed. A staging
deployment target and HTTPS payment-worker host are needed to publish the fix and
set `NEXT_PUBLIC_ARCADE_PAYMENTS_URL`, resolver secret injection, creator allowlist,
registry URL and allowed origins. The existing payment Compose configuration binds
only to localhost and requires an HTTPS/WebSocket reverse proxy.

See [deployment runbook](runbook.md) for remaining network deployment commands.
