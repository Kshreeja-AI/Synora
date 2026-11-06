#!/usr/bin/env bash
# Applies the KB migration to a throwaway pgvector Postgres container and runs
# the RLS assertions. Container and data are destroyed afterwards.
# Needs Docker and the pgvector/pgvector:pg16 image. Touches no live database.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SQL_DIR="$(cd "$HERE/.." && pwd)"
NAME="synora-kb-test-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Throwaway password, bound to localhost-less internal container network only.
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=throwaway-test-only \
  -v "$SQL_DIR/0001_pgvector_knowledge_base.sql:/sql/0001_pgvector_knowledge_base.sql:ro" \
  -v "$HERE/rls_test.sql:/sql/rls_test.sql:ro" \
  pgvector/pgvector:pg16 >/dev/null

for _ in $(seq 1 40); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -f /sql/rls_test.sql
