# Synora Environment Variables Reference

**Date**: 2026-07-28
**Source of truth**: `.env.example` (109 lines), validated by a Zod schema at startup
**Commit**: `e122248`

---

## How configuration works

Synora does not read `process.env` directly in service code. All configuration flows through a typed, Zod-validated `AppConfig` loaded once at startup. **The process refuses to boot if required values are missing or invalid** — configuration errors surface immediately, not at first use.

Secrets are read through an audited `SecretsManager` that logs every access and supports multiple backends selected by stage.

```
.env / environment
        │
        ▼
   Zod schema  ──►  invalid?  ──►  process exits with a descriptive error
        │
        ▼
   AppConfig (typed, frozen)  ──►  consumed by services
        │
   SecretsManager  ──►  audited reads for sensitive values
```

---

## Stages and modes

**Stage** (`NODE_ENV`): `development` · `staging` · `production`
**Mode**: `standard` · `enterprise` · `government`

Modes tighten defaults — `government` enforces the strictest secret-handling and audit requirements. Stage controls which secret backend is used and whether HTTPS is mandatory.

---

## Root — `.env.local`

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `NODE_ENV` | Yes | enum | `development` | Runtime stage. Production enforces HTTPS and strict CORS. |
| `DATABASE_URL` | Yes | URL | — | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/synora` |
| `NEXTAUTH_SECRET` | Yes | string ≥32 | — | Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | URL | `http://localhost:3000` | Public frontend origin. |
| `BACKEND_URL` | Yes | URL | `http://localhost:3001` | Backend origin used by the web app for server-side calls. |

---

## Backend — `apps/backend/.env.local`

### Core

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `NODE_ENV` | Yes | enum | `development` | Runtime stage. |
| `PORT` | No | number | `3001` | HTTP listen port. |
| `DATABASE_URL` | Yes | URL | — | PostgreSQL connection string. |
| `JWT_SECRET` | Yes | string ≥32 | — | Signs access tokens. Generate: `openssl rand -base64 32`. **Rotating this invalidates all sessions.** |

### Authentication and sessions

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `JWT_ACCESS_EXPIRY` | No | duration | `15m` | Access token lifetime. Keep short — refresh tokens cover longevity. |
| `JWT_REFRESH_EXPIRY` | No | duration | `7d` | Refresh token lifetime. |
| `LOGIN_MAX_ATTEMPTS` | No | number | `5` | Failed logins before lockout. |
| `LOGIN_LOCKOUT_DURATION` | No | duration | `15m` | Lockout window after threshold. |

### CORS and transport

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `CORS_ORIGINS` | Yes (prod) | CSV | `http://localhost:3000` | Allowed origins. **Never use `*` in production.** |
| `FORCE_HTTPS` | No | boolean | `true` in prod | Redirects HTTP to HTTPS. |

### AI providers

All provider keys are optional individually — the capability resolver selects among whichever are configured. **At least one must be present** for AI features to function.

| Variable | Provider | Notes |
|----------|----------|-------|
| `ANTHROPIC_API_KEY` | Anthropic | Claude models |
| `OPENAI_API_KEY` | OpenAI | GPT models |
| `GOOGLE_AI_API_KEY` | Google | Gemini models |
| `MISTRAL_API_KEY` | Mistral | — |
| `COHERE_API_KEY` | Cohere | — |
| `REPLICATE_API_TOKEN` | Replicate | Image/video |
| `STABILITY_API_KEY` | Stability AI | Image generation |
| `ELEVENLABS_API_KEY` | ElevenLabs | Audio synthesis |
| `AI_DEFAULT_PROVIDER` | — | Preferred provider when several satisfy a capability |
| `AI_DEV_RUNTIME` | — | `record` / `replay` / `off`. Enables deterministic cassettes in development. |

### Storage

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `STORAGE_BACKEND` | No | enum | `local` | `local` · `s3` |
| `S3_BUCKET` | If S3 | string | — | Bucket name. |
| `S3_REGION` | If S3 | string | — | AWS region. |
| `S3_ACCESS_KEY_ID` | If S3 | string | — | Credential. |
| `S3_SECRET_ACCESS_KEY` | If S3 | string | — | Credential. |
| `LOCAL_STORAGE_PATH` | If local | path | `./uploads` | Filesystem path for local backend. |

