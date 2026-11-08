# LAUNCH LOG (no secrets in this file)
Status words: IMPLEMENTED, TESTED, LOCALLY VERIFIED, INTEGRATION VERIFIED, PRODUCTION VERIFIED, NOT VERIFIED, BLOCKED.

## 2026-11-08
- Step 1: old Supabase PAT -> API returned HTTP 401 (revoked). .gitleaksignore added. VERIFIED (integration).
- Step 2: public.rls_auto_enable() = Supabase's standard dashboard helper (SECURITY DEFINER, owner postgres, fired by event trigger ensure_rls on ddl_command_end). Not in repo. Existing public tables (conversation_members, conversations, message_summaries, messages) all have RLS on. Note: Prisma-created tables in public get RLS auto-enabled; backend must connect as a role that bypasses RLS (postgres/pooler user) or tables will look empty. LOCALLY VERIFIED (read-only SQL).
- Render synora-api (read-only get_service): autoDeploy=no, branch=SYNORA (OLD BRANCH, rollback target), plan=free, docker, singapore, healthCheckPath=/health. FOUNDER AMENDMENT: never trigger a Render deploy; stop at READY_TO_DEPLOY.md and wait for founder to say "deployed". Render MCP has no tool to change a service's branch -> founder step.
- Step 6 research (official pages): Cloudflare Workers AI "does not use Customer Content to train"; Groq no inference retention by default (logs <=30d, ZDR available), training statement not on page; OpenRouter no prompt storage by default; Mistral Experiment (free) plan: API requests MAY be used for training (opt-out in Admin Console); Google AI Studio unpaid tier: content used to improve products + human review; SambaNova: forum post says not stored/trained, ToS not verified.
