# R1-g: Secret Hygiene + Blocking CI Security Gates

**Status:** ✅ Complete
**Master plan items:** P0-12, P1-10
**Release:** 1

## What was wrong (verified)

- **CI could not fail on a vulnerability.** The only security step was Snyk with `continue-on-error: true` — a critical CVE produced a green check. And Snyk requires `SNYK_TOKEN`, so a fresh clone with no account had no security gate at all.
- **No secret scanning** — nothing detected accidentally committed credentials.
- A real audit at the time of this work found, in the dependency tree: 1 critical + 1 high in **dev-only** tooling (vitest UI, vite — never shipped) and **1 high in production** (`sharp <0.35.0` via Next.js image optimization).

Secret hygiene itself was already clean: `git ls-files` shows no tracked `.env`/secret files (the local `.env.staging` is untracked and gitignored; the only match is `docker-compose.secrets.example.yml`, an example template with no real values).

## What changed

- **Fixed the production high:** added a pnpm override forcing `sharp >=0.35.0` (patched libvips CVEs). Verified the web build still succeeds with the patched version. Production audit at high+ is now clean (exit 0; one moderate remains, below the gate threshold).
- **Blocking, token-free vulnerability gate:** CI `security` job now runs `pnpm audit --prod --audit-level=high` as a **blocking** step. It fails the build on any high/critical vulnerability in dependencies that actually ship to production, and needs no account or token — so it protects every deploy out of the box. Dev-only tooling is excluded via `--prod` (it never reaches a customer), so the gate signals real risk instead of crying wolf on test tooling.
- **Blocking secret scan:** added `gitleaks` to the `security` job (fails on detected secret material in tree or history), with `fetch-depth: 0` so it can inspect full history.
- **Snyk kept as best-effort:** remains `continue-on-error: true` because it needs a token; it is now a bonus layer on top of two token-free blocking gates, not the only (broken) gate.

## Why `--prod` and not all deps

The critical (vitest UI arbitrary-file-read) and one high (vite fs.deny bypass) are in **development/test tooling** that is pruned out of the production image (`pnpm prune --prod` in the Dockerfile) and never runs in front of a customer. Gating the *build* on dev-tool advisories would block shipping on issues that have no production exposure, training everyone to ignore the gate. The production audit is the honest signal for "is what we ship to customers safe." The dev-tool advisories are real but lower-priority and tracked for routine dependency upkeep, not treated as launch blockers.

## Verification

- `pnpm audit --prod --audit-level=high` → exit 0 (clean at high+) after the sharp override.
- Web build succeeds with `sharp >=0.35.0`.
- Full `test:coverage` (176 backend + 1 web) still green after the lockfile change.
- The two new CI gates (`pnpm audit --prod`, gitleaks) run on the next push; both are blocking.

## Security / architecture / performance review

- **Security:** two token-free blocking gates (dependency vulns + secret leakage) now protect every deploy; a critical/high production CVE or a committed secret will fail CI. Fixed a real shipping high (sharp).
- **Architecture:** the gate scope (`--prod`) matches the deploy scope (pruned prod image), keeping the signal honest.
- **Performance:** CI-only; no runtime impact.
