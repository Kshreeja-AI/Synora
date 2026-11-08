# READY_TO_DEPLOY — Synora pilot (2026-11-08)

**STATUS: NOT READY TO DEPLOY.** Code aur commits taiyaar hain, par branch push BLOCKED hai, isliye naye commits par CI ka koi result nahi hai. Kuch bhi deploy nahi hua.

Branch: `launch/pre-deploy-2026-11-08` (local). Push: **BLOCKED** (permission denied, workaround nahi kiya).

## WHAT CHANGED (5 alag commits, working tree ab clean)
| Commit | Kya | Label |
|---|---|---|
| `e33f9e7` chore(deps) | multer 2.5, next 15.5.28, security overrides, lockfile | IMPLEMENTED |
| `86395b8` chore(security) | gitleaks default rules ON + fingerprints `.gitleaksignore` mein (sirf fingerprints, values nahi) | IMPLEMENTED |
| `5e6652f` ci | docker smoke test ko postgres service + production boot env | IMPLEMENTED |
| `c975175` feat(backend) | STT/TTS/search adapters, free-tier chain, registration policy, body limits, `metering` fix | IMPLEMENTED |
| `afe387a` docs(launch) | launch log, privacy docs, verify scripts, blueprint/operations updates | IMPLEMENTED |

## GATES
| Gate | Result | Evidence |
|---|---|---|
| G1 backup | PARTIAL | Bundle: `git bundle verify` OK, `sha256sum -c` OK, heads SYNORA / build/capabilities-2026-11 / founder-wip. Tar: `tar -tzf` OK (44,295 entries), pehla re-hash OK, do aur re-hash `Cannot allocate memory` (read error, mismatch nahi). Tar ka `.git` hissa "changed as we read it" — git ke liye sirf bundle par bharosa. |
| G2 install | PASS | `pnpm install` exit 0, 22m57s |
| G3 type-check | FAIL (purani tree), fix NOT RE-RUN | 3x TS2741 `metering` missing. Fix ab commit `c975175` mein hai. Laptop RAM kam hone se dobara local nahi chalaya; CI par chhoda. |
| G3 lint | PASS | 0 errors, warnings only |
| G3 test | NOT VERIFIED | Pehli run `exit 124`: backend tests ko `localhost` Postgres chahiye (`synora` user auth fail) — test harness/environment issue, code failure nahi. |
| G3 build | PASS (type fix se pehle ki tree) | exit 0. Fix ke baad NOT RE-RUN. |
| G4 | PASS | `node scripts/guardrails.mjs` 8/8 PASS. Alag secret-pattern scan 44 uncommitted files par: 0 hits. Sirf tracked files guardrails scan karta hai. |
| G5 RLS test | NOT VERIFIED | Throwaway Postgres (docker maujood hai) par abhi nahi chala. |
| G6 preview + smoke | NOT VERIFIED | Koi deployment nahi hua. |
| G7 rollback target | NOT VERIFIED | Deploy hi nahi hua. |

## CI (asli result)
Remote par sirf purana run hai: `42452653532`, sha `e970de8`, **failure** — jobs docker / security / test fail, e2e skipped.
- docker: production boot gate ne `CORS_ORIGINS=http://localhost:3000` refuse kiya.
- test: wahi 3 `metering` type errors.
- security: audit step exit 1 (detail abhi nahi padhi).
Naye commits in teeno ko address karte hain, par **NOT VERIFIED** jab tak push nahi hota aur CI chalti nahi.

## WHAT WORKS / WHAT DOES NOT
- Works (LOCALLY VERIFIED, purani tree): lint, build, guardrails, bundle backup.
- Nahi chala / unknown: type-check fix, backend tests, migration drift check ("applying migrations does not reproduce schema.prisma" line CI log mein dikhi, pass/fail confirm nahi), RLS test, saari deployments.
- STT/TTS/search/RAG/vision/image/video: koi live tested endpoint nahi. Capability status mein "not configured" rehna chahiye. Hindi TTS NOT VERIFIED.

## RISKS
- Mera tar re-hash do baar memory se fail hua; ek baar pass. Backup ko "pura verified" mat maanna jab tak hash dobara na chale.
- CI par naye commits ka result abhi koi nahi.
- Uncommitted tha: `apps/backend/data/portfolio-corpus.jsonl` (67 lines, 1 public email) — ab committed. Dekh lena ki publish karna theek hai.
- Portfolio Vercel project `keshav-kumar-singh` nahi chhua gaya.

## FOUNDER ACTION
1. Branch push approve/permission do: `git push -u origin launch/pre-deploy-2026-11-08` (ya `! git push -u origin launch/pre-deploy-2026-11-08`).
2. Push ke baad CI result ka wait; fail ho toh root cause se fix.
3. Supabase dump + RLS test, Vercel/Render project banana — sirf G1–G7 pass hone ke baad.
4. Env var **names** jo set karne hain (values kabhi yahan nahi): `DATABASE_URL`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TOOL_SECRET_MASTER_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CORS_ORIGINS`, `FRONTEND_URL`, `BACKEND_URL`, `APP_STAGE`, `NEXT_PUBLIC_API_URL`, aur optional capability URLs `STT_BASE_URL`, `TTS_SELF_HOSTED_BASE_URL`, `SEARCH_SEARXNG_BASE_URL`.

## NEXT STEP
Push → CI → fix → G5 (docker Postgres) → G6/G7 → preview → production. Deployment, DNS aur live DB abhi band hain.

SYNORA_LINKS=NOT DEPLOYED (koi working URL nahi)
