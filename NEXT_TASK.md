# NEXT TASK — Release 2, Milestone 6: Billing (Stripe Abstraction, Subscriptions, Plans, Credits)

**Maintenance rule:** this file always contains ONLY the exact next
development task. When a task completes (milestone gate passed: lint,
typecheck, tests, build all green → commit → push → green CI), replace
this file's content with the task named under "Next task after this one".

## Goal

Transform Synora from a free product into a subscription-based SaaS with workspace-level billing, flexible plans, usage-based credits, and a production-grade payment integration. No temporary placeholders; no hardcoded Stripe logic; provider-agnostic abstraction (Stripe is the first adapter, others swap via config only).

## Scope

1. **Provider-agnostic billing abstraction** — `src/billing/` with types, registry, resolver pattern (same as AI/mail/storage)
2. **Stripe provider** — first concrete adapter (production-ready SDK integration)
3. **Database schema** — Plan, Subscription, Invoice, PaymentMethod, WorkspaceCredits, CreditLedgerEntry, UsageRecord, ProcessedWebhookEvent
4. **Services** (6 total) — plan management, subscription lifecycle, payment methods, invoices, credits/usage, webhook processing
5. **Routes** — workspace-scoped billing operations, admin plan management, webhook endpoint (raw-body-before-json ordering)
6. **Frontend** — settings tab with plan/payment-methods/invoices/usage, admin pages, design-system Progress component
7. **Tests** — provider unit, registry, resolver, service, route, webhook, admin layers
8. **Documentation** — architecture.md, api.md, database.md, security.md, new billing.md, .env.example

## Architecture Decisions

### Provider Abstraction (Established Pattern)

Mirror the existing `src/ai/*`, `src/mail/*`, `src/storage/*` structure:
- **`types.ts`**: `BillingProvider` interface (methods: createCustomer, createCheckoutSession, updateSubscription, cancelSubscription, listInvoices, etc.), `NormalizedSubscription`/`Invoice`/`PaymentMethod`, `WebhookEvent`
- **`registry.ts`**: `BillingProviderDescriptor[]`, `getBillingProviderDescriptor(id)`
- **`resolver.ts`**: `resolveBillingProvider()` — explicit config switch (not auto-detect), reads `config.billing.provider` and `STRIPE_SECRET_KEY` via SecretsManager
- **`index.ts`**: facade exports (types, registry, resolver)
- **`providers/stripe.provider.ts`**: Stripe SDK adapter (constructor-injected client for testing)

### Critical Design Points (J1–J8 from Design Plan)

