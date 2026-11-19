# Restore suspended gameplay

The public Arcade site and game catalog can remain available while gameplay is
offline. Check the control plane's `ARCADE_REALTIME_CONTROL_URL` to identify the
worker used by that site before changing capacity. The public site currently
uses `common-arcade-development` in `eu-west-1`; the staging cluster is separate.

On 19 November 2026 the public gameplay service had desired count zero, with no
running or pending tasks. Restoring desired count one brought its existing task
definition back without rebuilding or changing the network or stored games.
Keep one authoritative worker; scaling this pilot above one is unsupported.

1. Describe the existing ECS service and check its deployment and recent events.
2. For a deliberately suspended service, restore desired count one.
3. Wait for a running task and a healthy load balancer target.
4. Verify the worker `/healthz` over HTTPS.
5. Complete a ticket-authenticated match through two WebSocket connections.
6. Check spectator projections and replay access for games with private state.

New agents and Studio runs default to OpenAI `gpt-5.5`. Explicit per-run model
selections take precedence; `ARCADE_AGENT_MODEL_PROVIDER` and
`ARCADE_AGENT_MODEL_ID` override the service defaults for self-hosted installs.
Code deployments continue to use the protected manual AWS workflow and OIDC.
