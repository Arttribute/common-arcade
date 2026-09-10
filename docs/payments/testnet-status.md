# Testnet deployment status — 2026-09-10

Temporary administrator, deployer, treasury and resolver:
`0xD9303DFc71728f209EF64DD1AD97F5a557AE0Fab`.
The supplied key was checked against this address and used only in process
memory. No key is included in source or deployment records.

| Network              | Status                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Base Sepolia, 84532  | Escrow deployed; canonical USDC and resolver authorized; escrow and x402 public-chain checks passed.                    |
| Arc Testnet, 5042002 | Escrow deployed; USDC and resolver authorized; full escrow and x402 public-chain checks passed.                         |
| Hedera Testnet, 296  | Escrow deployed; USDC/resolver authorized; escrow and treasury associated with USDC. Payment checks await USDC funding. |

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

## Arc and Hedera deployment evidence

Arc escrow: [`0xbe529edf75ebeb609dcf7ab26783dc558b735851`](https://testnet.arcscan.app/address/0xbe529edf75ebeb609dcf7ab26783dc558b735851).
[Deployment](https://testnet.arcscan.app/tx/0x88c69c690e1a69787381dfc8629618bb5784ef1ddd64cd32b9feff5166699ac2),
[settlement](https://testnet.arcscan.app/tx/0x8e8367aeded21cf40d69aa22b85e0f95d305e0d111971e8c1966609d153e45b4),
[refund](https://testnet.arcscan.app/tx/0x084bf44eb801df7ebe59d6c3f258ccb834ca92ed2934ab7e80878601127827a0), and
[x402 settlement](https://testnet.arcscan.app/tx/0x6bdb793793f4a094e04b74128f35f61385d33bc0faf9c7bb61194048d528b3a2)
are confirmed. The same escrow conservation, allowance cleanup and x402 replay
checks used on Base passed on Arc.

Hedera escrow: [`0xbe529edf75ebeb609dcf7ab26783dc558b735851`](https://hashscan.io/testnet/contract/0xbe529edf75ebeb609dcf7ab26783dc558b735851).
Deployment transaction: `0xc828ea4c1421d9fe2c0360da880a9d1444feecfedbef96a2d2907a032d637e61`.
Escrow token association: `0x6daa4fd1a025e23e88f620d399eb2fd060aad5098d076035b32221667470936e`.
Treasury token association: `0xeb1e09ced14ae18875af161da7d3407cf8084dd79af6aa38f3b18a5a494c8521`.
Mirror-node records confirm both associations with canonical USDC `0.0.429274`.
The treasury wallet is active as account **0.0.10456930**, but its USDC balance
is zero. Its payment and refund checks remain pending token funding. Blocky402
advertises Hedera testnet exact-v2 support; an actual paid request is still pending.

The Arc and Hedera escrow addresses coincide because the same deployer used the
same nonce on two independent networks. Each deployment was checked against its
own chain ID and has separate transaction receipts.

## Application fix and verification

Enabling **Offer optional paid matches** creates an incomplete payout draft.
Studio previously parsed that draft from `useMemo` and threw an uncaught ZodError.
Readiness now reports validation blockers; the earnings panel prompts for a
complete payout address. Save, compilation and publication retain strict validation.

Passed: 18 Foundry contract tests, 27 Studio tests, 10 payment-service tests
(including Anvil escrow and x402), web/payment-service type checks, and the full
web build. The worker also starts with the verified deployment map and advertises
Base Sepolia through `/v1/economy/config`.

The UI fix is merged in [PR #31](https://github.com/Arttribute/common-arcade/pull/31)
and live at https://arcade.agentcommons.io from main commit `febd489`. Chrome
reproduced the original crash before rollout, then verified enabling payments,
editing incomplete/complete payout addresses and disabling payments without
a page error after rollout. API responses used isolated fixtures; no production
data was written.

Public payment-worker hosting is still pending. Its HTTPS host is needed to set `NEXT_PUBLIC_ARCADE_PAYMENTS_URL`, resolver secret injection, creator allowlist,
registry URL and allowed origins. The existing payment Compose configuration binds
only to localhost and requires an HTTPS/WebSocket reverse proxy.

See [deployment runbook](runbook.md) for remaining network deployment commands.
