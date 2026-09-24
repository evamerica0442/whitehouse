# /infra

Reserved for Phase 2 (AWS ECS migration). Intentionally empty for now.

The project brief calls for **no infrastructure-as-code during the free-tier phase**,
and the application is written so that adding it here is a config change rather than
a rewrite:

- the API reads every setting from environment variables (`apps/api/src/config/env.ts`)
  and exposes a standard `npm start` entrypoint, so it containerizes as-is;
- the database is reached through a single factory (`packages/db/src/client.ts`),
  so moving from the Neon serverless adapter to `@prisma/adapter-pg` for RDS is a
  one-file change;
- email goes through the `EmailSender` interface, so Resend → Amazon SES is one new
  implementation;
- the job queue is behind the `JobQueue` interface, so pg-boss → SQS (or BullMQ on
  ElastiCache) is one new implementation;
- auth sits behind `resolveSession` + two cookie helpers, which is the whole surface
  a swap to IAM Identity Center has to satisfy.

What will live here when Phase 2 starts:

```
/infra
├─ cdk/            # or terraform/ — VPC, ECS cluster, ALB, RDS, ECR, SES, IAM
├─ Dockerfile.api  # multi-stage build for apps/api (npm ci --omit=dev in the final stage)
├─ Dockerfile.web  # only if the frontend is containerized instead of S3 + CloudFront
└─ README.md
```

Nothing in this repository currently references this directory, so adding it has no
effect on the running system.
