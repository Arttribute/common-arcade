# Common Arcade UI refresh

Scope: the Common Arcade web app. Agent Commons remains a separate product; its shared composer and existing session APIs provide the chat integration.

## Meeting review

The transcript was used to seek directly to relevant recording frames, including 12:35 (error presentation), 16:55 (preview and diagnostics), 30:00 (Discover), 54:20 (session setup), 68:20 (player controls), and 77:35 (payment setup). The App Store Discover and game recordings, Infisical and Base recordings, and supplied PlayCanvas screenshots guided spacing, artwork, hierarchy and the Studio rail. Discussion of runtime glitches, payment execution, game mechanics and dynamic seats was treated as context, not instructions to change those systems.

| Feedback                              | Change                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long, mixed Studio drawer             | Full-height rail: Project, Testing, Recordings, Publishing, Payments, Team. Panels keep their state when switching.                                                           |
| Crowded assistant and input highlight | Removed redundant heading; retained Commons composer with its borderless textarea.                                                                                            |
| General chat without revisions        | Separate Chat tab, New conversation, and Commons-backed session history. Build conversations retain project context.                                                          |
| Small logs and clipped preview        | Expand/restore diagnostics, scrollable preview and layout-aware zoom.                                                                                                         |
| Account placement                     | Account at bottom left in Studio and shared app navigation.                                                                                                                   |
| Unreadable code                       | CodeMirror highlighting, line numbers, search, folding and explicit Prettier formatting.                                                                                      |
| Text-heavy Discover and Live          | Artwork cards, working search/type filters and explicit alphabetical ordering; live cards retain occupancy, audience and status.                                              |
| Missing thumbnails                    | Optional draft field, compact 16:9 image picker, mandatory new-publication validation and manifest metadata. Existing releases remain immutable and idempotently publishable. |
| Legacy catalog artwork                | Screenshots captured from public, isolated playable previews on 2026-09-11. Static image paths are keyed by game ID; creator thumbnails take precedence.                      |
| Overwhelming game setup               | Play opens a focus-managed dialog; advanced game contracts are collapsed.                                                                                                     |
| Crowded human controls                | In-game/action-button selector, concise feedback, expanded technical/keyboard details on demand; pointer hold and release behavior retained.                                  |
| Small spectator view                  | Fullscreen toggle with Escape/fullscreenchange synchronization.                                                                                                               |
| Confusing paid-game configuration     | Descriptive earning choices and one payout network editor at a time; existing economics unchanged.                                                                            |

## Implementation references

[CodeMirror basic editor](https://codemirror.net/examples/basic/), [Prettier browser API](https://prettier.io/docs/browser), and [shadcn dialog composition](https://v3.shadcn.com/docs/components/dialog). Lucide icons and the existing Commons primitives remain the shared vocabulary. No animation dependency was added; reduced-motion preferences are respected.

## Verification

- Web typecheck and production build.
- Control API suite, including thumbnail-required publication, artwork propagation and release idempotency.
- Web suite, including chat origin/auth checks, user-scoped history, foreign-session rejection and normal-agent dispatch.
- Protocol schema generation and tests.
- Desktop/phone browser review; Studio group switching, Chat history, composer focus, source highlighting and mobile overflow checks with isolated fixtures.

General chat calls the existing Commons service and never the Arcade project revision endpoint. The web route validates origin, uses the signed-in identity and verifies session membership before accessing history. It does not create a separate backend chat store. New draft thumbnail metadata and publication validation are the small persistence changes needed for the UI feature.
