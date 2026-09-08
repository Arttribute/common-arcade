# RFC 0002: Lobbies, series, remixes, and live session instances

- Status: Implemented alpha contract; tournament and settlement sections remain design notes
- Updated: 2026-09-08
- Scope: hosted match creation, discovery, joining, rounds, Studio authorization, and remix provenance

## Summary

A published release is an immutable game template. It may have any number of
independent match instances at the same time. Each match owns its lobby,
roster, visibility, controller policy, series state, realtime state stream,
replays, and share URL. A protocol session remains one authenticated realtime
connection to one match; product copy may call the containing match a “live
session.”

The alpha contract adds:

- public, unlisted, and private match instances;
- open and invite-only lobbies;
- human and agent controller admission rules;
- atomic explicit-seat joins and first-open-seat matchmaking;
- enabled or disabled live spectating;
- a bounded round count and automatic, owner, or unanimous restart policy;
- one immutable replay per completed round;
- owner-controlled Studio edit, test, and comment grants;
- creator-controlled remix licenses with immutable source attribution.

## Match and lobby invariants

Match creation is idempotent and never mutates the release. Match IDs identify
instances, not games. Two match creation requests for one release share no
state unless a later tournament record links them.

Seat selection and matchmaking execute through the match authority's
serialized operation boundary. The first claim wins; a later claimant receives
a conflict. Filling the final required seat starts the match exactly once.
Matchmaking selects the oldest compatible open public lobby for the same
release, game configuration, series rules, and controller type. If none exists,
it creates a new public lobby and joins its first seat.

Invite-only lobbies admit the owner and configured actor IDs. Private matches
remain owner-only in the alpha; shareable invitations use unlisted visibility
plus invite-only admission. Controller IDs are never treated as actor identity:
the authenticated actor remains accountable for a human or delegated agent
controller.

## Series and restart state machine

Every match has one series with `currentRound`, `maximumRounds`, scores,
restart votes, and a restart policy.

```text
round running -> round completed -> series complete
                              \-> awaiting restart -> next round running
```

The authority records the result and score before making restart available.
Automatic restart advances immediately. Owner restart requires the creating
actor. Unanimous restart records one idempotent vote per seated actor and
advances only when every distinct seated actor has voted. All transitions use
the same per-match serialization boundary, so concurrent restart requests can
produce only one new round.

Advancing archives the completed replay, creates a fresh deterministic runtime
with an incremented fencing epoch, and preserves the verified roster and active
seat leases so connected controllers receive the new round observation. A
process-owner change still revokes prior leases. A replay endpoint addresses
each round explicitly. A completed series cannot restart; a new contest is a
new match instance.

## Spectating and sharing

Public matches appear in the Live feed. Lobby matches are shown as joinable;
running matches are shown as watchable. Unlisted matches have stable share
links but are absent from discovery. Private matches are owner-only.

Disabling spectating rejects spectator tickets, state projections, and replay
reads from nonparticipants; public metadata may still describe that a match
exists. The semantic realtime stream is the baseline live broadcast. Media
renditions, spectator delay, chat, moderation, watch parties, and CDN fan-out
remain separate presentation/distribution services and must never advance the
authoritative clock.

## Studio authorization and remix provenance

Direct project mutation is never granted by release visibility. The owner may
grant a Commons actor one or more of `edit`, `test`, and `comment`; every
request revalidates the grant against the current project. Only the owner may
publish or change access.

Published releases default to all-rights-reserved with remixing disabled. When
enabled, remixing creates a new project owned by the remixer and records the
source release digest and original creator. The remix never edits the source
project or release. Licenses and attribution rules are release metadata and
must be shown before remix creation.

### Future creator earnings implementation note

`revenueShareBps` records an intended original-creator share for future remix
commerce. It does not authorize payment, custody, wagering, escrow, invoicing,
tax handling, or settlement. A future commerce service must use immutable
lineage, versioned terms accepted by all parties, jurisdiction and age checks,
ledger entries, refunds, disputes, and auditable settlement proposals. Match
workers and browser games must never receive payment credentials or directly
move value.

## Tournament extension design

A tournament is a control-plane aggregate over immutable release IDs and match
instances. Its versioned rulebook fixes eligibility, roster locking, seeding,
format, per-series rules, scheduling windows, disconnect/forfeit policy,
spectator delay, moderation, and rating consequences. Bracket advancement
consumes signed terminal series results exactly once by idempotency key; it
never infers winners from browser UI or spectator state.

Tournament matchmaking creates ordinary match instances linked by
`tournamentId`, `stageId`, and `pairingId`. This preserves the same runtime,
replay, and spectator semantics for duels, leagues, elimination brackets, and
team sports. Long-running worlds use scheduled encounters or explicit campaign
boundaries rather than pretending a persistent world is one endless round.

## Migration and compatibility

Lobby and series blocks are optional in the v0alpha descriptor so older saved
matches recover with open human/agent admission, enabled spectating, one round,
and owner restart. Old releases without distribution metadata recover as
all-rights-reserved with remixing disabled. This fail-closed default is
intentional.
