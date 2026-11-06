-- Synora knowledge base: documents, chunks, embeddings (pgvector).
--
-- STATUS: proposed. NOT applied to any live Supabase project.
-- Verified only against a throwaway local Postgres (see ./tests/rls_test.sql).
--
-- Why this is not under prisma/migrations: CI asserts that migrations
-- reproduce schema.prisma. These tables are raw SQL owned by the knowledge
-- subsystem (same approach as vectordb/providers/pgvector.provider.ts).
--
-- Access model (deny by default):
--   * Lives in schema synora_kb, which Supabase does not expose through the
--     Data API unless it is added to "Exposed schemas".
--   * RLS is ENABLED and FORCED on every table.
--   * anon / authenticated get SELECT only, through policies. Writes happen
--     only through service_role (server side), which bypasses RLS.
--   * SENSITIVE documents can never have chunks or embeddings (trigger).
--   * PUBLIC_SUMMARY_ONLY documents expose only their summary, never chunks.
--
-- Embedding dimension is fixed at 1024 (BGE-M3 / multilingual-E5-large).
-- Changing the model to a different dimension needs a new column or table.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create schema if not exists synora_kb;

-- ---------------------------------------------------------------- documents
create table if not exists synora_kb.documents (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid,
  source_path    text not null,
  source_sha256  text not null,
  title          text not null,
  mime_type      text,
  language       text,
  size_bytes     bigint check (size_bytes is null or size_bytes >= 0),
  access_class   text not null
                 check (access_class in ('PUBLIC', 'PUBLIC_SUMMARY_ONLY', 'PRIVATE', 'SENSITIVE')),
  summary        text,
  tombstoned_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Same bytes ingested twice is a duplicate, not a new document.
  unique (source_sha256),
  -- A private document needs an owner, otherwise nobody could ever read it.
  check (access_class not in ('PRIVATE') or owner_id is not null),
  -- Only the summary of a summary-only document may ever be shown.
  check (access_class <> 'PUBLIC_SUMMARY_ONLY' or summary is not null)
);

-- ------------------------------------------------------------------- chunks
create table if not exists synora_kb.chunks (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references synora_kb.documents (id) on delete cascade,
  owner_id       uuid,
  access_class   text not null check (access_class in ('PUBLIC', 'PRIVATE')),
  chunk_index    integer not null check (chunk_index >= 0),
  content        text not null,
  content_sha256 text not null,
  start_offset   integer check (start_offset is null or start_offset >= 0),
  end_offset     integer,
  page           integer,
  location       jsonb not null default '{}'::jsonb,
  fts            tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at     timestamptz not null default now(),
  unique (document_id, chunk_index)
);

-- ---------------------------------------------------------------- embeddings
create table if not exists synora_kb.embeddings (
  chunk_id   uuid not null references synora_kb.chunks (id) on delete cascade,
  model      text not null,
  embedding  extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  primary key (chunk_id, model)
);

-- ------------------------------------------------------------------ indexes
create index if not exists documents_access_class_idx on synora_kb.documents (access_class);
create index if not exists documents_owner_idx        on synora_kb.documents (owner_id);
create index if not exists chunks_document_idx        on synora_kb.chunks (document_id);
create index if not exists chunks_access_owner_idx    on synora_kb.chunks (access_class, owner_id);
create index if not exists chunks_fts_idx             on synora_kb.chunks using gin (fts);
create index if not exists embeddings_hnsw_idx
  on synora_kb.embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- ------------------------------------------------------------------ triggers
create or replace function synora_kb.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists documents_touch on synora_kb.documents;
create trigger documents_touch before update on synora_kb.documents
  for each row execute function synora_kb.touch_updated_at();

-- Chunks inherit owner and class from their document, and SENSITIVE or
-- summary-only documents are refused outright. The caller cannot override
-- either, so a mislabelled insert cannot widen access.
create or replace function synora_kb.chunk_inherit_and_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  doc synora_kb.documents%rowtype;
begin
  select * into doc from synora_kb.documents where id = new.document_id;
  if not found then
    raise exception 'chunk refers to unknown document %', new.document_id;
  end if;
  if doc.access_class = 'SENSITIVE' then
    raise exception 'SENSITIVE documents must never be indexed (document %)', doc.id;
  end if;
  if doc.access_class = 'PUBLIC_SUMMARY_ONLY' then
    raise exception 'PUBLIC_SUMMARY_ONLY documents expose a summary only; no chunks (document %)', doc.id;
  end if;
  if doc.tombstoned_at is not null then
    raise exception 'document % is tombstoned', doc.id;
  end if;
  new.owner_id := doc.owner_id;
  new.access_class := doc.access_class;
  return new;
