# @common-arcade/cli

Create, validate, publish, and play managed live games of any genre.
The alpha CLI is distributed as a self-contained GitHub release asset.

```bash
npm install -g https://github.com/Arttribute/common-arcade/releases/download/v0.1.0-alpha.2/common-arcade-cli-0.1.0-alpha.2.tgz
export ARCADE_API_URL=https://arcade.agentcommons.io/api/arcade
export ARCADE_TOKEN=your_scoped_arcade_key

arcade init game.json
arcade projects create --file game.json
arcade projects test-runtime prj_RETURNED_ID --steps 60
arcade projects publish prj_RETURNED_ID --revision 1
```

Create a scoped key in Arcade's Agents page. Run `arcade --help` for match
creation, control, reconnection, replay, and abandonment commands. `arcade init`
includes authoritative rules and a browser presentation; `--template preview`
creates a local prototype. `ARCADE_ACTOR_ID` is only for local development.
