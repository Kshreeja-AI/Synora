# R1-b: Input Validation on Every Mutating Route

**Status:** ✅ Complete
**Master plan item:** P1-9
**Release:** 1

## What was wrong (verified from source)

`POST /api/projects`, `POST /api/documents`, and `POST /api/images/generate` destructured `req.body` with no validation. A missing required field (`name`, `title`, `content`, `prompt`) flowed straight into a Prisma `create()` and surfaced as an opaque **500** (Prisma non-null constraint violation), and a non-numeric `width`/`height` could reach the database as `NaN`. A customer-facing API returning 500 on ordinary bad input is both a poor experience and an information-disclosure and mass-assignment risk.

Compounding this: even the routes that *already* used zod (`/auth/register`, `/auth/login`) would have returned **500**, not 400, on invalid input — because `errorHandler` mapped any unrecognized `Error` (which a `ZodError` is) to 500. So the whole app had zero routes that correctly returned 400 on a validation failure.

## What changed

- `middleware/errorHandler.ts`: `ZodError` is now caught first and mapped to **400 `VALIDATION_ERROR`** with `error.flatten()` field details — no server internals leaked. This single fix makes every zod-validated route (existing and new) behave correctly.
- `routes/projects.ts`: `createProjectSchema` (name 1–200 chars, optional description ≤2000).
- `routes/documents.ts`: `createDocumentSchema` (title 1–300, content ≤1 MB, optional `format` validated against the real `DocumentFormat` enum re-exported from `@synora/database`, so it can never drift from the Prisma schema).
- `routes/images.ts`: `generateImageSchema` (prompt 1–4000, optional positive integer width/height ≤4096, optional non-empty projectId). This validation carries forward into R1-e when the placeholder generator is replaced with a real provider.

## Tests (real Postgres, real routes, real auth token)

`routes/__tests__/validation.test.ts` (12 tests): register now returns 400 (not 500) on bad email/short password; each of projects/documents/images returns 400 `VALIDATION_ERROR` on missing/invalid fields and 201 on a valid body; document format defaults to MARKDOWN; a non-numeric image width is rejected before reaching the DB; and an unauthenticated mutating request is rejected with 401 before validation even runs.

## Security / architecture / performance review

- **Security:** removes the mass-assignment surface (only whitelisted fields are read) and the 500-on-bad-input information leak; bounded string lengths cap a trivial payload-size DoS vector.
- **Architecture:** schemas are declared at the top of each route file, matching the existing `auth.ts` convention; they are plain zod objects, so R3-b can later feed the same schemas to an OpenAPI generator without rework. The `DocumentFormat` schema is sourced from the Prisma enum, keeping one source of truth.
- **Performance:** zod parsing is microseconds on these small bodies; negligible, and it runs before any database work (so invalid requests never touch Postgres).

## Verification

Backend type-check ✅ · lint 0 errors ✅ · 12/12 validation tests ✅ against live Postgres 16. Full suite + build verified in the R1 batch.
