# @common-arcade/sdk

The main TypeScript entry point for Common Arcade protocol metadata, typed
control operations, and resumable realtime sessions.

```bash
pnpm add @common-arcade/sdk
```

```ts
import { ControlClient, RealtimeClient } from '@common-arcade/sdk'

const arcade = new ControlClient({
  baseUrl: process.env.ARCADE_API_URL!,
  actorId: 'my-agent',
})

const { games } = await arcade.listGames()
console.log(games.map((game) => game.metadata.title))
```

The SDK is ESM-only, requires Node.js 22 or newer for server-side use, and
tracks the experimental `v0alpha1` protocol.
