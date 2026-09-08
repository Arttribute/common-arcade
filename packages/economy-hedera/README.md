# @common-arcade/economy-hedera

Opt-in, testnet-only game economy for Common Arcade: per-match bounties,
per-seat stakes, and spectator betting, settled on Hedera. **Disabled by
default for every game** — nothing here activates unless a game's manifest
explicitly declares the `economy-hedera/v1` extension.

This is intentionally a different, newer extension id than
`https://arcade.agentcommons.io/extensions/economy/v1` from RFC 0001, which
is metadata-only by design and explicitly never activates payments. This
package's `economy-hedera/v1` is the activating one.

## What's here

- `src/index.ts` — the extension's Zod schema (`economyHederaConfigSchema`)
  and `readEconomyHederaConfig(manifest)` / `isEconomyFeatureEnabled(config)`
  helpers for reading a game's declaration off its manifest.
- `contracts/MatchEscrow.sol` — the escrow contract: `fundBounty`, `stake`,
  `placeBet`, `settle` (arbiter-only), `voidMatch` (arbiter-only), and
  pull-payment `withdraw` / `claimBetWinnings`. See the contract's own
  NatSpec for the full custody model.
- `hardhat.config.ts`, `test/`, `scripts/deploy.ts` — compile, test, and
  deploy the contract to Hedera testnet via the standard Hedera JSON-RPC
  relay (Hedera's Smart Contract Service is EVM-compatible, so this is
  ordinary Hardhat + ethers, no Hedera-specific plugin required).

## Declaring the extension on a game

```json
{
  "id": "https://arcade.agentcommons.io/extensions/economy-hedera/v1",
  "required": false,
  "config": {
    "network": "hedera-testnet",
    "escrowContractAddress": "0x...",
    "bounty": { "enabled": true },
    "stake": { "enabled": true, "amountTinybars": "100000000" },
    "betting": { "enabled": false }
  }
}
```

See `examples/tic-tac-toe`'s `getTicTacToeManifestWithEconomy` for a working
example that adds this without changing the base game's default manifest
(`getTicTacToeManifest`) at all.

## Contract workflow

```bash
pnpm --filter @common-arcade/economy-hedera contracts:test      # local Hardhat network, no testnet needed
HEDERA_OPERATOR_PRIVATE_KEY=0x... \
ARCADE_ARBITER_ACCOUNT=0x... \
pnpm --filter @common-arcade/economy-hedera contracts:deploy:testnet
```

`ARCADE_ARBITER_ACCOUNT` should be the same account whose key control-api's
`HEDERA_OPERATOR_PRIVATE_KEY` unlocks (see the repo root `.env.example`) —
that account is the only one that can ever call `settle`/`voidMatch`.

## Units

Hedera itself uses 8-decimal tinybars (1 HBAR = 1e8 tinybars); this package's
config (`amountTinybars`) is always in tinybars. Callers that submit a
transaction through a standard EVM client against Hedera's JSON-RPC relay
must convert to weibar (1 tinybar = 1e10 weibar) for the transaction's
`value` field — see `tinybarsToWeibars` in
`apps/control-api/src/economy.ts`.

## Status

Testnet-only for now. The repo's architecture doc
(`docs/architecture/common-arcade-system-design.md`) flags real-money
economy features as a fraud/abuse risk to defer; going to mainnet real
money is a deliberate, separately-reviewed decision, not a default this
package assumes.
