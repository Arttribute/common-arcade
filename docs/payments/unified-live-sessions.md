# Unified live sessions

Paid and free sessions use the live player sidebar and game stage. The previous
payment table and separate live-session budget dialog have been removed.
Funding happens in player/spectator cards; hosting uses a game-only browser key
and does not connect a funds wallet. Host keys are retained in the current tab.

## Deployment order

1. Deploy the Commons wallet API change adding `arcade/autoplay` and advertising
   `autonomousPlay` in payment capabilities. It checks the existing owner-approved
   grant, active wallet, pool, recipient and expiry, then signs the game command
   using the agent wallet. Arcade refuses new agent entry payments if this
   capability is absent. Deploy this API before switching Arcade's agent join UI.
2. Deploy the updated non-upgradeable `ArcadeEscrow` through the existing protected
   testnet process and governance flow. Verify it before adding `seatControllers: true`
   to that network's `ARCADE_ESCROW_DEPLOYMENTS` entry. This flag must never
   be set on the old bytecode. Keep old deployments available for existing pools,
   settlement and refunds. The worker pins each pool's original contract.
   Deploy the payment worker with the verified map, check its health, then release
   the web UI so the new screen always has its supporting APIs available.
3. The new `stakeWithController` call binds a game-only key while atomically
   assigning the seat and transferring its stake. The payer remains the recipient
   of refunds and winnings. Delegated keys cannot move funds. Legacy pools still
   require one wallet signature to resume game controls; new contracts remove it
   during normal entry. Losing the tab's game key requires wallet recovery.
4. Publish explicit `arcadeGame.spectate(state)` projections for custom games that
   need live spectator rendering. Never expose private serialized checkpoints.
   Published releases without that method keep their preview but return no live
   spectator state. The standard blackjack and grid games have public projections.

## Payment and gameplay behavior

- Atomic-capable browser wallets batch exact USDC allowance plus deposit. Existing
  allowances are reused. Other wallets require allowance followed by deposit;
  the inline card explains both. A rejected/uncertain batch never falls back to
  another transfer. Submitted hashes/batch IDs survive reload for reconciliation.
- A Commons owner approves the budget once. Agent stake, bet and sponsor payments
  use the agent wallet through the existing reservation/idempotency system.
  Retries inspect earlier attempts even when a grant is exhausted. Unknown
  attempts retain their budget and do not cause a fresh transfer.
- New hosted sessions reconcile funding on the payment worker and start ten seconds
  after both seats are confirmed, even when the host browser is closed. Older pools
  retain their host-start policy.
- Autoplay runs the same bounded Arcade policy used for live games, on the match
  worker, at the release's decision rate. It has no payment capability. Its game
  authorization expires no later than the budget or game deadline; commands are
  recorded in the authoritative replay. External agents can use the signed HTTP
  and gameplay ticket interfaces with their own wallets.
- Revoking a payment grant immediately blocks further wallet operations. An
  already-issued gameplay authorization remains valid until its bounded expiry
  or an explicit signed autoplay stop; it cannot spend more funds.
- A host can cancel a funding lobby without a wallet prompt. Cancellation is
  durable and retryable; the host cannot cancel a started game. Refunds stay
  bound to the original contributing wallets.

## Validation

Use `pnpm --filter @common-arcade/web test`, payment-service tests (including
the local WebSocket transport), and `forge test`. Enable `ARCADE_ANVIL_URL` for
the local ERC20 integration suite. Browser checks should cover desktop/mobile,
the game visible before wallet access, an inline human entry, and exactly one
Commons budget/deposit/autoplay sequence with no browser wallet calls.

Wallet batching follows the [Viem sendCalls interface](https://viem.sh/docs/actions/wallet/sendCalls).

### Local verification (13 September 2026)

- Production Next.js webpack build passed.
- Web: 96 tests; payment service: 33 tests including local Anvil and WebSocket
  integration; contracts: 55 tests; economy/runtime/blackjack: 17 tests, all passed.
- Commons wallet authorization and autoplay: 9 tests passed. The full Commons
  typecheck remains blocked by missing dependencies in the existing install and
  unrelated provenance/e2e test errors; it reports no errors in the wallet changes.
- Chrome desktop/mobile checks used the published Redline Run renderer with mocked
  payment and Commons APIs. They verified an immediately visible game, inline
  entry, one budget/deposit/autoplay sequence, and no page errors. No real wallet
  funds were spent. Local Anvil tests separately exercised actual ERC20 transfers,
  delegated controls, settlement and withdrawals.

## Release evidence

- Commons wallet API: [PR 370](https://github.com/Arttribute/agent-commons/pull/370).
- Arcade runtime: [PR 81](https://github.com/Arttribute/common-arcade/pull/81).
- All four seat-controller escrows were deployed and verified in
  [protected run 34782406474](https://github.com/Arttribute/common-arcade/actions/runs/34782406474).
  Their runtime bytecode also matches the locally compiled contract.
- Verified deployment records and retained legacy addresses are in
  [PR 82](https://github.com/Arttribute/common-arcade/pull/82).
- The payment worker's [infrastructure diff](https://github.com/Arttribute/common-arcade/actions/runs/34782988537)
  changes only its task definition and service reference. Follow the
  [deployment run](https://github.com/Arttribute/common-arcade/actions/runs/34783144052)
  for rollout and endpoint checks.
