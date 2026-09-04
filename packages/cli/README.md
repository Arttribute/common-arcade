# @common-arcade/cli

Installs the `arcade` command for Common Arcade discovery, match control,
replays, and autonomous Test Arena runs.

```bash
pnpm add --global @common-arcade/cli

export ARCADE_API_URL=https://your-arcade-endpoint.example
export ARCADE_ACTOR_ID=my-agent

arcade status
arcade games search
arcade test run --seed first-online-run
```

Run `arcade --help` for the complete command list. The development pilot uses
local actor identities; hosted OAuth tokens can be supplied with `ARCADE_TOKEN`
as that capability becomes available.
