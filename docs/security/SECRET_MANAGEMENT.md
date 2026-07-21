# Secret Management System

Status: Active | Owner: Platform | Last Updated: 2026-07-20

This document describes how Synora stores, reads, rotates, and audits
secrets across every environment and deployment platform the project
targets, and how to add a new secret or a new secret source.

## 1. Principles

1. **Secrets never reach the frontend.** Only `NEXT_PUBLIC_*`-prefixed
   values may be read from client-side code. Everything else is read
   exclusively from `apps/backend/src/secrets` (server-only, enforced at
   runtime — see [§7](#7-frontend-exposure-prevention)).
2. **One abstraction, many sources.** Business logic calls
   `secretsManager.get('KEY')`. It never knows or cares whether the value
   came from a `.env` file, a Docker secret, a Kubernetes-mounted file, or
   a CI/CD-injected env var. Swapping the source for a key requires no
   code change outside `apps/backend/src/secrets/factory.ts`.
3. **Development never requires real secrets.** Every secret has a
   deterministic placeholder fallback in `development`/`testing`/`qa`.
   Staging and production never fall back to placeholders by default — a
   missing required secret fails startup instead — except when `MOCK_MODE`
   is explicitly enabled (see [Environment Management](../operations/ENVIRONMENT_MANAGEMENT.md)),
   which is an intentional, audited opt-in, not a silent default.
4. **Every access is audited**, without ever logging the secret's value —
   `SecretAuditEvent` has no `value` field, so leaking one through the
   audit log is a type error, not just a code-review concern.
5. **Rotation and versioning are first-class.** A secret can be rotated
   without invalidating everything issued against the previous version
   during a grace period.

## 2. Architecture

```
apps/backend/src/secrets/
├── types.ts                 SecretRecord, SecretMetadata, SecretDescriptor, SecretEnvironment
├── errors.ts                SecretNotFoundError, SecretsValidationError
├── serverOnly.ts             assertServerOnly() runtime guard
├── interfaces/
│   ├── secretSource.ts       ISecretSource — "can you read this key"
│   ├── auditLog.ts            ISecretAuditLog — no `value` field, ever
│   └── hsm.ts                  IHsmProvider — future HSM extension point
├── sources/
│   ├── envVarSource.ts         process.env — local, CI/CD, Vercel, Netlify, GitHub Actions
│   ├── dockerSecretSource.ts    /run/secrets/<KEY> file convention
│   ├── kubernetesSecretSource.ts mounted-secret-volume file convention
│   └── placeholderSource.ts      deterministic fake values, dev-only
├── audit/loggerAuditLog.ts     default audit sink (structured logs)
├── hsm/stubHsmProvider.ts       the only IHsmProvider today — throws
├── secretsManager.ts            orchestrator: versions, rotation, expiration, auditing
├── registry.ts                  SECRET_CATALOG — the source of truth for what secrets exist
├── factory.ts                    builds the default SecretsManager per environment
└── index.ts                       exports the `secretsManager` singleton
```

```mermaid
flowchart LR
    A[Route / Middleware] -->|secretsManager.get key| B[SecretsManager]
    B --> C{Current version cached?}
    C -->|yes| E[Audit: read / access-placeholder / access-expired]
    C -->|no| D[Walk source chain in order]
    D --> D1[KubernetesSecretSource]
    D --> D2[DockerSecretSource]
    D --> D3[EnvVarSecretSource]
    D --> D4[PlaceholderSecretSource]
    D -->|first hit wins| E
    E --> F[Return value to caller]
```

## 3. Environments

Deployment stage is one axis; `MOCK_MODE` is an orthogonal one — see
[Environment Management](../operations/ENVIRONMENT_MANAGEMENT.md#2-two-axes-stage-and-mode)
for the full model. For secrets specifically:

| Stage (`APP_STAGE`) | Source chain (in order) | Placeholder fallback | Missing required secret |
|---|---|---|---|
| `development` | env vars → placeholder | Yes | Warns, does not block startup |
| `testing` | env vars → placeholder | Yes | Warns, does not block startup |
| `qa` | env vars → placeholder | Yes | Warns, does not block startup |
| `staging` | Kubernetes file → Docker file → env vars (→ placeholder **only if `MOCK_MODE=true`**) | No, unless `MOCK_MODE=true` | **Fails startup** |
| `production` | Kubernetes file → Docker file → env vars (→ placeholder **only if `MOCK_MODE=true`**) | No, unless `MOCK_MODE=true` | **Fails startup** |

`APP_STAGE` is read first; if unset, `NODE_ENV` is used; if neither is
set, `development` is assumed. Set `APP_STAGE` explicitly in
staging/production — don't rely on `NODE_ENV=production` alone, since some
platforms (Vercel, Netlify) set `NODE_ENV=production` for preview
deployments too.

## 4. Platform setup

All of CI/CD, GitHub Actions, Vercel, and Netlify "secrets" are, at
runtime, plain environment variables injected before the process starts —
`EnvVarSecretSource` reads all of them the same way. What differs is how
you configure the value on each platform, described below.
`EnvVarSecretSource.detectPlatform()` auto-labels which platform injected
the value (via `VERCEL`, `NETLIFY`, `GITHUB_ACTIONS`, `CI` — all
auto-set by those platforms) purely for audit-trail clarity.

### 4.1 Development

Copy `.env.example` → `.env.local` (root), `apps/backend/.env.example` →
`apps/backend/.env.local`, `apps/web/.env.example` → `apps/web/.env.local`.
Leave secret values blank to run entirely on placeholders — the app boots
and functions end-to-end, just not against real external services. A
shared dev environment (if any) works the same way, just with `.env.local`
provisioned by whoever manages it rather than each developer individually.

### 4.2 Testing & QA

Same placeholder-fallback behavior as development — automated test suites
and QA environments should never need real credentials to run. If a QA
environment specifically needs to exercise real integrations, set the
real secret's env var (or mount it via Docker/Kubernetes) as you would for
staging; anything left unset still falls back to a placeholder rather than
failing the run.

### 4.3 CI/CD (generic)

Any CI system that injects env vars before running the pipeline works
automatically — `EnvVarSecretSource` picks them up. No special
configuration needed beyond setting the variable in the CI system's
secret store.

### 4.4 GitHub Actions

1. Repo Settings → Secrets and variables → Actions → New repository secret.
2. Reference it in a workflow as `${{ secrets.SNYK_TOKEN }}` (already done
   for `SNYK_TOKEN` in `.github/workflows/ci.yml`) — this becomes
   `process.env.SNYK_TOKEN` inside the job.
3. `GITHUB_ACTIONS=true` is set automatically by the runner, so audit
   events from a workflow run show `source: "github-actions"`.

### 4.5 Docker

Use Compose/Swarm `secrets:` — each secret becomes a file at
`/run/secrets/<name>` inside the container, which `DockerSecretSource`
reads directly (no env var needed). See
[`infrastructure/docker/docker-compose.secrets.example.yml`](../../infrastructure/docker/docker-compose.secrets.example.yml).
The secret's declared **name** must exactly match the key in
`SECRET_CATALOG` (e.g. `JWT_SECRET`), since that's the filename Docker
mounts it as.

```bash
mkdir -p infrastructure/docker/secrets
openssl rand -base64 32 > infrastructure/docker/secrets/JWT_SECRET
docker compose -f infrastructure/docker/docker-compose.secrets.example.yml up
```

### 4.6 Kubernetes

Mount a `Secret` as a volume so each key becomes a file under
`/var/run/secrets/synora/<KEY>` — see
[`infrastructure/k8s/secret.example.yaml`](../../infrastructure/k8s/secret.example.yaml).
`KubernetesSecretSource` is considered available whenever
`KUBERNETES_SERVICE_HOST` is present (auto-injected into every pod) or the
mount path exists, so it activates automatically inside a cluster without
extra configuration.

```bash
kubectl create secret generic synora-backend-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/synora"
kubectl apply -f infrastructure/k8s/secret.example.yaml
```

For anything beyond a raw `Secret` object (auto-rotation, external KMS
sync), point the same mount path at output from
[External Secrets Operator](https://external-secrets.io/) or
[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) instead —
`KubernetesSecretSource` doesn't care how the files got there.

### 4.7 Vercel

Project Settings → Environment Variables → add the key, scoped to
Preview/Production as needed. Vercel injects `VERCEL=1` automatically, so
`EnvVarSecretSource` labels these reads `source: "vercel"` in the audit
log. No `vercel.json` changes are required — this repo doesn't currently
deploy the backend to Vercel, but the same mechanism applies if it does.

### 4.8 Netlify

Site configuration → Environment variables (or `netlify env:set KEY
value`). Netlify injects `NETLIFY=true` automatically, labeled `source:
"netlify"`. See [`docs/NETLIFY_DEPLOYMENT.md`](../NETLIFY_DEPLOYMENT.md)
for the frontend deployment this repo already uses — secrets set there
follow this same convention.

## 5. Rotation

```ts
import { secretsManager } from './secrets';

const rotated = await secretsManager.rotate('JWT_SECRET', newValue);
// rotated.version === previous version + 1
```

`rotate()` appends a new version and timestamps the previous one's
`rotatedAt`; it does not delete history. `secretsManager.getVersions(key)`
returns the full ordered history, which is how
`apps/backend/src/middleware/auth.ts` verifies a JWT against every known
signing key (newest first) instead of just the current one — a token
signed moments before a rotation still validates during the grace window,
so rotating `JWT_SECRET` doesn't force every logged-in user to
re-authenticate immediately.

`rotate()` is a primitive, not a scheduler — nothing in this repo calls it
automatically yet. `SECRET_CATALOG` entries declare a `rotationDays`
policy (e.g. `JWT_SECRET` → 90 days); wiring a scheduled job (cron,
GitHub Actions on a schedule, a Kubernetes CronJob) to call `rotate()` and
push the new value to the real secret store is the next step when this
becomes operationally necessary — the abstraction is what makes that a
small addition rather than a redesign.

### Rotation runbook (manual, today)

1. Generate a new value (`openssl rand -base64 32` for symmetric keys).
2. Write it to the real store for the target environment (K8s `Secret`,
   Docker secret file, or the platform's env var UI).
3. Redeploy — the new value is picked up as version 1 of a fresh process
   (in-memory version history does not persist across restarts today; see
   [§8](#8-known-limitations)).
4. Confirm old sessions/tokens still work during the grace window, then
   revoke the old value in the underlying store once you're confident
   nothing needs it.

## 6. Versioning & expiration

- Every resolved secret carries a `version` (starts at 1, increments on
  `rotate()`) and a `createdAt`.
- If `SECRET_CATALOG` declares `rotationDays` for a key, the resolved
  record gets an `expiresAt`. `secretsManager.isExpired(key)` checks it,
  and every `get()`/`tryGet()` call logs `access-expired` instead of
  `read` once a secret is past its window — this is a signal for
  monitoring/alerting to catch overdue rotations, not a hard block (an
  expired secret still gets served; forcibly cutting access on expiry
  is out of scope until a real rotation scheduler exists).

## 7. Frontend exposure prevention

- `assertServerOnly()` (`apps/backend/src/secrets/serverOnly.ts`) throws
  the moment the secrets module graph is evaluated with `window` defined
  — a hard backstop if this package is ever accidentally imported into
  client code.
- `npm run secrets:check` (`scripts/check-no-client-secrets.mjs`) statically
  scans every `'use client'` file and `apps/web/next.config.js`'s `env`
  block for non-`NEXT_PUBLIC_*` references and fails the build if it finds
  one. Run it locally or wire it into CI as a required check.
- Convention: only `NEXT_PUBLIC_*` variables may cross into the browser
  bundle. Anything else stays inside `apps/backend` or a Next.js Server
  Component / Route Handler that never returns the raw value to the
  client.

## 8. Known limitations

- Version history is in-memory and per-process — it does not survive a
  restart or span multiple replicas. For a multi-replica deployment,
  version continuity during rotation currently depends on the underlying
  store (K8s Secret, Docker secret) being updated consistently before all
  replicas roll, not on this in-process history. A shared, persistent
  version store (backed by the eventual HSM/KMS integration, or a
  dedicated secrets service like Vault) is the natural next step.
- No automatic rotation scheduler ships today — `rotate()` is a primitive
  a human or a job you build calls.
- `LoggerAuditLog` writes to the same Winston sink as application logs.
  For production, route audit events to an append-only, access-controlled
  store (a SIEM, a dedicated audit table) by implementing `ISecretAuditLog`
  and swapping it in via `SecretsManagerOptions.auditLog`.

## 9. Future HSM integration

`apps/backend/src/secrets/interfaces/hsm.ts` defines `IHsmProvider`
(`encrypt`/`decrypt`/`sign`/`getPublicKey`) as the extension point for a
real Hardware Security Module (AWS CloudHSM, GCP Cloud KMS with HSM
protection, Azure Key Vault Managed HSM, Thales Luna, etc.).
`StubHsmProvider` is the only implementation today and throws
`HsmNotConfiguredError` on every call, by design — so any code path that
starts depending on HSM behavior fails loudly instead of silently doing
something less secure.

An HSM never returns raw key material, which is why `IHsmProvider` has no
"get the secret" method — it performs operations on-device. When one is
procured:

1. Implement `IHsmProvider` against the vendor SDK.
2. Register it where `StubHsmProvider` is constructed today.
3. Move the highest-value secrets (e.g. the JWT signing key) to be
   HSM-backed signing operations instead of an `ISecretSource`-resolved
   raw value — this is a larger change than the interface swap alone, and
   should get its own design pass when it's actually being built.

## 10. Adding a new secret

1. Add an entry to `SECRET_CATALOG` in `apps/backend/src/secrets/registry.ts`
   — key, description, owner, which environments need it, whether it's
   required, and a rotation policy if one applies.
2. Read it via `await secretsManager.get('YOUR_KEY')` (throws if missing)
   or `tryGet()` (returns `undefined` if missing) — never
   `process.env.YOUR_KEY` directly in application code.
3. Add the key to every relevant `.env.example` file, commented out with a
   placeholder-style value, so local setup docs stay accurate.
4. If it's required in staging/production, `validateRequired()` (called at
   backend startup) will now fail fast if it's missing there — verify that
   in a staging deploy before relying on it in production.

## 11. Adding a new secret source

Implement `ISecretSource` (`isAvailable()`, `read(key)`), add it to the
chain in `createSourceChain()` (`apps/backend/src/secrets/factory.ts`) at
the appropriate precedence, and it's available to every caller through
the existing `secretsManager` singleton — nothing else changes.

## 12. Incident response: a secret leaked

1. Rotate the affected secret immediately in the real store (see
   [§5](#5-rotation)) — treat the leaked value as permanently
   compromised, not just "old".
2. Redeploy every environment that used it.
3. Check `LoggerAuditLog` output (or your production audit sink once
   `ISecretAuditLog` is pointed at one) for `read`/`access-*` events on
   that key to scope how long it was in use and from where.
4. If it was a signing key (`JWT_SECRET`), consider invalidating all
   outstanding tokens rather than relying on the rotation grace window,
   since the grace window is designed for *planned* rotation, not
   compromise response.
5. If it was committed to git history, treat the repository history
   itself as compromised for that value — rotation is necessary but not
   sufficient; the old value remains recoverable from history regardless.
