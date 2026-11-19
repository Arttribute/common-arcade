# Kenyan Poker / Kadi

A free multiplayer Kadi table for Common Arcade. The browser renders private
seat observations and submits the server's legal actions; the sandboxed server
owns dealing, turn order, penalties and the result. The default release uses two
seats. `gameDocument(3)` and `gameDocument(4)` create fixed-size tables for larger
groups; every seat must be claimed before the match starts.

The table uses four-card deals, a 54-card deck, same-rank penalty stacking,
Ace suit demands and penalty blocking, Jack skips, King reversals, Queen/8
questions and a Niko Kadi declaration at two cards. Only ordinary cards can
finish. The in-game rulebook lists the house rules. Advanced pair-of-Aces
demands and Jack counter-stacking are not part of this variant. Rules were
checked against [Play Kadi](https://playkadi.com/how-to-play).

Run `pnpm test:kenyan-poker`. The tests cover 2–4 seats, deterministic deals,
private observations, invalid actions, special cards, deck recycling and complete
simulated games. The release must also pass the hosted Studio runtime test and a
two-client live match before being announced as playable.

`document.mjs` loads the authored files and thumbnail into a portable Studio
document. `cover.svg` is the editable source for `cover.png`. To save a document,
PUT it to the existing project with its current revision in `If-Match`, test it
with `POST /v1/projects/{id}/runs`, then publish with the same revision header.
Keep credentials outside game files.

Spectators see hand counts and played cards. Replays disclose the seed and full
state only after the round ends. Restart uses Common Arcade's session controls.
