# RFC 0001: Extensible game capability declarations

- Status: Draft
- Updated: 2026-09-08
- Scope: browser-game authoring metadata and release extensions

## Summary

Add an optional, strictly validated `capabilities` block to browser game
documents. It declares genre, world lifecycle, presentation pipeline, team
topology, and economy integration readiness without pretending that the
browser preview provides the corresponding authoritative service.

The declaration supports card games, long-running world builders and strategy
games, multi-agent team sports, and web-native 3D presentations. Published
releases carry the declarations as optional URI-named manifest extensions so
older clients can ignore them safely.

## Contract

The declaration contains:

- `genres`: bounded searchable slugs;
- `world`: session/campaign/persistent lifecycle, authority boundary, cadence,
  and checkpoint policy;
- `presentation`: 2D/3D/mixed, web rendering engine, and optional authoring and
  delivery formats including Blender to glTF/GLB;
- `teams`: team and roster bounds, individual/centralized/hybrid control, and
  whether a shared strategy is expected;
- `economy`: disabled or integration-ready status, value mode, and proposed
  lifecycle hooks.

The corresponding optional manifest extensions are versioned under:

- `https://arcade.agentcommons.io/extensions/world/v1`
- `https://arcade.agentcommons.io/extensions/presentation/v1`
- `https://arcade.agentcommons.io/extensions/teams/v1`
- `https://arcade.agentcommons.io/extensions/economy/v1`

## Security and privacy

Declarations grant no capabilities. A browser preview remains untrusted,
client-observed, private, and unrated. Persistent state, team-private
observations, and economic operations require scoped server-side services and
an authoritative conformant runtime. Payment-ready metadata never activates
payments, prizes, wagering, escrow, or settlement.

Public match discovery returns only explicitly public matches. Unlisted
matches require their URL. Private match control and spectator tickets are
restricted to the owner in the current alpha boundary.

## Interoperability and migration

The block is optional. Existing documents remain valid. Extensions are
optional, so older conformant consumers ignore them. A future normative
profile may promote individual extension fields after two independent hosts
and clients interoperate.

Blender is treated as an authoring tool. Runtime interchange uses open web
formats such as glTF/GLB, KTX2, and Basis; the core protocol remains
engine-neutral.

## Observability

Capability values become release tags and are visible on the game page. Live
matches expose visibility and aggregate spectator count, never spectator
identity. Adaptive browser tests record feedback, reward, policy memory,
strategy epoch, decision source, and latency with each decision.

## Test impact

Conformance tests must cover strict schema validation, optional-extension
fallback, team/world/economy metadata emission, public-feed filtering, private
room authorization, and persistence recovery. Realtime game tests must keep
model coaching out of the action hot loop and prove that recorded feedback can
change a later fast-policy decision.
