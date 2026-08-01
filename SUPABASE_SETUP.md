# Synora + Supabase Remote Database Setup

## Status: ✅ 90% Complete (Awaiting Database Password)

### What's Been Configured

#### 1. Environment Variables ✅
All three environment files have been updated with Supabase credentials:

**Root `.env.local`:**
- `SUPABASE_PROJECT_REF=phxfqibekkqacscagzuc`
- `SUPABASE_URL=https://phxfqibekkqacscagzuc.supabase.co`
- `SUPABASE_ANON_KEY=<JWT token>`
- `SUPABASE_SERVICE_ROLE_KEY=<JWT token>`
- `DATABASE_URL=<PostgreSQL connection string>`

**Backend `apps/backend/.env.local`:**
- All Supabase credentials mirrored
- `DATABASE_URL` configured for connection pooler

**Frontend `apps/web/.env.local`:**
- `NEXT_PUBLIC_SUPABASE_URL` (safe to expose)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe to expose)

#### 2. Supabase CLI ✅
- `@supabase/cli` installed in backend package

#### 3. MCP Integration Ready ✅
The Supabase MCP can be connected via:
```bash
claude mcp add --scope project --transport http supabase \
  "https://mcp.supabase.com/mcp?project_ref=phxfqibekkqacscagzuc&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching"
```

### What's Needed: Database Password

To complete the setup, get your **Supabase Database Password**:

1. Go to: https://supabase.com/dashboard/project/phxfqibekkqacscagzuc/settings/database
2. Under **Connection string**, find the PostgreSQL line
3. Copy the password from: `postgresql://postgres.phxfqibekkqacscagzuc:PASSWORD@...`
4. Provide it below

Once you provide the password, I will:
1. Update `DATABASE_URL` in all three `.env.local` files
2. Run Prisma migrations on the remote database
3. Set up Supabase branch previews for feature branches
4. Verify the remote connection works
5. Commit all configuration changes

### Supabase Project Details

| Item | Value |
|------|-------|
| Project URL | https://phxfqibekkqacscagzuc.supabase.co |
| Project Ref | phxfqibekkqacscagzuc |
| Region | us-east-1 (AWS) |
| Database Host (Pooler) | aws-0-us-east-1.pooler.supabase.com |
| Database Port (Pooler) | 6543 |
| Database User | postgres |
| Database Name | postgres |

### Next Steps (After You Provide Password)

```bash
# 1. Update DATABASE_URL with password
# 2. Run migrations
pnpm run db:migrate

# 3. Verify connection
pnpm run db:generate

# 4. Run tests
pnpm run test

# 5. Build
pnpm run build

# 6. Commit and push
git add -A
git commit -m "chore: configure Supabase remote database"
git push -u origin claude/synora-ai-platform-h5q0k2
```

### Branch Preview Setup

Once authenticated to Supabase via MCP, branch previews allow:
- Each feature branch gets its own isolated database
- Automatic creation/destruction on PR open/close
- Zero production impact during development

### Files Modified

- ✅ `.env.local` - Added Supabase configuration
- ✅ `apps/backend/.env.local` - Added Supabase configuration
- ✅ `apps/web/.env.local` - Added Supabase public keys
- ⏳ Ready to update: DATABASE_URL with actual password

---

**Please provide your Supabase database password to complete the setup!**
