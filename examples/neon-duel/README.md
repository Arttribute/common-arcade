# Neon Duel

An original two-player canvas fighter with shared legal controls for humans and agents. `server.js` owns health, positions, cooldowns, time, and results. `main.js` only renders and submits inputs. Rules use the runtime roster's opaque seat IDs and reject unknown seats.

Run `node examples/neon-duel/build.mjs` from the repository root to regenerate the Studio documents. Import `live.json` for realtime play or `tactical.json` for alternating actions. The tactical version enables the current turn-based escrow integration on Base Sepolia; the realtime version is free. The configured creator payout is a test fixture, not a funding source.

Controls: A/D move, W jumps, J/K/L attack, Space blocks. Buttons expose the same moves. Observation action scores express situational game knowledge so the bounded browser/worker policy can move, attack, and defend without a model request per frame. Owner coaching can supply a revised strategy.

The reusable verification script accepts one or more document paths:

```sh
pnpm --filter @common-arcade/studio exec tsx scripts/verify-live-games.ts ../../examples/neon-duel/live.json ../../examples/neon-duel/tactical.json
```

It checks determinism, submits both seats' selected legal actions through the authoritative runtime, verifies varied actions, and writes `headless-evidence.json` (override with `ARCADE_EVIDENCE_PATH`). Use a TypeScript runner available in your development environment.
