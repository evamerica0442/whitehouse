# Whitehouse Cloudguard

A unified multi-tenant AWS management console for MSP admin staff — one pane of glass
over many customer accounts. It consolidates four things that normally live in four
different AWS services: multi-tenant operations (MSP Partner tooling), account
provisioning + guardrails (Control Tower), consolidated billing / SCPs / delegated
admin (Organizations), and pre-approved deployments (Service Catalog).

**Internal tool.** There is no customer-facing portal and no customer login. The only
users are MSP staff, in three tiers: `SUPER_ADMIN`, `ENGINEER`, `READ_ONLY`.

---

## Status

Milestone 1 is implemented end to end and verified locally: `npm run lint`,
`npm run test` (45 tests), `tsc -b` across every project, a production web build, and a
live API boot smoke test all pass.

| Module | State |
| --- | --- |
| 0 · Onboarding wizard | **Complete** — template generation, manual *or* emailed delivery with per-attempt status, STS `AssumeRole` Test Connection, governance assignment, status pipeline |
| 1 · Tenant management | **Complete** — list/search/filter/sort, per-tenant cost from cache, SCP catalog + assignment |
| 2 · Guardrails | **Partial** — library, assignments and compliance read model are live; enforcement inside customer accounts and scheduled drift evaluation are Milestone 2 |
| 3 · Template catalog | **Partial** — templates, versions, approvals and entitlements are live; automated provisioning is Milestone 2 |
| 4 · Operations dashboard | **Complete** — counts, compliance %, spend, alerts, job history, audit log |

Anything not implemented returns an explicit "Milestone 2" outcome rather than a fake
success. In particular, `catalog.deploy-template` records a `FAILED` deployment row
explaining that nothing was created in the customer account.

---

## Stack

React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui-compatible components on the
front end; Fastify 5 + Prisma 7 on PostgreSQL (Neon) behind it.

Three dependencies in the original brief needed changing, and the reasons matter more
than the choices:

