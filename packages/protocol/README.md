# @common-arcade/protocol

Strict schemas, types, identifiers, and version negotiation for the Common
Arcade `v0alpha1` control and realtime protocols.

```bash
pnpm add @common-arcade/protocol
```

```ts
import { ARCADE_PROTOCOL, gameManifestSchema } from '@common-arcade/protocol'

console.log(ARCADE_PROTOCOL.wireVersion)
const manifest = gameManifestSchema.parse(input)
```

`v0alpha1` is an experimental interoperability contract and is not yet a
normative stable release.
