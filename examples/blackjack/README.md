# Blackjack duel

A deterministic two-player Arcade game: hit/stand, ace adjustment, one 52-card
shoe, highest non-bust total wins. Ties and double busts refund paid pools.
No house bankroll, splits, doubles or insurance. Public observations hide the
remaining shoe; completed replays disclose the committed seed.

This is a trusted-dealer testnet demonstration, not verifiable randomness.
The dealer can know or choose a favorable seed. A future randomness adapter must
close funding before accepting a verifiable randomness result.

Run `pnpm --filter @common-arcade/example-blackjack test`. Open `/play/blackjack`
with the [payment service](../../services/payment-service/README.md) running.
