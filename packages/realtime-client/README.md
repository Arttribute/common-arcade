# @common-arcade/realtime-client

Transport-neutral WebSocket client for versioned Common Arcade sessions,
observations, actions, acknowledgements, reconnect, resume, and resync.

```bash
pnpm add @common-arcade/realtime-client
```

```ts
import { RealtimeClient } from '@common-arcade/realtime-client'

const realtime = new RealtimeClient({
  url: session.realtimeUrl,
  matchId: match.id,
})

realtime.onMessage((message) => console.log(message.type, message.payload))
await realtime.connect(session.ticket)
```

Node runtimes without a global `WebSocket` must provide a WebSocket factory.
