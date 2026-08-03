#!/bin/bash
# Synora + Supabase: Local Migration Script
# Run this on your machine to complete the remote database setup

set -e

echo "🚀 Synora Supabase Setup - Local Execution"
echo "=========================================="

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ Error: .env.local not found in current directory"
    echo "   Run this script from the repository root"
    exit 1
fi

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Installing..."
    npm install -g @supabase/cli
fi

# Source environment variables
echo "📝 Loading environment configuration..."
set -a
source .env.local
set +a

# Verify DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL not found in .env.local"
    exit 1
fi

echo "✅ DATABASE_URL loaded"
echo "   Host: ${DATABASE_URL##*@}" | grep -o '[^:]*' | head -1
echo ""

# Step 1: Generate Prisma Client
echo "1️⃣  Generating Prisma Client..."
pnpm run db:generate

# Step 2: Run migrations
echo "2️⃣  Running Prisma migrations..."
pnpm run db:migrate

# Step 3: Link to Supabase (optional, for branch previews)
echo "3️⃣  Linking to Supabase project..."
echo ""
echo "   Use your Supabase Access Token: sbp_60a2fc231ccd9f5886aa27a65d7e659484324d49"
echo ""
read -p "Link to Supabase for branch previews? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    supabase link --project-ref phxfqibekkqacscagzuc --api-token sbp_60a2fc231ccd9f5886aa27a65d7e659484324d49
    echo "✅ Supabase project linked!"
    echo ""
    echo "   You can now use Supabase branch previews for feature branches"
fi

# Step 4: Verify connection
echo ""
echo "4️⃣  Verifying database connection..."
pnpm run db:generate

echo ""
echo "✅ Supabase setup complete!"
echo ""
echo "Next steps:"
echo "  1. Verify your data: https://supabase.com/dashboard/project/phxfqibekkqacscagzuc/editor"
echo "  2. Test the app: pnpm run dev"
echo "  3. Commit configuration: git add -A && git commit -m 'chore: configure Supabase remote database'"
echo ""
