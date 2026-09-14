# Deployment flow

AWS deploys are manual during bootstrap. The workflow assumes a short-lived AWS
role through GitHub OIDC and targets a protected GitHub environment.

1. Run `diff` for `development` or `staging`.
2. Review the synthesized templates and change set.
3. Run `deploy` with the exact confirmation input.
4. Verify `/healthz`, logs, alarms, and rollback behavior.
5. Promote the same commit; do not rebuild mutable production artifacts.

Vercel previews come from the Git integration. Production promotion remains
protected in Vercel until the web surface has a verified control API endpoint.

## Web Analytics

The web app mounts `@vercel/analytics/next` once in its root layout to track page
views across all routes, including client-side navigation. No additional
environment variables are required; local development does not send page views.

1. Open the `common-arcade` project in Vercel, select **Analytics**, and enable
   Web Analytics.
2. Deploy the web app through the normal deployment flow after enabling it.
3. Visit the deployed site and navigate between pages. In the browser Network
   panel, verify that the analytics script loads and page-view requests to
   `/_vercel/insights/view` succeed.
4. Confirm visits appear in the project's Analytics dashboard. Browser blockers
   may prevent analytics requests, so disable them for this verification.

See the [Vercel Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart).
