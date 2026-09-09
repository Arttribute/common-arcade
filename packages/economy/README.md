# Optional game economy

Free play is the default. `economyConfigSchema` enables per-match testnet USDC
stakes, bounties and bets. Money is represented by atomic integer strings.

`ArcadeChainAdapter` is the wallet-independent signing boundary. `escrowCall`
and `approvalCall` construct unsigned calls; `createViemAdapter` verifies the
wallet/RPC chain and waits for successful confirmations. Agent custody remains
inside Commons. Games do not import this adapter into their action loop.

`safeGovernanceBatch` exports Safe Transaction Builder JSON. On Hedera it also
associates USDC with escrow and the Safe treasury. Verify association afterwards:
HTS system calls report numeric result codes, which Safe does not interpret.

See [integration plan](../../docs/payments/integration-plan.md).
