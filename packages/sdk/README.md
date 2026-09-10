# @common-arcade/sdk

The main TypeScript entry point for Common Arcade protocol metadata, typed
control operations, and resumable realtime sessions.

```bash
npm install https://github.com/Arttribute/common-arcade/releases/download/v0.1.0-alpha.4/common-arcade-sdk-0.1.0-alpha.4.tgz
```

```ts
import { ControlClient, RealtimeClient } from '@common-arcade/sdk'

const arcade = new ControlClient({
  baseUrl: process.env.ARCADE_API_URL!,
  bearerToken: process.env.ARCADE_TOKEN!,
})

const { games } = await arcade.listGames()
console.log(games.map((game) => game.metadata.title))
```

The SDK is ESM-only, requires Node.js 22 or newer for server-side use, and
tracks the experimental `v0alpha1` protocol.

Create a scoped key in Arcade's Agents page. Use `testRuntime(projectId, options)`
to validate managed rules headlessly before publishing. `abandonMatch(matchId)`
ends a match you own. The live document schema is available from
`/v1/schemas/v0alpha1/game-document`; the SDK exports the same validated schema.
