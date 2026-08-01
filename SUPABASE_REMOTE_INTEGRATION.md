# Synora + Supabase Remote Database Integration

## ✅ Status: Configuration Complete — Ready for Local Migrations

This document summarizes the Supabase remote database setup for Synora. All configuration has been completed, and you're ready to run migrations on your local machine.

---

## What's Been Configured

### 1. **Environment Variables** ✅

All three environment files have been updated with Supabase credentials:

- **`.env.local`** (Root)
  - Supabase project URL, anon key, service role key
  - Remote PostgreSQL connection string via connection pooler
  
- **`apps/backend/.env.local`**
  - Mirrors root environment for backend server
  
- **`apps/web/.env.local`**
  - Public Supabase URL and anon key (safe to expose to client)

### 2. **Supabase Project Details**

| Property | Value |
|----------|-------|
| **Project URL** | https://phxfqibekkqacscagzuc.supabase.co |
| **Project Ref** | phxfqibekkqacscagzuc |
| **Region** | us-east-1 (AWS) |
| **Database User** | postgres |
| **Database** | postgres |
| **Connection Pooler** | aws-0-us-east-1.pooler.supabase.com:6543 |
| **Direct Connection** | aws-0-us-east-1.db.supabase.co:5432 |

### 3. **Supabase CLI Installed** ✅

- `@supabase/cli` added to backend package
- Ready for branch previews and local development

### 4. **MCP Integration Ready** ✅

The Supabase MCP can be activated via:

```bash
claude mcp add --scope project --transport http supabase \
  "https://mcp.supabase.com/mcp?project_ref=phxfqibekkqacscagzuc&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching"
```

With Access Token: `sbp_60a2fc231ccd9f5886aa27a65d7e659484324d49`

---

## Next Steps: Local Migration & Setup

### **Why Local?**
This remote environment has network restrictions preventing direct PostgreSQL connections. Migrations must run from your local machine with full database access.

### **Option 1: Automated Script** (Recommended)

```bash
# From repo root
bash SUPABASE_LOCAL_SETUP.sh
```

This script:
1. ✅ Generates Prisma types
2. ✅ Runs migrations on remote database
3. ✅ Optionally links to Supabase for branch previews
4. ✅ Verifies connection

### **Option 2: Manual Steps**

```bash
# 1. Load environment
set -a && source .env.local && set +a

# 2. Generate Prisma Client
pnpm run db:generate

# 3. Run migrations
pnpm run db:migrate

# 4. Link to Supabase (for branch previews)
supabase link --project-ref phxfqibekkqacscagzuc

# 5. Verify
pnpm run db:generate
```

---

## Branch Previews (Optional)

Once linked via `supabase link`, branch previews allow:

- **Automatic DB clones** for each PR
- **Isolated testing** without affecting production
- **Zero configuration** — Supabase handles setup/teardown

To enable:

```bash
supabase link --project-ref phxfqibekkqacscagzuc
supabase branches create --display-name="My Feature"
```

---

## Verification

After running migrations locally, verify everything works:

```bash
# 1. Check connection
pnpm run db:generate

# 2. Run tests
pnpm run test

# 3. Start development server
pnpm run dev

# 4. Verify data in Supabase dashboard
# https://supabase.com/dashboard/project/phxfqibekkqacscagzuc/editor
```

---

## Files Modified

| File | Status | Notes |
|------|--------|-------|
| `.env.local` | ✅ Created | Contains Supabase connection string (git-ignored) |
| `apps/backend/.env.local` | ✅ Created | Backend server configuration (git-ignored) |
| `apps/web/.env.local` | ✅ Created | Frontend configuration (git-ignored) |
| `apps/backend/package.json` | ✅ Updated | Added @supabase/cli |
| `SUPABASE_SETUP.md` | ✅ Created | Detailed setup guide |
| `SUPABASE_LOCAL_SETUP.sh` | ✅ Created | Automated migration script |
| `SUPABASE_REMOTE_INTEGRATION.md` | ✅ Created | This file |

---

## Security Notes

⚠️ **Never commit `.env.local` files** — they contain:
- Database password
- JWT authentication keys
- Service role credentials

These files are already in `.gitignore`. Keep them locally only.

✅ **Safe to commit:**
- Schema changes in `packages/database/prisma/schema.prisma`
- Migration files in `packages/database/prisma/migrations/`
- Public configuration in code

---

## Troubleshooting

### "Can't reach database server"
- Ensure `.env.local` has correct DATABASE_URL
- Verify Supabase project is active: https://supabase.com/dashboard/project/phxfqibekkqacscagzuc/settings/general
- Check firewall/IP restrictions in Supabase dashboard

### "Environment variable not found: DATABASE_URL"
- Run `set -a && source .env.local && set +a` before commands
- Or use the provided script: `bash SUPABASE_LOCAL_SETUP.sh`

### Connection pooler timeout
- Try direct connection (port 5432) instead of pooler (port 6543)
- Edit DATABASE_URL: change `6543` to `5432`

### "Supabase CLI not found"
- Install: `npm install -g @supabase/cli`
- Verify: `supabase --version`

---

## Support

- **Supabase Documentation**: https://supabase.com/docs
- **Synora Architecture**: See `docs/architecture.md`
- **Database Schema**: See `packages/database/prisma/schema.prisma`

---

## Commit & Push

Once migrations are complete locally:

```bash
# Add configuration files (everything except .env.local)
git add SUPABASE_*.md SUPABASE_*.sh apps/backend/package.json pnpm-lock.yaml

# Commit
git commit -m "chore: configure Supabase remote database with branch preview support

- Add Supabase project credentials to environment configuration
- Install @supabase/cli for branch management
- Add automated migration script for local setup
- Document remote database integration and branch preview workflow"

# Push to feature branch
git push -u origin claude/synora-ai-platform-h5q0k2
```

---

**Status**: ✅ Ready for local setup and migrations
**Next**: Run `bash SUPABASE_LOCAL_SETUP.sh` on your machine
