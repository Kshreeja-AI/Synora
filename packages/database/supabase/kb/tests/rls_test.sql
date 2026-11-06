-- Verifies 0001_pgvector_knowledge_base.sql against a THROWAWAY Postgres.
-- Run via ./run_local_test.sh. Never run this against a live Supabase project:
-- it creates stub roles and an auth.uid() stub.
\set ON_ERROR_STOP on
\set QUIET on

-- --- Supabase stand-ins (roles + auth.uid()) --------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

\i /sql/0001_pgvector_knowledge_base.sql
grant usage on schema extensions to anon, authenticated, service_role;

-- --- Fixtures (inserted as superuser, standing in for server-side writes) -----
create temp table ids (name text primary key, id uuid);
grant all on ids to public;

insert into synora_kb.documents (owner_id, source_path, source_sha256, title, access_class, summary) values
  (null, 'pub.md',  'sha-pub',  'Public doc',  'PUBLIC', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'privA.md', 'sha-privA', 'Private A', 'PRIVATE', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'privB.md', 'sha-privB', 'Private B', 'PRIVATE', null),
  (null, 'secret.txt', 'sha-secret', 'Sensitive', 'SENSITIVE', null),
  (null, 'sum.pdf',  'sha-sum',  'Summary only', 'PUBLIC_SUMMARY_ONLY', 'Only this summary is shareable.');

insert into ids select source_path, id from synora_kb.documents;

do $$
declare cnt int;
begin
  -- chunks for allowed documents (owner/class are inherited by the trigger)
  insert into synora_kb.chunks (document_id, chunk_index, content, content_sha256, page)
  select id, 0, 'content of ' || name, 'c-' || name, 1 from ids where name in ('pub.md', 'privA.md', 'privB.md');

  insert into synora_kb.embeddings (chunk_id, model, embedding)
  select c.id, 'test-model',
         (array_fill(0.01::real, array[1023]) || array[(row_number() over ())::real / 10])::extensions.vector(1024)
  from synora_kb.chunks c;

  select count(*) into cnt from synora_kb.embeddings;
  assert cnt = 3, 'expected 3 embeddings, got ' || cnt;
  raise notice 'PASS fixtures inserted';
end $$;

-- --- T1: SENSITIVE and summary-only documents can never be chunked ------------
do $$
declare failed boolean := false;
begin
  begin
    insert into synora_kb.chunks (document_id, chunk_index, content, content_sha256)
    select id, 0, 'leak', 'x' from ids where name = 'secret.txt';
  exception when others then failed := true; end;
  assert failed, 'SENSITIVE document was chunked';

  failed := false;
  begin
    insert into synora_kb.chunks (document_id, chunk_index, content, content_sha256)
    select id, 0, 'leak', 'x' from ids where name = 'sum.pdf';
  exception when others then failed := true; end;
  assert failed, 'PUBLIC_SUMMARY_ONLY document was chunked';
  raise notice 'PASS T1 sensitive + summary-only documents refuse chunks';
end $$;

-- --- T2: constraints ----------------------------------------------------------
do $$
declare failed boolean := false;
begin
  begin insert into synora_kb.documents (source_path, source_sha256, title, access_class)
        values ('dup.md', 'sha-pub', 'dup', 'PUBLIC');
  exception when unique_violation then failed := true; end;
  assert failed, 'duplicate sha256 accepted';

  failed := false;
  begin insert into synora_kb.documents (source_path, source_sha256, title, access_class)
        values ('orphan.md', 'sha-orphan', 'orphan', 'PRIVATE');
  exception when check_violation then failed := true; end;
  assert failed, 'PRIVATE document without owner accepted';

  failed := false;
  begin insert into synora_kb.documents (source_path, source_sha256, title, access_class)
        values ('bad.md', 'sha-bad', 'bad', 'SECRET');
  exception when check_violation then failed := true; end;
  assert failed, 'unknown access_class accepted';
  raise notice 'PASS T2 duplicate / ownerless-private / bad-class rejected';
end $$;

-- --- T3: anon sees public only ------------------------------------------------
set role anon;
do $$
declare d int; c int; e int; m int;
begin
  select count(*) into d from synora_kb.documents;   -- PUBLIC + PUBLIC_SUMMARY_ONLY
  select count(*) into c from synora_kb.chunks;      -- PUBLIC only
  select count(*) into e from synora_kb.embeddings;
  assert d = 2, 'anon documents expected 2, got ' || d;
  assert c = 1, 'anon chunks expected 1, got ' || c;
  assert e = 1, 'anon embeddings expected 1, got ' || e;
  select count(*) into m from synora_kb.match_chunks(array_fill(0.01::real, array[1024])::extensions.vector(1024), 'test-model', 10);
  assert m = 1, 'anon match_chunks expected 1, got ' || m;
  raise notice 'PASS T3 anon: 2 docs, 1 chunk, 1 embedding, match_chunks=1';
end $$;
-- anon cannot write
do $$
declare failed boolean := false;
begin
  begin insert into synora_kb.documents (source_path, source_sha256, title, access_class)
        values ('x.md', 'sha-x', 'x', 'PUBLIC');
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'anon was able to insert a document';
  raise notice 'PASS T3b anon write denied';
end $$;
reset role;

-- --- T4: authenticated owner A sees public + own private only -----------------
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$
declare c int; m int; b int;
begin
  select count(*) into c from synora_kb.chunks;
  assert c = 2, 'user A chunks expected 2, got ' || c;
  select count(*) into b from synora_kb.chunks where content like '%privB%';
  assert b = 0, 'user A can see user B private chunk';
  select count(*) into m from synora_kb.match_chunks(array_fill(0.01::real, array[1024])::extensions.vector(1024), 'test-model', 10);
  assert m = 2, 'user A match_chunks expected 2, got ' || m;
  raise notice 'PASS T4 user A: public + own private, never B';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$
declare a int;
begin
  select count(*) into a from synora_kb.chunks where content like '%privA%';
  assert a = 0, 'user B can see user A private chunk';
  raise notice 'PASS T4b user B cannot see A';
end $$;
-- authenticated with no subject sees public only
select set_config('request.jwt.claim.sub', '', false);
do $$
declare c int;
begin
  select count(*) into c from synora_kb.chunks;
  assert c = 1, 'authenticated without subject expected 1, got ' || c;
  raise notice 'PASS T4c authenticated without subject = public only';
end $$;
reset role;

-- --- T5: sensitive document row itself is never readable by API roles ---------
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$
declare s int;
begin
  select count(*) into s from synora_kb.documents where access_class = 'SENSITIVE';
  assert s = 0, 'SENSITIVE document row visible to authenticated';
  raise notice 'PASS T5 SENSITIVE rows invisible to API roles';
end $$;
reset role;

\echo ALL KB RLS TESTS PASSED