- **J1 — `isConfigured()` strictness**: `STRIPE_SECRET_KEY` is a placeholder in dev/test/qa, so `isConfigured()` must compare against `PlaceholderSecretSource.generate('STRIPE_SECRET_KEY')` exactly, not just check `!== undefined`. This is the deliberate deviation from AI-provider convention; it's load-bearing for the rest of the system.
- **J2 — no separate `BillingAccount`**: `provider`/`externalCustomerId`/`externalSubscriptionId` live directly on `Subscription` (nullable until first real interaction), not a normalized customer-identity table.
- **J3 — admin plan changes via logger, not DB table**: plan CRUD logs via `logger.info('[admin] plan ...', {...})`, not a new `PlatformAuditLog` table (that's M9 scope). `requireAdminRole` does fresh DB lookup of `User.role`, not JWT claim (refresh-token is up to 15min stale).
- **J4 — credits granted only by `invoice.paid` webhook**: never by direct route calls (prevents double-grant races).
- **J5 — M6/M7 boundary**: `recordUsage()` and `UsageRecord` table are real, tested, callable today; the first **call site** inside `ai.ts`/`images.ts` is M7 scope (not a stub).
- **J6 — invoices from local DB only**: `Invoice` table synced via webhooks, reads never call Stripe's `listInvoices` from request path (only for future admin reconciliation tools).
- **J7 — Checkout/Portal/Setup hosted sessions**: Stripe Checkout (not embedded Elements) is PCI SAQ-A and portable to future providers.
- **J8 — no charting library**: Progress bar + balance display only; charting is M9 scope.

### Workspace as Billing Unit (Established M4/M5 Pattern)

`Subscription` keys off `workspaceId`, never `userId`. Workspace OWNER (or higher) manages billing. Subscription contains one `Plan` row ref (immutable, points to current pricing definition). One `Subscription` per workspace, created transactionally when the workspace is created (pointed at `plan.service.ts#getDefaultPlan()`). No `provider`/`externalCustomerId`/`externalSubscriptionId` until first real Stripe interaction (`ensureBillingCustomer()` creates lazily).

## Database Schema

**New models:**

- `Plan` — admin-editable catalog (key, name, status ACTIVE/ARCHIVED, interval MONTH/YEAR, priceCents, creditsPerInterval, trialDays?, features JSON, isDefault, sortOrder, providerPriceIds JSON)
- `Subscription` — exactly one per workspace (workspaceId unique FK, planId FK, provider?, externalCustomerId?, externalSubscriptionId?, status, currentPeriodStart?, currentPeriodEnd?, cancelAtPeriodEnd, trialEndsAt?)
- `Invoice` — (subscriptionId FK, workspaceId FK, provider, externalInvoiceId unique, status, amountDueCents, amountPaidCents, currency, hostedInvoiceUrl?, periodStart?, periodEnd?, issuedAt, paidAt?)
- `PaymentMethod` — (subscriptionId FK, workspaceId FK, provider, externalPaymentMethodId unique, type CARD/BANK_ACCOUNT/OTHER, brand?, last4?, expiryMonth?, expiryYear?, isDefault)
- `WorkspaceCredits` — (workspaceId PK, balance Int, updatedAt)
- `CreditLedgerEntry` — (workspaceId FK, type GRANT/DEDUCTION/ADJUSTMENT/EXPIRATION/REFUND, amount signed Int, balanceAfter snapshot, reason, actorId? soft-ref, metadata?, createdAt — append-only history, never updated)
- `UsageRecord` — (workspaceId FK, userId?, capability string (mirrors AICapability), quantity Int, creditsCost Int, metadata?, createdAt)
- `ProcessedWebhookEvent` — (provider, externalEventId unique pair) for idempotency

**Extend existing models:**

- `NotificationType` enum: add `BILLING`
- `Workspace` relations: subscription, invoices, paymentMethods, creditLedger, usageRecords, credits
- `User` (new role for platform admin, distinct from workspace roles): keep existing `UserRole` enum; add `requireAdminRole` middleware

**Migration:** one new migration file `packages/database/prisma/migrations/<ts>_add_billing_system/migration.sql`

## Services (6 Files)

### `apps/backend/src/services/plan.service.ts`

- `listActivePlans()` — public (no auth, used by M2 pricing page and in-app upgrade picker)
- `getDefaultPlan()` — internal helper for workspace creation
- `getPlan(planId)`
- Admin-only (checked in route via `requireAdminRole`):
  - `createPlan(actorUserId, input)`, `updatePlan(actorUserId, planId, input)`, `archivePlan(actorUserId, planId)`, `setDefaultPlan(actorUserId, planId)`
  - Every mutation: `logger.info('[admin] plan ...', {...})` audit trail (not a DB table — see J3)

### `apps/backend/src/services/subscription.service.ts`

- `getSubscriptionForWorkspace(actorId, workspaceId)` — billing:view permission
- `ensureBillingCustomer(workspaceId): Promise<string>` — internal, lazily creates Stripe customer, persists externalCustomerId + provider
- `createCheckoutSession(actorId, workspaceId, {planId})` — billing:manage (OWNER), calls provider, records audit event
- `changePlan(actorId, workspaceId, {planId})` — billing:manage, requires existing externalSubscriptionId (404 if not), calls provider, syncs local row, notifies
- `cancelSubscription(actorId, workspaceId, {atPeriodEnd})` — billing:manage, audits, notifies
- `reactivateSubscription(actorId, workspaceId)` — billing:manage, undoes scheduled cancellation
- `createBillingPortalSession(actorId, workspaceId)` — billing:manage, `ensureBillingCustomer` first (works on free plan), returns Stripe-hosted session

### `apps/backend/src/services/paymentMethod.service.ts`

All actions require `billing:manage` (OWNER only), stricter than `billing:view`:
- `listPaymentMethods(actorId, workspaceId)`
- `createSetupSession(actorId, workspaceId)` — mode:'setup', Stripe-hosted
- `setDefaultPaymentMethod(actorId, workspaceId, paymentMethodId)` — verifies workspace ownership (404 if not, never 403)
- `removePaymentMethod(actorId, workspaceId, paymentMethodId)`

### `apps/backend/src/services/invoice.service.ts`

- `listInvoices(actorId, workspaceId, {before?})` — billing:view, reads local `Invoice` table only (never provider.listInvoices from request path — see J6)
- `getInvoice(actorId, workspaceId, invoiceId)` — billing:view

### `apps/backend/src/services/credit.service.ts`

- `getCreditBalance(actorId, workspaceId)` — billing:view
- `listCreditLedger(actorId, workspaceId, {before?})` — billing:view
- `grantCredits(actorUserId, workspaceId, {amount, reason})` — platform `UserRole.ADMIN` only (checked in route), not workspace permission, transactional insert + increment, audits with workspace audit log
- `adjustCredits(actorUserId, workspaceId, {amount, reason})` — platform admin only
- `recordUsage(workspaceId, {capability, quantity, creditsCost, userId?, metadata?})` — **no route in M6** (exported for M7+ to call), transactional insert + deduction, throws `InsufficientCreditsError` if would go negative
- `getUsageSummary(actorId, workspaceId, {from?, to?})` — billing:view, groups `UsageRecord` by capability/day, returns empty/zeroed shape today (J5)

### `apps/backend/src/services/webhook.service.ts`

`handleBillingWebhook(rawBody: Buffer, signatureHeader: string): Promise<void>`:

1. `resolveBillingProvider()` — if unconfigured, real server error (503)
2. `provider.verifyAndParseWebhookEvent()` — bad signature → 400
3. Idempotency: insert `ProcessedWebhookEvent{provider, externalEventId}` first; unique violation = already handled, return early
4. Dispatch on normalized `event.type`:
   - `checkout.completed` → sync subscription row (externalSubscriptionId, status, periods, plan)
   - `subscription.updated` → sync status/periods/plan
   - `subscription.deleted` → revert to default free plan, clear external ids (keep externalCustomerId for re-subscribe)
   - `invoice.paid` → upsert Invoice, grant credits if `plan.creditsPerInterval > 0`, send BILLING notification
   - `invoice.payment_failed` → upsert Invoice, set `PAST_DUE`, send urgent BILLING notification
   - `payment_method.attached` → upsert local PaymentMethod (first = default)
   - `payment_method.detached` → delete local row
   - anything else → normalized as 'unhandled', logged, 200 (don't treat unknown events as errors)

## Routes (4 Files)

### `apps/backend/src/routes/billing.ts`

Mounted at `app.use('/api/workspaces', billingRoutes)`, all `authMiddleware` + zod validation + try/catch:

| Method | Path | Permission | Service |
|---|---|---|---|
| GET | `/:id/billing/subscription` | billing:view | `getSubscriptionForWorkspace` |
| POST | `/:id/billing/checkout` `{planId}` | billing:manage | `createCheckoutSession` |
| PATCH | `/:id/billing/subscription` `{planId}` | billing:manage | `changePlan` |
| POST | `/:id/billing/subscription/cancel` `{atPeriodEnd}` | billing:manage | `cancelSubscription` |
| POST | `/:id/billing/subscription/reactivate` | billing:manage | `reactivateSubscription` |
| POST | `/:id/billing/portal` | billing:manage | `createBillingPortalSession` |
| GET | `/:id/billing/invoices` `?before=` | billing:view | `listInvoices` |
| GET | `/:id/billing/invoices/:invoiceId` | billing:view | `getInvoice` |
| GET | `/:id/billing/payment-methods` | billing:manage | `listPaymentMethods` |
| POST | `/:id/billing/payment-methods/setup` | billing:manage | `createSetupSession` |
| PATCH | `/:id/billing/payment-methods/:pmId` `{isDefault:true}` | billing:manage | `setDefaultPaymentMethod` |
| DELETE | `/:id/billing/payment-methods/:pmId` | billing:manage | `removePaymentMethod` |
| GET | `/:id/billing/credits` | billing:view | `getCreditBalance` |
| GET | `/:id/billing/credits/ledger` `?before=` | billing:view | `listCreditLedger` |
| GET | `/:id/billing/usage` `?from=&to=` | billing:view | `getUsageSummary` |

### `apps/backend/src/routes/billingPlans.ts`

Mounted at `app.use('/api/billing', billingPlansRoutes)`, public (no auth):

| Method | Path |
|---|---|
| GET | `/plans` |

### `apps/backend/src/routes/billingWebhook.ts`

**Mounted BEFORE `express.json()`** in `app.ts` with `express.raw({ type: 'application/json' })`:

| Method | Path |
|---|---|
| POST | `/api/billing/webhook` |

### `apps/backend/src/routes/adminBilling.ts`

Mounted at `app.use('/api/admin', adminBillingRoutes)`, all routes behind `authMiddleware` + `requireAdminRole`:

| Method | Path | Service |
|---|---|---|
| GET | `/admin/plans` | `listActivePlans` (admin variant, incl. archived) |
| POST | `/admin/plans` `{name, interval, priceCents, ...}` | `createPlan` |
| PATCH | `/admin/plans/:planId` | `updatePlan` |
| POST | `/admin/plans/:planId/archive` | `archivePlan` |
| POST | `/admin/plans/:planId/set-default` | `setDefaultPlan` |
| GET | `/admin/workspaces/:workspaceId/billing` | composed support view (subscription + credits + recent invoices) |
| POST | `/admin/workspaces/:workspaceId/credits/grant` `{amount, reason}` | `grantCredits` |
| POST | `/admin/workspaces/:workspaceId/credits/adjust` `{amount, reason}` | `adjustCredits` |

### `apps/backend/src/middleware/requireAdminRole.ts`

New middleware: checks `User.role === 'ADMIN'` via fresh DB lookup (not JWT claim). Returns 403 for non-admins.

### `apps/backend/src/app.ts` modifications

**Critical ordering:** webhook route with raw-body middleware must be mounted **before** `express.json()`:

```typescript
// Line: before app.use(express.json(...))
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api/billing/webhook', billingWebhookRoutes);

// ... existing express.json()/urlencoded middleware ...

// ... later, alongside other route mounts ...
app.use('/api/workspaces', billingRoutes);
app.use('/api/billing', billingPlansRoutes);
app.use('/api/admin', adminBillingRoutes);
```

### `packages/shared/src/utils/index.ts` addition

Add `ServiceUnavailableException extends ApiException` (code: 'SERVICE_UNAVAILABLE', status: 503). Billing services catch `BillingProviderError` and rethrow as `new ServiceUnavailableException(...)`.

### `apps/backend/src/services/permissions.ts` extension

Add to `ROLE_PERMISSIONS` map:
- `billing:view` — VIEWER and above can see billing info
- `billing:manage` — OWNER only can manage subscriptions/payment methods

## Frontend

### Design System Addition

**`packages/design-system/src/components/Progress.tsx`** — Radix `@radix-ui/react-progress` wrapper (new dependency), CSS-variable styled, used for credit-balance visualization.

### API Clients (`apps/web/src/lib/api/`)

- `billing.ts` — every workspace-scoped call from the routes table above, plus `listPlans()` (public)
- `adminBilling.ts` — admin table calls
- `types.ts` extended — `PlanSummary`, `SubscriptionSummary`, `InvoiceSummary`, `PaymentMethodSummary`, `CreditLedgerEntrySummary`, `UsageSummary`

### Hooks (`apps/web/src/hooks/`)

Following the actual precedent (inline `useQuery` inside pages, dedicated hooks only for cross-page queries):
- `useSubscription.ts` — dedicated (shell-wide "past due" banner candidate)
- `usePlans.ts` — dedicated (shared by marketing pricing page and in-app upgrade dialog)
- Other queries: inline `useQuery` inside page sections

### Pages

**`apps/web/src/app/dashboard/settings/billing/page.tsx`** — 4-tab `Tabs` layout:

1. **Plan tab**: current plan card, "Change plan" dialog (listPlans query), "Subscribe" (→ Stripe Checkout redirect) vs. "Change plan" (→ PATCH) branch on `subscription.externalSubscriptionId`, cancel/reactivate, "Manage billing" (→ Stripe Portal), checkout/portal redirects land on `?checkout=success|canceled` / `?portal=return`, page reads param on mount, toasts, invalidates query keys
2. **Payment methods tab**: OWNER-only actions, list/add/set-default/remove
3. **Invoices tab**: date/amount/status Badge, link to hostedInvoiceUrl
4. **Usage tab**: credit balance + Progress meter, real `EmptyState` when UsageRecord is empty (no fabricated numbers)

**`apps/web/src/app/admin/layout.tsx`**, **`admin/plans/page.tsx`**, **`admin/workspaces/[id]/billing/page.tsx`** — per §5 above, all behind `useRequireAdmin()` hook (Zustand store check + 403 redirect for non-admins).

## Tests

**Backend layers** (6 files, all integration tests via Supertest + real Postgres):

1. **`billing/providers/stripe.provider.test.ts`** — constructor-injected fake Stripe client, all interface methods, both branches of `verifyAndParseWebhookEvent` (valid/invalid signature), **critical test**: `isConfigured()` returns `false` when key is placeholder
2. **`billing/registry.test.ts`** — mirrors `mail/registry.test.ts`
3. **`billing/resolver.test.ts`** — unknown provider id, unconfigured provider → BillingProviderError
4. **`services/__tests__/plan.service.test.ts`**, **`subscription.service.test.ts`**, **`paymentMethod.service.test.ts`**, **`invoice.service.test.ts`**, **`credit.service.test.ts`** — `vi.mock('../billing', ...)` returning fake provider (zero Stripe SDK), permission/DB/audit logic, transactional invariants
5. **`routes/__tests__/billing.test.ts`** — full app + real Postgres, OWNER-only boundary enforcement (ADMIN/EDITOR/MEMBER/VIEWER get 403), `billing:view`/`billing:manage` boundary, non-member 404, **dedicated unconfigured-provider test** (no `STRIPE_SECRET_KEY`) asserting 503
6. **`routes/__tests__/billingWebhook.test.ts`** — raw-buffer POST, mocked `stripe.webhooks.constructEvent`, dedupe on replayed eventId, `invoice.paid` → credits + Notification, `invoice.payment_failed` → PAST_DUE + notification, `subscription.deleted` → free plan revert
7. **`routes/__tests__/adminBilling.test.ts`** — plan CRUD OWNER-only (403 for normal user, even workspace OWNER if not platform admin), default-plan uniqueness invariant, admin credit grant produces workspace audit log

**Frontend** (new app pages + API client tests, Vitest + Testing Library + jsdom):
- `apps/web/src/lib/api/billing.test.ts`, `adminBilling.test.ts` — typed API call mocking
- `apps/web/src/app/dashboard/settings/billing/page.test.tsx` — tabs render correctly, plan change dialog, checkout/portal redirects, usage empty state
- `apps/web/src/app/admin/layout.test.tsx`, `admin/plans/page.test.tsx`, `admin/workspaces/[id]/billing/page.test.tsx` — admin-only UX, plan CRUD, credit grant

## Security Requirements

- Workspace-scoped reads/writes require membership (404 for non-members, never 403)
- `GET /api/billing/plans` never exposes secret values, only descriptor metadata
- No new secrets introduced; `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` read via SecretsManager only
- Webhook signature verification (Stripe SDK `constructEvent` validates the raw body + signature exactly)
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` never logged
- Platform-admin role check is fresh DB lookup, not JWT claim

## Documentation Updates

- `docs/architecture.md` — new `## Billing Abstraction` section (same shape as Mailer/Storage sections), placement after Service Layer section
- `docs/api.md` — new `## Billing Endpoints` section
- `docs/database.md` — new entries for all 8 models + new enum values
- `docs/security.md` — PCI scope (raw card data never touches us — Stripe Checkout only), webhook signature verification, credentials discipline, platform-admin vs. workspace roles
- **New `docs/billing.md`** — plan catalog model, subscription lifecycle + state diagram, webhook event handling + idempotency, credits/usage model with explicit M6/M7 boundary, Stripe SDK test-mocking strategy
- `.env.example` — add `BILLING_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_DEFAULT_CURRENCY`, `BILLING_TRIAL_DAYS`
- `CURRENT_STATE.md`, `NEXT_TASK.md` (at M6 close) — updated

## Testing Requirements (Verification Gates)

All must pass before commit:

- `pnpm run lint` — ESLint clean
- `pnpm run type-check` — TypeScript strict mode, no errors
- `pnpm run test` — all tests passing (632+ total), no skipped tests
- `pnpm run build` — production build succeeds
- `docker build -t synora:latest .` — Docker image builds
- `pnpm audit --prod --audit-level=high` — no high/critical vulns
- Migration validation — `pnpm run db:migrate` succeeds locally (fresh Postgres)
- Accessibility validation — no new a11y violations

## Acceptance Criteria

- ✅ Create a workspace → it gets a free `Subscription` pointed at default Plan
- ✅ OWNER can view billing settings → see current plan, usage, payment methods
- ✅ OWNER can upgrade to a paid plan via Stripe Checkout → success redirect updates subscription
- ✅ OWNER can add payment method via Setup Session → appears in payment methods list
- ✅ OWNER can manage billing via Stripe Portal → redirects and returns gracefully
- ✅ Platform admin can create/update/archive plans → appears in public list
- ✅ Platform admin can grant workspace credits → ledger entry appears, balance updates
- ✅ Webhook: `invoice.paid` → credits granted, notification sent (if plan has creditsPerInterval)
- ✅ Webhook: `invoice.payment_failed` → subscription status PAST_DUE, urgent notification
- ✅ Webhook: `payment_method.attached` → PaymentMethod row appears, first is default
- ✅ All endpoints enforce workspace membership (404 for non-members)
- ✅ No secrets exposed in `GET /api/billing/plans`
- ✅ `GET /api/billing/usage` shows real/empty (never fabricated) data
- ✅ Browser-verified (desktop + mobile, dark + light, checkout flow, portal redirect) — screenshots
- ✅ All tests pass (backend + frontend)
- ✅ All documentation updated and consistent

## Definition of Done

1. All files created/modified per Architecture section above
2. Schema migration applied and tested locally (fresh Postgres)
3. All tests passing (lint, typecheck, test, build green)
4. Docker image builds successfully
5. Security scan passes (no new vulns)
6. Dependency audit passes (no high/critical)
7. All documentation updated
8. Commit with conventional message, push to designated branch
9. CI green (test, security, docker) on push
10. `CURRENT_STATE.md`, `NEXT_TASK.md`, `SYNORA_BRAIN.md` updated with M6 close notes

## Risks & Mitigation

- **Scope creep into M7 media**: billing is orthogonal to media generation; UsageRecord table exists but is not called from any route — M7 adds the first call sites
- **Provider swappability**: design is provider-agnostic, but Stripe's checkout/portal URLs are Stripe-specific — future providers will need equivalent hosted flows (Paddle, Chargebee, etc. all have these)
- **PCI scope**: strictly avoid raw card collection — Stripe Checkout/Setup/Portal only (no embedded payment forms in our UI)
- **Webhook replay**: replay the same event 3 times in integration test to verify ProcessedWebhookEvent idempotency works

## Things That Must Not Change

From `SYNORA_BRAIN.md` §14 (Non-Negotiable Principles):
- Auth invariants (hash-at-rest, rotation, pinned HS256)
- Provider-agnostic patterns (must extend, not rewrite)
- Workspace as org unit (not user-scoped billing)
- Milestone gate (lint → typecheck → test → build → CI → commit)
- Design tokens (no hardcoded colors)
- Secrets discipline (SecretsManager only, never process.env at call sites)

## Estimated Effort

4–5 focused engineer-days (L) — comprehensive abstraction + Stripe integration + tests + frontend + docs

## Next Task After This One

**M7 — Media Generation, Asset Manager, Uploads** (per `RELEASE_2_PLAN.md`'s renumbered scope): Redis integration, async job queue, image/video/audio generation (real provider calls via existing AI abstraction), asset storage, multipart uploads, gallery UI. Details will be written into this file when M6 closes.
