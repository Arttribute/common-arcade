# AWS infrastructure

AWS CDK v2 foundations for the Hono/Lambda control plane and durable platform
resources. `pnpm infra:synth` is safe and local. `diff` and `deploy` require an
explicit stage context, for example:

```bash
pnpm --filter @common-arcade/aws-infra diff -- --context stage=staging
```

The stack deliberately does not create ECS/ALB realtime infrastructure, Aurora,
or production networking during bootstrap. Those follow measured Phase 0 POCs
and ADR approval. Buckets, DynamoDB, and ECR repositories are retained on stack
deletion; production stacks use termination protection. The health-only Lambda
has no data-store permissions until a route has a concrete need for them.
