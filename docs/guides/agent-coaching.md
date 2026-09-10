# Agent coaching and immediate strategy replacement

Owners can coach a running browser playtest or an owned agent seat in a live match. The selected Commons agent turns the coaching message into a complete replacement strategy. Planning runs separately from gameplay, with a 45-second request budget. A failed plan leaves the active strategy intact.

The strategy is bounded JSON: action weights, avoided actions, and conditional rules over seat-visible state. There is no generated JavaScript. Preview and live controllers run the same policy evaluator. Rules are game independent; their paths and action IDs come from the game's observation and legal actions. Full live action payloads retain distinct identities, including different targets or coordinates.

## Replacement behavior

- A newer coaching request supersedes an older pending request.
- A prepared strategy gets a new epoch. Old learned preferences, pending feedback attribution, and held inputs are cleared rather than appended to the replacement.
- The preview releases held inputs and schedules a decision on its next animation frame. It acknowledges application after the game accepts the new action. A legacy asynchronous action must settle before the same seat can submit another action.
- The live match worker serializes replacement with authoritative actions, releases declared held input, replaces the control lease, and executes a fresh decision immediately. Old external controller submissions are rejected.
- Held controls are submitted once; pulse controls are refreshed at their declared interval. Strategy changes do not restart the game.
- Strategy changes are stored as `policy.strategy.changed` records. Live replay actions carry `policyExecutionId` identifying the strategy epoch. Preview diagnostics remain client-observed, not authoritative evidence.

Game bridges should declare `control: { mode: 'hold' | 'pulse', releaseActionId, refreshMs? }` for persistent inputs. The release action must be legal when the input is released. Completed game actions are not undone. A strategy cannot submit an illegal action; if every available action is on its avoid list, the controller uses the legal fallback selection.

## Use

In Studio, start a browser playtest, edit the agent's coaching text, and choose **Coach agent**. Draft text does not change the active policy until the agent finishes planning.

On a live match page, select one of your agents and assign it to an open seat. Send coaching to start its controller. Each owned agent seat has its own coaching field and application status. Coaching an already controlled seat transfers action authority to Arcade's bounded runtime.

The control client provides `coachBrowserAgent(runId, seatId, prompt, observation)` and `coachLiveAgent(matchId, seatId, agentId, prompt)`.

HTTP endpoints:

- `POST /v1/studio/browser-runs/:id/controllers/:seatId/coach`: `{ prompt, observation: { state, actions } }`. Requires ownership of the playtest and `projects:write`.
- `POST /v1/matches/:matchId/seats/:seatId/coach`: `{ agentId, prompt }`. Requires ownership of the agent seat and `matches:play`. The worker supplies its legal observation; the caller cannot supply live game state.
- The existing browser `/strategy` endpoint remains a direct text replacement for compatibility; `/coach` additionally processes the message with the agent and compiles conditional rules.

This is an internal pre-v0alpha implementation, not a newly standardized adaptation protocol. Existing declarative Test Arena policy-IR runners and external hosts do not acquire this coaching behavior automatically. Live managed controllers are process-local, like current control leases; after worker replacement, reconnect and coach the seat again. No trained weights or game source are modified by coaching.

## Redline Run experiment

The experiment reads a saved project document and runs its actual sandboxed rules locally. It does not modify or deploy the hosted project:

```sh
pnpm --filter @common-arcade/control-api exec tsx scripts/coaching-experiment.ts /path/to/project.json
```

To include a real Commons planning turn, append a Commons CLI config path and the ID of an owned player agent. The script refreshes credentials in memory and never prints them. Results are written to `/private/tmp/arcade-coaching-experiment.json`.

On September 10, 2026, Redline Run revision 7 was exercised with its Player 1 agent. Coaching from a braking baseline to acceleration and centering took 5.64 seconds to plan and 43.4 ms to release the old input and apply the new action. Over the next 1.5 seconds, observed speed rose from 0 to 58 mph and lane position moved from -0.42 to -0.28. No old strategy actions resumed after replacement. This establishes immediate behavioral change in this scenario, not a general win-rate improvement.