end $$;

drop trigger if exists chunks_inherit on synora_kb.chunks;
create trigger chunks_inherit before insert or update of document_id on synora_kb.chunks
  for each row execute function synora_kb.chunk_inherit_and_guard();

-- --------------------------------------------------------------------- RLS
alter table synora_kb.documents  enable row level security;
alter table synora_kb.chunks     enable row level security;
alter table synora_kb.embeddings enable row level security;
alter table synora_kb.documents  force row level security;
alter table synora_kb.chunks     force row level security;
alter table synora_kb.embeddings force row level security;

-- documents: public + summary-only visible to everyone; private to the owner.
drop policy if exists documents_read_anon on synora_kb.documents;
create policy documents_read_anon on synora_kb.documents
  for select to anon
  using (tombstoned_at is null and access_class in ('PUBLIC', 'PUBLIC_SUMMARY_ONLY'));

drop policy if exists documents_read_auth on synora_kb.documents;
create policy documents_read_auth on synora_kb.documents
  for select to authenticated
  using (
    tombstoned_at is null and (
      access_class in ('PUBLIC', 'PUBLIC_SUMMARY_ONLY')
      or (access_class = 'PRIVATE' and owner_id = (select auth.uid()))
    )
  );

-- chunks: public to everyone; private to the owner. Never SENSITIVE (trigger).
drop policy if exists chunks_read_anon on synora_kb.chunks;
create policy chunks_read_anon on synora_kb.chunks
  for select to anon
  using (access_class = 'PUBLIC');

drop policy if exists chunks_read_auth on synora_kb.chunks;
create policy chunks_read_auth on synora_kb.chunks
  for select to authenticated
  using (
    access_class = 'PUBLIC'
    or (access_class = 'PRIVATE' and owner_id = (select auth.uid()))
  );

-- embeddings: visible exactly when the parent chunk is visible (chunk RLS
-- applies inside the subquery).
drop policy if exists embeddings_read_anon on synora_kb.embeddings;
create policy embeddings_read_anon on synora_kb.embeddings
  for select to anon
  using (exists (select 1 from synora_kb.chunks c where c.id = chunk_id));

drop policy if exists embeddings_read_auth on synora_kb.embeddings;
create policy embeddings_read_auth on synora_kb.embeddings
  for select to authenticated
  using (exists (select 1 from synora_kb.chunks c where c.id = chunk_id));

-- ------------------------------------------------------------------- grants
revoke all on schema synora_kb from public, anon, authenticated;
revoke all on all tables in schema synora_kb from public, anon, authenticated;
grant usage on schema synora_kb to anon, authenticated, service_role;
grant select on synora_kb.documents, synora_kb.chunks, synora_kb.embeddings to anon, authenticated;
grant all on all tables in schema synora_kb to service_role;

-- --------------------------------------------------------------- retrieval
-- SECURITY INVOKER on purpose: the caller's RLS decides what can be returned.
-- Note: with an HNSW index, RLS filtering happens after the index scan, so a
-- caller who can see little may get fewer than match_count rows. Raise
-- hnsw.ef_search or add a per-class partial index if that proves a problem.
create or replace function synora_kb.match_chunks(
  query_embedding extensions.vector(1024),
  match_model     text,
  match_count     integer default 8
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  source_path text,
  title       text,
  content     text,
  page        integer,
  location    jsonb,
  similarity  double precision
)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.document_id, d.source_path, d.title, c.content, c.page, c.location,
         1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from synora_kb.embeddings e
  join synora_kb.chunks c    on c.id = e.chunk_id
  join synora_kb.documents d on d.id = c.document_id
  where e.model = match_model
  order by e.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50)
$$;

revoke all on function synora_kb.match_chunks(extensions.vector, text, integer) from public;
grant execute on function synora_kb.match_chunks(extensions.vector, text, integer)
  to anon, authenticated, service_role;
