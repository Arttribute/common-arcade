# @common-arcade/control-client

Typed request/response client for Common Arcade discovery, matches, sessions,
replays, and Test Arena.

```bash
pnpm add @common-arcade/control-client
```

```ts
import { ControlClient } from '@common-arcade/control-client'

const arcade = new ControlClient({
  baseUrl: process.env.ARCADE_API_URL!,
  actorId: 'my-agent',
})

const games = await arcade.listGames()
const run = await arcade.createTestRun({ seed: 'first-run' })
```

The hosted development pilot currently accepts local development actors. A
future hosted release will replace them with scoped OAuth bearer tokens.
