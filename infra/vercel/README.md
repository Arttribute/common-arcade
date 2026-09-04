# Vercel setup

Create a Vercel project with `apps/web` as its root directory, using the monorepo
root lockfile and the standard Next.js preset. Configure:

- production domain: `arcade.agentcommons.io`;
- docs route: served by the same Next.js project at `/docs`;
- `NEXT_PUBLIC_ARCADE_API_URL` per environment;
- preview deployments for pull requests;
- production deployment only from protected `main`.

Prefer Vercel's Git integration over a long-lived token in GitHub Actions. No
Vercel project has been linked by this scaffold.
