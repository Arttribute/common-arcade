# Bootstrap architecture boundaries

The canonical Common Arcade system design is
[`common-arcade-system-design.md`](common-arcade-system-design.md). It governs
this scaffold.

This repository encodes these immediate decisions:

1. Common Arcade stands alone; Agent Commons integration is an adapter.
2. Next.js serves the public arcade, studio shell, spectator shell, and Fumadocs.
3. Hono on Lambda is the control plane, not the realtime simulation plane.
4. Authoritative matches will run in isolated, long-running workers.
5. Policy execution, strategic planning, team coordination, and adaptation are
   separate loops with observable decisions and explicit budgets.
6. The studio must grow into a Test Arena with compiled previews, agent playtests,
   structured logs, timeline/replay inspection, and precise annotations.
7. Protocol APIs remain non-normative until an RFC, schemas, security analysis,
   and executable conformance vectors are approved together.
8. AWS realtime topology is selected only after Phase 0 measurements.

No scaffold status marker is a substitute for an approved standard.