| Brief | Shipped | Why |
| --- | --- | --- |
| Lucia Auth **or** Auth.js | First-party sessions (argon2id + `sessions` table + HMAC-hashed cookie tokens), magic links via the `EmailSender` interface | Lucia's npm package is **deprecated** (`deprecated = 'This package has been deprecated…'`) and its own docs now point to a single-file replacement. First-party sessions keep the IAM Identity Center upgrade path down to `resolveSession` + two cookie helpers. |
| BullMQ for the job queue | **pg-boss**, behind a `JobQueue` interface | BullMQ requires Redis, which the free-tier stack does not include — and the free-tier Redis options cannot hold provisioning jobs (Render's free Key Value is in-memory and loses its data on restart; Upstash bills per command and BullMQ polls constantly). pg-boss reuses the Neon database, so the queue adds no infrastructure. |
| Render free tier for everything | Render free web service + **GitHub Actions** for schedules | Render's free tier covers web services, Postgres, Key Value and static sites only — there are **no free background workers and no free cron jobs**. |

Two behaviours worth knowing when deploying on free tiers:

- Render spins a free web service down after **15 minutes** without traffic and takes
  **about a minute** to wake. `apps/api/README`-adjacent notes and the scheduler
  workflow both account for this.
- Neon's free plan always suspends idle computes after 5 minutes, so the pooled
  connection string includes `connect_timeout=15`. Without it, Prisma reports `P1001`
  on the first request after a quiet period.

---

## Repository layout

```
apps/web                 React console (Vite)
  src/pages/onboarding   The wizard: details → template → delivery → verify → governance
apps/api                 Fastify server + in-process job worker
  src/routes             HTTP surface (zod-parsed, permission-guarded)
  src/services           Domain logic (no Prisma in routes)
  src/jobs               JobQueue interface, pg-boss + memory drivers, handlers
packages/shared          Enums, zod contracts, permission model, date helpers, CloudProvider types
packages/db              Prisma schema, migrations, client factory, seed
packages/aws-sdk-wrapper STS AssumeRole provider, scoped client factories, CFN template builder, mock driver
infra                    Reserved for Phase 2 (see infra/README.md)
```

`packages/shared` is the contract: the web app and the API import the same zod schemas
and the same permission map, so a UI that hides an action and an API that rejects it can
never drift apart.

---

## Quick start

Requires Node 22.12+ (developed on Node 24) and a Postgres database — a free Neon project
is the intended path.

```bash
# 1. Install and configure
npm install
cp .env.example .env          # fill in DATABASE_URL / DATABASE_URL_UNPOOLED / SESSION_SECRET

# 2. Create the schema and load the demo data
npm run db:generate
npm run db:migrate            # creates tables from packages/db/prisma/schema.prisma
npm run db:seed               # 3 admin users, 7 guardrails, 2 SCPs, 2 templates, 3 tenants
```

> **The Prisma client is build output, not a checked-in file.** It is written to
> `packages/db/generated/prisma` (gitignored) and generated automatically by a
> `postinstall` hook in `@whitehouse/db`, so a fresh clone is ready after
> `npm install`. If you ever install with `--omit=dev` (no Prisma CLI), the hook
> skips with a warning and you must run `npm run db:generate` before building.
>
> Every build entry point (`build:api`, `build:web`, `dev`, `typecheck`) runs
> `db:generate` itself, which is why none of them can fail on a missing client.
>
> An initial migration is already committed
> (`packages/db/prisma/migrations/20260924000000_init`), generated from the schema with
> `prisma migrate diff`. If you have no local Postgres to run `migrate dev` against, apply
> it with `npm run db:deploy` (it uses `DATABASE_URL_UNPOOLED`) and skip `db:migrate`.

```bash
# 3. Give yourself a password (the seed intentionally creates users without one)
npm run user:password -w @whitehouse/api -- \
  --email admin@whitehouse.example --password 'choose-something-long'

# 4. Run both apps
npm run dev                   # API on :4000, web on :5173
```

Sign in at <http://localhost:5173> as `admin@whitehouse.example`. The other seeded
accounts are `engineer@whitehouse.example` and `readonly@whitehouse.example` — useful for
confirming that gating actually hides what a role may not do.

`CLOUD_PROVIDER=mock` is the default, so **no AWS credentials are needed**: the mock
driver produces deterministic identities, permission probes and cost data derived from
the account ID. Flip it to `aws` when you have a management account.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Builds the workspace packages, then runs the API and web app together |
| `npm run build` | Packages → API → web production build |
| `npm run typecheck` | `tsc -b` over packages + API, then the web typecheck |
| `npm run lint` / `npm run lint:fix` | ESLint (flat config, typescript-eslint) |
| `npm run test` / `npm run test:watch` | Vitest (Node environment; logic tests) |
| `npm run db:generate` | Prisma client → `packages/db/generated/prisma` |
| `npm run db:migrate` / `npm run db:deploy` | Migrate in development / apply migrations in CI or production |
| `npm run db:seed` | Idempotent demo data |
| `npm run user:create -w @whitehouse/api -- --email … --name … --role ENGINEER` | Add an admin |
| `npm run user:password -w @whitehouse/api -- --email … --password …` | Set/reset a password and revoke that user's sessions |

---

## How the important pieces work

### Cross-account access (no customer credentials, ever)

Each tenant gets a **per-tenant `ExternalId`** (32 hex chars, generated at creation,
never rotated silently) and two roles created by a CloudFormation template the customer
deploys in their own account:

- `WhitehouseCloudGuard-ReadOnly` — inventory, cost, compliance reads
- `WhitehouseCloudGuard-Operator` — CloudFormation/Service Catalog provisioning, Config rules

The trust policy pins the MSP management account **and** an `sts:ExternalId` condition,
the standard confused-deputy protection: knowing a customer's account ID is not enough to
assume the role. Action lists are explicit rather than `*`, so a customer security review
has something concrete to read.

`StsAssumeRoleProvider` caches temporary credentials **in memory only**, keyed by
`roleArn::externalId`, refreshing 5 minutes before expiry. Nothing about a customer's
credentials is written to disk or to the database. The wizard's Test Connection passes
`forceRefresh`, so a success is always a live STS round trip rather than a cache hit, and
`GetCallerIdentity` runs with the assumed session to prove it is usable.

Every AWS client is created in `packages/aws-sdk-wrapper/src/clients.ts`, which makes
"did we go through STS?" a question you answer by reading one file.

### Jobs (retryable, visible)

Anything touching a customer account is queued. `JobQueue` has two drivers:

- `pg-boss` — durable, Postgres-backed; the default
- `memory` — in-process, for tests and laptops with no database; it warns loudly at
  startup because queued work does not survive a restart

Both mirror lifecycle into the `job_runs` table, so retries and failures are visible in
the console instead of only in logs. A queue failure at boot does **not** stop the API
from serving — it logs an error, and `/readyz` keeps reporting the real database state.

### Cost data (never called inline)

The Cost Explorer API is **billed per request**, so a dashboard that called it on page
load would quietly bill you on every refresh:

- `cost_snapshots` caches one row per tenant per period (unique on
  `tenantId + periodStart + periodEnd + granularity`);
- only the `cost.refresh-snapshot` job writes to it — daily from the scheduler, or on
  demand via `POST /tenants/:id/cost/refresh`;
- every read path (dashboard, tenant list) reads Postgres and shows the snapshot's age.

### Onboarding workflow state

Tenant status is a real state machine, so a half-onboarded tenant stays visible:

```
NOT_STARTED ──▶ TEMPLATE_SENT ──▶ AWAITING_VERIFICATION ──▶ ACTIVE
                     ▲                      │
                     └──────────────────────┘   (re-send / role re-created)
```

Activation is only reachable from `AWAITING_VERIFICATION`, i.e. after a successful
`AssumeRole` — enforced independently by the state machine (`onboarding-state.ts`, unit
tested) and by the governance service, which refuses to activate a tenant with no
`lastVerifiedAt`.

The wizard's "has a template been generated?" and "when did we last prove access?"
questions are answered from the append-only `audit_logs` table rather than duplicated into
mutable tenant columns; the tenant row keeps only durable outcomes (`status`,
`lastVerifiedAt`).

### Auth

- Passwords: **Argon2id** via `@node-rs/argon2` (prebuilt native binding, so container
  builds need no C toolchain), OWASP baseline parameters (19 MiB, t=2, p=1).
- Sessions: opaque 32-byte token in an HTTP-only cookie; only its **HMAC-SHA256 digest**
  is stored, so a database dump yields no usable sessions.
- Magic links: single-use (`consumedAt` stamped atomically), newest link invalidates older
  ones, and requesting a link for an unknown address returns the same `202` as for a known
  one (no account enumeration).
- Cookies are `SameSite=None; Secure` in production because the web app and API are on
  different hosts on the free tier — the config loader **refuses to boot** on
  `SameSite=None` without `Secure`, which otherwise presents as "login succeeds but I'm
  still logged out".
- `INTERNAL_CRON_SECRET` is refused when unset, so the scheduler endpoint cannot be left
  accidentally open.

### Multi-tenancy

Every tenant-owned table carries `tenantId` and is indexed on it. Catalogue tables
(`users`, `guardrails`, `scp_policies`, `catalog_templates`) are MSP-global by design.
Row-level enforcement will follow via Postgres RLS when a second MSP uses the platform;
today the API is the enforcement point.

---

## API surface

All routes are under `/api/v1` except the health probes. Every non-auth route requires a
session **and** a permission; the permission map lives in `packages/shared/src/rbac.ts`
and is the same one the UI uses to hide controls.

| Method | Route | Permission |
| --- | --- | --- |
| `GET` | `/healthz`, `/readyz` | none (public probes) |
| `POST` | `/auth/login` | none (rate limited 10/min) |
| `POST` | `/auth/magic-link`, `/auth/magic-link/consume` | none (rate limited 5/5min, 20/5min) |
| `GET` | `/auth/me` | session |
| `POST` | `/auth/logout` | session |
| `GET` `POST` | `/tenants` | `tenant:read` / `tenant:write` |
| `GET` `PATCH` | `/tenants/:id` | `tenant:read` / `tenant:write` |
| `GET` | `/tenants/:id/cost` | `cost:read` |
| `POST` | `/tenants/:id/cost/refresh` | `cost:refresh` |
| `GET` | `/tenants/:id/onboarding` | `tenant:read` |
| `POST` | `/tenants/:id/onboarding/template` | `onboarding:run` |
| `POST` | `/tenants/:id/onboarding/delivery` | `onboarding:run` |
| `POST` | `/tenants/:id/onboarding/verify` | `onboarding:run` |
| `POST` | `/tenants/:id/onboarding/governance` | `onboarding:run` |
| `GET` | `/guardrails`, `/guardrails/compliance`, `/scp-policies` | `guardrail:read` |
| `GET` | `/tenants/:id/guardrails`, `/tenants/:id/compliance` | `guardrail:read` |
| `GET` | `/catalog/templates`, `/catalog/templates/:key/versions` | `template:read` |
| `GET` | `/tenants/:id/catalog` | `template:read` |
| `POST` | `/tenants/:id/catalog/deploy` | `template:deploy` |
| `GET` | `/dashboard/summary`, `/jobs` | `tenant:read`, `audit:read` |
| `POST` | `/jobs/run-daily` | `job:run` |
| `GET` | `/audit` | `audit:read` |
| `POST` | `/internal/jobs/run-daily` | `x-cron-secret` header (GitHub Actions) |

Errors always use one envelope, so the web app never has to guess:

```json
{ "error": { "code": "TENANT_NOT_READY", "message": "…", "details": {} } }
```

---

## Deployment (Phase 1, free tier)

**Database — Neon.** Create a project, then copy *both* connection strings into the API's
environment: `DATABASE_URL` (pooled, has `-pooler` in the host) for the application and
`DATABASE_URL_UNPOOLED` (direct) for migrations. Run `npm run db:deploy` against the
direct URL from CI or locally.

**API — Render.** Create the service **from the repository root**: leave *Root
Directory* **blank**. Setting it to `apps/api` is the mistake to avoid — `npm run`
resolves scripts inside that workspace, and the build scripts live at the root.

| Setting | Value |
| --- | --- |
| Root Directory | *(blank — repo root)* |
| Build Command | `npm ci --include=dev && npm run build:api` |
| Start Command | `npm run start:api` |
| Health Check Path | `/healthz` |
| Instance Type | Free |

`--include=dev` matters: if you set `NODE_ENV=production` as a service environment
variable, plain `npm ci` omits devDependencies and the build loses `prisma`, `tsx` and
`typescript`. Runtime variables (`NODE_ENV=production`, `SESSION_COOKIE_SAME_SITE=none`,
`SESSION_COOKIE_SECURE=true`, `CORS_ORIGINS`, DATABASE_URL, …) all come from
`.env.example`.

Apply the committed migration once, from your machine or a Render shell:

```bash
npm run db:deploy      # uses DATABASE_URL_UNPOOLED
npm run db:seed
```

**Web — Vercel.** Also deploy from the repository root, because the web app imports
`@whitehouse/shared`, which npm only links when the workspace root is installed.

| Setting | Value |
| --- | --- |
| Root Directory | *(blank — repo root)* |
| Framework Preset | Vite |
| Build Command | `npm run build:web` |
| Output Directory | `apps/web/dist` |
| Environment | `VITE_API_BASE_URL=https://<your-api>.onrender.com` |

The API's `CORS_ORIGINS` must then contain the Vercel origin exactly — credentialed CORS
requests cannot use a wildcard.

**Email — Resend.** Set `EMAIL_DRIVER=resend`, `RESEND_API_KEY`, and a verified
`EMAIL_FROM`. Until then `EMAIL_DRIVER=console` logs the message and the onboarding email
is still recorded as delivered — which is how the wizard stays testable without a domain.

**Creating the first admin on a deployed instance.** Migrations create tables, not
users — a freshly deployed API has no accounts, so the login screen has nothing to
authenticate against. Create one from your machine, pointing at the *same* database the
deployed API uses:

```bash
# DATABASE_URL in your local .env must be the deployed Neon database
npm run user:create -w @whitehouse/api -- \
  --email you@yourmsp.example --name "Your Name" --role SUPER_ADMIN
npm run user:password -w @whitehouse/api -- \
  --email you@yourmsp.example --password 'a-long-password-here'
```

The account appears immediately in the deployed console (same database), and you can keep
signing in from a laptop regardless of what the API is hosted on. `npm run db:status`
prints which accounts exist and whether their password is set.

**Scheduled jobs — GitHub Actions.** Add `API_BASE_URL` and `INTERNAL_CRON_SECRET` as
repository secrets; `.github/workflows/scheduled-jobs.yml` runs daily at 06:15 UTC. The
workflow retries the wake-up call first, because the free web service spins down.

### Troubleshooting deploys

| Symptom | Cause and fix |
| --- | --- |
| Sign-in fails with **"Failed to fetch"** | The request never reached the API — `fetch` reports a refused connection, a DNS failure and a CORS rejection identically. Most often the API is simply not running: with `VITE_API_BASE_URL` empty the app calls its own origin and Vite proxies `/api` to `API_BASE_URL` (default `http://localhost:4000`). Start everything with `npm run dev`, or set `VITE_API_BASE_URL`. On a *deployed* web app the same symptom means `VITE_API_BASE_URL` was not set when it was built. A Render cold start now reports "did not respond within 60 seconds" instead. |
| `.env` shows up as tracked in git / a secret was committed | `.gitignore` does **not** untrack an already-committed file. Run `git rm --cached .env` (the file stays on disk), then **rotate every credential it contained** — removing it from the tip does not remove it from history. CI now fails the build if an environment file or an inline connection string is ever committed. |
| `TS2307: Cannot find module '../generated/prisma'`, often accompanied by `implicitly has an 'any' type` errors in `seed.ts` | The Prisma client has not been generated. It is gitignored build output under `packages/db/generated/prisma`. Run `npm run db:generate` (the `postinstall` hook normally does this; it skips on `--omit=dev` installs). |
| `Missing script: "db:generate"` / workspace `@whitehouse/api` | The service is running from `apps/api`. `npm run` resolves scripts inside that workspace, and the build scripts live at the repository root. Set **Root Directory** to blank (repo root) or apply `render.yaml`. |
| Build fails after adding `NODE_ENV=production` | `npm ci` then skips devDependencies, so `prisma`, `tsx` and `typescript` are missing. Use `npm ci --include=dev` in the build command. |
| `/readyz` returns 503 with `backend error` / `error -> TypeError` | The API cannot reach Postgres. Check `DATABASE_URL` uses the pooler hostname and that the Neon compute is awake (free tier suspends after 5 minutes idle; `connect_timeout=15` covers the wake-up). |
| Login appears to succeed but every request is 401 | The session cookie was dropped. Cross-site cookies need `SESSION_COOKIE_SAME_SITE=none` **and** `SESSION_COOKIE_SECURE=true`; the config loader refuses to boot on `none` without `Secure` for this reason. |
| CORS error mentioning credentials | `CORS_ORIGINS` must list the exact web origin — credentialed requests cannot use `*`. |
| Onboarding email never arrives | `EMAIL_DRIVER=console` (the default) logs instead of sending. Set `EMAIL_DRIVER=resend` plus `RESEND_API_KEY` and a verified `EMAIL_FROM`. Delivery status is recorded either way. |

### Phase 2 (ECS) — why this is a config change

The API reads all configuration from the environment and has a standard `npm start`, so it
containerizes unchanged. The seams that make the migration mechanical:

| Concern | Phase 1 | Phase 2 swap point |
| --- | --- | --- |
| Auth | First-party sessions | `resolveSession` + cookie helpers → IAM Identity Center |
| Database | Neon serverless adapter | `packages/db/src/client.ts` → `@prisma/adapter-pg` for RDS |
| Email | Resend | `EmailSender` implementation → Amazon SES |
| Queue | pg-boss on Postgres | `JobQueue` implementation → SQS or BullMQ on ElastiCache |
| Schedules | GitHub Actions | EventBridge Scheduler |
| AWS creds | static keys in `.env` | ECS task role (already supported by `checkAwsCredentialAvailability`) |

---

## Known advisories (reviewed, not reachable at runtime)

`npm audit` reports **4 high** findings, all in Prisma 7's CLI toolchain. They are not
fixed here on purpose — the fix requires forcing versions that Prisma exact-pins, and one
of them is a **major** bump inside the config loader that `prisma migrate deploy` depends
on and that cannot be regression-tested without a database.

```
prisma@7.10.0        → mysql2@3.15.3        (exact pin)
  └ MySQL protocol client — this project only ever speaks Postgres
@prisma/config@7.10.0 → deepmerge-ts@7.1.5  (exact pin, advisory <8.0.0)
prisma, @prisma/config                       (inherited from the two above)
```

Why this is safe to defer, with evidence rather than assertion:

- The vulnerable packages are **never loaded by the server**. Verified against the built
  output: after `require('@whitehouse/db')`, `require.cache` contains
  `@prisma/adapter-neon` but **no** `mysql2` and **no** `node_modules/prisma/`. The CLI
  runs only during build (`prisma generate`) and migration.
- `mysql2` is only reachable through Prisma's MySQL connector. Every connection this
  project makes is Postgres via the Neon adapter.
- The `deepmerge-ts` advisory is stack exhaustion when merging recursive object graphs.
  It processes `packages/db/prisma.config.ts`, a file this repository authors.
- `prisma` and `@prisma/config` appear only because their vulnerabilities are inherited
  from those two packages.

When Prisma ships patched pins, upgrade and re-run `npm audit --omit=dev` to confirm the
count reaches zero. If you would rather clear the audit now, add

```json
"overrides": { "mysql2": "^3.24.4", "deepmerge-ts": "^8.0.2" }
```

to the root `package.json` **and delete `package-lock.json` before reinstalling** — npm
will not re-resolve the exact-pinned entries otherwise (they show up as `invalid` while
staying on the old version). Then re-test `prisma generate`, `prisma migrate diff`, and a
real `migrate deploy` before trusting it.

## Deliberate scope limits in Milestone 1

These are called out in the UI as well as here, because a governance tool that reports
unmeasured compliance is worse than one that admits a gap:

- **Guardrail enforcement is not implemented.** Assignments are recorded with state
  `UNKNOWN`; the scheduled `guardrail.run-checks` job writes history but does not evaluate
  live controls yet. `computeHealth` treats `UNKNOWN` as YELLOW, never as a pass.
- **Template deployment is not implemented.** `POST /tenants/:id/catalog/deploy` queues
  work whose handler records a `FAILED` deployment row explaining that nothing was created
  in the customer account.
- **No row-level security** in Postgres yet (see Multi-tenancy above).
- **Component tests** (jsdom) are not set up; the current suite covers the logic worth
  proving — CFN template construction, the onboarding state machine, the health rule, cost
  date windows, and mock-driver determinism.

## Next steps

1. Guardrail enforcement: Config rules + SCP application via the operator role, then turn
   the scheduled check into real drift detection.
2. Template provisioning through Service Catalog, with the approval workflow gating what
   becomes deployable.
3. Postgres RLS and a tenant-scoped repository layer if the platform ever serves a second MSP.
4. ECS migration per `infra/README.md`.


