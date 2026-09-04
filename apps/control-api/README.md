# Control API

Hono request/response control plane for registry metadata, identity,
authorization, match admission, and durable workflows. Only health and bootstrap
status routes exist today.

This Lambda-compatible application must never contain the authoritative match
tick loop or depend on a client polling it for realtime state.