### Mail

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `MAIL_BACKEND` | No | enum | `console` | `console` · `smtp`. Console logs instead of sending — development only. |
| `SMTP_HOST` | If SMTP | string | — | — |
| `SMTP_PORT` | If SMTP | number | `587` | — |
| `SMTP_USER` | If SMTP | string | — | — |
| `SMTP_PASSWORD` | If SMTP | string | — | — |
| `MAIL_FROM` | If SMTP | email | — | Sender address on transactional mail. |

### Billing

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `STRIPE_SECRET_KEY` | If billing | string | — | Stripe API key. |
| `STRIPE_WEBHOOK_SECRET` | If billing | string | — | Verifies webhook signatures. **Required if webhooks are enabled** — without it, forged webhooks are accepted. |
| `STRIPE_PRICE_ID_*` | If billing | string | — | Price identifiers per plan tier. |

### Secrets management

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `SECRETS_BACKEND` | No | enum | `env` | `env` · `file` · `hsm` (stub). |
| `SECRETS_AUDIT_ENABLED` | No | boolean | `true` | Logs every secret read. |
| `SYNORA_MODE` | No | enum | `standard` | `standard` · `enterprise` · `government`. |

### Observability

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `LOG_LEVEL` | No | enum | `info` | `error` · `warn` · `info` · `debug` |
| `LOG_FORMAT` | No | enum | `json` in prod | `json` · `pretty` |

---

## Web — `apps/web/.env.local`

| Variable | Required | Type | Default | Description |
|----------|:--------:|------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | URL | `http://localhost:3001` | Backend origin. **Public — visible in the browser bundle. Never place a secret in a `NEXT_PUBLIC_*` variable.** |
| `NEXTAUTH_SECRET` | Yes | string ≥32 | — | Must match the root value. |
| `NEXTAUTH_URL` | Yes | URL | `http://localhost:3000` | Public frontend origin. |

---

## Production checklist

Before deploying, confirm every item:

- [ ] `NODE_ENV=production` on both apps
- [ ] `JWT_SECRET` and `NEXTAUTH_SECRET` are freshly generated, ≥32 bytes, and **different from every non-production environment**
- [ ] `DATABASE_URL` points at the production database with TLS enabled
- [ ] `CORS_ORIGINS` lists exact production origins — no wildcard, no localhost
- [ ] `FORCE_HTTPS=true`
- [ ] At least one AI provider key is present
- [ ] `AI_DEV_RUNTIME` is unset or `off` — cassette replay must never run in production
- [ ] `MAIL_BACKEND=smtp` with working credentials — `console` silently drops all mail
- [ ] `STRIPE_WEBHOOK_SECRET` is set if billing webhooks are enabled
- [ ] `STORAGE_BACKEND=s3` with valid credentials (local storage does not survive container restarts)
- [ ] `LOG_FORMAT=json` for log aggregation
- [ ] No `.env` file is committed — verify with `git status` before every deploy

---

## Secret rotation

| Secret | Effect of rotation | Procedure |
|--------|-------------------|-----------|
| `JWT_SECRET` | All sessions invalidated; every user logged out | Rotate during a maintenance window, or implement dual-key verification first |
| `NEXTAUTH_SECRET` | Frontend sessions invalidated | Rotate with `JWT_SECRET` |
| AI provider keys | No user impact | Rotate freely; requests use the new key immediately |
| `STRIPE_SECRET_KEY` | No user impact | Rotate in Stripe, then update |
| `STRIPE_WEBHOOK_SECRET` | In-flight webhooks rejected | Update Stripe endpoint and app together |
| S3 credentials | No user impact if permissions match | Rotate freely |

---

## Anti-patterns

**Never**:
- Put a secret in any `NEXT_PUBLIC_*` variable — it ships in the browser bundle
- Set `CORS_ORIGINS=*` in production
- Reuse development secrets in production
- Commit a `.env` file
- Leave `MAIL_BACKEND=console` in production — mail is silently discarded
- Leave `AI_DEV_RUNTIME=replay` in production — users receive canned responses
- Use `STORAGE_BACKEND=local` on ephemeral infrastructure — uploads vanish on restart
