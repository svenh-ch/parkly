-- Extensions für Geo-Abfragen (PostGIS) und den Doppelbuchungs-Schutz (btree_gist).
-- Auf Supabase liegen Extensions im Schema "extensions"; lokal ohne Supabase in "public".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END
$$;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
