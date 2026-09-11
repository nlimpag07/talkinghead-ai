-- pgvector. Installed into `public` so the unqualified type name `vector`
-- resolves without depending on the database's search_path.
--
-- If you already enabled pgvector from the Supabase dashboard, it lives in the
-- `extensions` schema and IF NOT EXISTS will no-op here — the WITH SCHEMA
-- clause is ignored for an already-installed extension. In that case either
-- keep `extensions` on the search_path, or run:
--   DROP EXTENSION vector; CREATE EXTENSION vector WITH SCHEMA public;
-- Dropping is safe only before any vector column exists.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
