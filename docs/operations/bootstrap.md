# Bootstrap activation checklist

Nothing in the initial repository has been deployed or published.

## GitHub

1. Create the `Arttribute/common-arcade` repository and push `main`.
2. Protect `main`; require CI and review.
3. Create protected `staging`, `production`, and `npm` environments.
4. Configure environment reviewers before enabling deployments.
5. Set `ARCADE_RELEASE_PR_ENABLED=true` only when package release PRs should start.
6. Set `NPM_RELEASE_ENABLED=true` only after trusted publishers are configured.
7. Set `AWS_DEPLOY_ENABLED=true` only after CDK bootstrap and OIDC validation.

## AWS

1. Choose separate staging and production accounts when possible.
2. Bootstrap CDK in each account/region.
3. Create least-privilege GitHub OIDC deployment roles.
4. Add `AWS_DEPLOY_ROLE_ARN`, `AWS_ACCOUNT_ID`, and `AWS_REGION` to the matching
   protected GitHub environments.
5. Run the AWS workflow in `diff` mode and review the CloudFormation changes.
6. Deploy development, validate health/alarms/rollback, then repeat for staging.

## Vercel and DNS

1. Import `apps/web` into Vercel with monorepo root awareness.
2. Configure preview and production API URLs.
3. Validate the preview, then attach `arcade.agentcommons.io`.

## npm

1. Reserve the `@common-arcade` scope and review the intended public packages.
2. Configure npm trusted publishing for `.github/workflows/publish-packages.yml`
   and the `npm` GitHub environment.
3. Add changesets, merge the generated version PR, and manually publish first to
   the `next` tag.
4. Verify package contents, provenance, CLI behavior, and rollback/deprecation
   procedures before the first `latest` publication.
