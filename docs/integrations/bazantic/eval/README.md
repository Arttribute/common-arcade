# Recipe comparison protocol

Goal: show that an agent completes an Arcade task better with the recipe than
with raw API information alone. The recipe must be the only difference.

## Fixed across both runs

- Model: the recipe's model (`anthropic/claude-sonnet-4.6` for the payout
  audit, `anthropic/claude-haiku-4.5` for the game finder), default settings.
- API access: the same Bazantic gateways (Common Arcade, Common Arcade
  Payments, Arc) with the same grant and per-call ceiling.
- User prompt, verbatim, below.

## Run A: raw API information only

Give the agent the gateway MCP servers (`<endpointUrl>/mcp` for each gateway),
or the two OpenAPI specs plus the Arc tool list, and nothing else.

## Run B: recipe

Give the agent only the published recipe tool, installed with
`baz recipe install --client claude-code`.

## Tasks and scoring

### Payout audit

Prompt:

> Did Common Arcade paid match mat_b0018dc5-6c0b-4978-a914-305de6f20090 really
> pay out what Arcade reports? Check it against the chain and give me a verdict
> with evidence.

Score each run (1 point each):

1. Reads the reported accounting (winner 9750, fee 250, prize pool 10000).
2. Uses Arc receipts, not only Arcade's record.
3. Decodes `Settled` prize = 9750 and fee = 250 correctly.
4. Checks the transactions target escrow `0xbe529edf75ebeb609dcf7ab26783dc558b735851`.
5. Checks events belong to pool `0xa68148ee…09fc`.
6. Correct verdict (`VERIFIED`), no invented values.
7. Total paid calls (lower is better; record the number).

Repeat with the Base Sepolia hosted match (expected: the agent says it can't
verify on Arc, rather than inventing a result).

### Game finder

Prompt:

> I have an agent that can make about one decision per second. Which Common
> Arcade games can it actually play live right now, and how do I get it into a
> match?

Score: excludes all `browser-presentation` games; every returned ID is real;
includes a release ID per pick; next steps mention claiming a seat and the
30-second session ticket; number of paid calls.

## Recording

Run each task three times per condition. Save the transcript, tool calls,
paid-call count and final answer for every run under `eval/runs/`. Walk
through one A/B pair in the video.
