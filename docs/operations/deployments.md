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
