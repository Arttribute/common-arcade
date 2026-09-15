# Engaged agent play and coaching

Agents play live matches by staying engaged. An agent reviews the game on a loop and keeps or replaces a strategy script. The match worker executes that script at game speed between reviews. Arcade never plays for an agent on its own: there is no autoplay, and a seat whose agent stops reviewing stops acting.

This splits the work by tempo. The model does what it is good at: reading the situation, judging what is working, and changing the plan. The match worker supplies fast, legal inputs so realtime games stay realtime.

## The loop

1. **Open a review.** The worker returns the seat-visible observation, legal action IDs, the running script, a performance report since the last review, recent strategy history, and the cadence.
2. **Decide.** The agent answers `keep` with a reason, or `replace` with a complete new script. The first review must replace, because nothing runs until a script exists.
3. **Execute.** The worker applies the script to each new observation, up to the game's `maxDecisionsPerSecond` (at most 20).
4. **Repeat.** Realtime and hybrid games review again about 8 seconds after each update. Turn-based and simultaneous games review once per decision point.

### Performance report

Each review includes `performance`, measured since the previous review:

- `decisions`, `submittedActions`, `rejectedActions` and `lastRejection`
- `topActions`: the actions the script chose most
- `ruleHits`: how often each rule index contributed to the chosen action, and `unusedRules`: rules that never fired
- `reward`: total, positive and negative feedback samples, and `recentFeedback` summaries
- `gameFeedback`: the game's own per-seat `observation.feedback`, when it emits one

`history` lists up to four previous strategies with their decisions, reward, reason and how long they ran. Games that emit per-seat `feedback` give agents much better evidence to adapt from.

### Engagement lease

A script runs only while its agent is engaged. Each `keep` or `replace` renews a 60 second lease. Opening a review keeps the current script running while the agent plans, but only for up to two lease windows after the last completed update. When the lease lapses, the worker releases held input and the seat stops acting until the agent updates again.

### Turn-based games

Open a review with `waitForDecisionPoint: true`. The request waits up to 20 seconds for the seat to be able to act, then returns. While that review is open, the seat holds its move so the new plan decides it. The hold is bounded: it ends after 30 seconds, or 2 seconds before the turn deadline or `turnTimeoutMs`, whichever comes first. After that, the standing script plays, so a slow model never forfeits a turn.

### Script format

The script is bounded JSON, never code:

```json
{
  "actionWeights": { "accelerate": 5 },
  "avoidActions": ["restart"],
  "rules": [
    {
      "when": [{ "path": "you.nextCornerMs", "op": "lt", "value": 800 }],
      "actionId": "brake",
      "weight": 20
    }
  ]
}
```

- Weights are between -100 and 100. Rules add their weight when every condition matches.
- Operators are `eq`, `ne`, `lt`, `lte`, `gt`, `gte` and `exists`. Paths are relative to the observation state. Missing paths do not match.
- An `actionId` can be an exact legal action ID, or the label before the trailing hash, which covers every payload with that label. For example `accelerate` matches `accelerate-1f2e3d4c`.
- `avoidActions` are excluded whenever another legal action exists.
- Limits: 80 action weights, 80 avoided actions, 32 rules, 8 conditions per rule.

A periodic replacement keeps the same control lease, held input and measured action rewards. The next decision releases held input if the new script chooses differently. Replacing with a different controller, or after the worker lost the session, opens a new lease and fences the old one.

## Commons agents on the match page

Select one of your agents and assign it to a seat. The page runs the review loop for that agent and shows its current strategy, the reason for the last change, and recent performance. You watch as a spectator. Pause stops the loop; the script stops within a minute. Reloading the page resumes the loop for agent seats you own.

Coaching is folded into the loop. A message sent while the loop runs is used in the agent's next review, which starts immediately. The agent must honor it and still returns a complete script.

Each review runs in a Commons conversation that is reused for up to 8 reviews, then rotated so a long match does not grow one context without bound. Reviews that have nothing to decide skip the model call: in the lobby once a script exists, or in a turn-based game while waiting for the other player.

## API

External agents run the loop themselves with any model:

- `POST /v1/matches/:matchId/seats/:seatId/strategy/requests` with `{ agentId?, waitForDecisionPoint? }` opens a review and returns its context.
- `PUT /v1/matches/:matchId/seats/:seatId/strategy` with `{ requestId, controllerId, update }` answers it. `update` is `{ "decision": "keep", "reason" }` or `{ "decision": "replace", "strategy", "reason", "executableStrategy" }`. A newer review supersedes an older one (`409`).
- `DELETE /v1/matches/:matchId/seats/:seatId/strategy/requests/:requestId` abandons a review and releases a held turn early.
- `POST /v1/matches/:matchId/seats/:seatId/strategy/review` with `{ agentId, note?, sessionId? }` runs one complete review with an owned Commons agent. `POST .../coach` with `{ agentId, prompt }` does the same with required coaching.

All routes require ownership of the agent seat and `matches:play`. The control client exposes `openStrategyReview`, `updateSeatStrategy`, `cancelStrategyReview` and `reviewLiveAgentStrategy`. The MCP server exposes `arcade.open_strategy_review` and `arcade.update_strategy`.

Strategy replacements are stored as `policy.strategy.changed` records. Replay actions carry `policyExecutionId` identifying the strategy epoch.

## Studio playtests

`POST /v1/studio/browser-runs/:id/controllers/:seatId/coach` with `{ prompt, observation: { state, actions } }` still turns owner coaching into a replacement script for a private browser playtest. The browser `/strategy` endpoint remains a direct text replacement.

## Not covered yet

Paid tables on the payment service use their own wallet-signed runtime and still offer `autoplay`. Live managed controllers are process-local, like control leases; after a worker replacement, the loop's next review installs a fresh lease.

## Redline Run experiment

The experiment reads a saved project document and runs its actual sandboxed rules locally. It does not modify or deploy the hosted project:

```sh
pnpm --filter @common-arcade/control-api exec tsx scripts/coaching-experiment.ts /path/to/project.json
```

To include a real Commons planning turn, append a Commons CLI config path and the ID of an owned player agent. Results are written to `/private/tmp/arcade-coaching-experiment.json`.
