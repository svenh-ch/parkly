-- 1) Kein Parkplatz darf für überlappende Zeiträume doppelt gebucht werden.
--    Gilt atomar auf Datenbankebene, auch bei gleichzeitigen Requests.
--    Die Status-Liste muss mit BLOCKING_BOOKING_STATUSES in @parking/shared übereinstimmen.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "spot_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING_PAYMENT', 'CONFIRMED'));
--> statement-breakpoint

-- 2) Bewertungen nur für eigene, abgeschlossene Buchungen des entsprechenden Parkplatzes.
CREATE OR REPLACE FUNCTION enforce_review_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b record;
BEGIN
  SELECT renter_id, spot_id, status, end_at INTO b FROM bookings WHERE id = NEW.booking_id;
  IF b IS NULL THEN
    RAISE EXCEPTION 'review_booking_not_found' USING ERRCODE = '23503';
  END IF;
  IF b.renter_id <> NEW.author_id OR b.spot_id <> NEW.spot_id THEN
    RAISE EXCEPTION 'review_booking_mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT (b.status = 'COMPLETED' OR (b.status = 'CONFIRMED' AND b.end_at <= now())) THEN
    RAISE EXCEPTION 'review_booking_not_completed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reviews_enforce_booking
  BEFORE INSERT OR UPDATE OF booking_id, author_id, spot_id ON reviews
  FOR EACH ROW EXECUTE FUNCTION enforce_review_booking();
--> statement-breakpoint

-- 3) Defense in depth: Supabase stellt das Schema "public" über die Data API (PostgREST) bereit.
--    Alle Zugriffe laufen über unsere API; darum RLS ohne Policies = kein Direktzugriff für
--    anon/authenticated. Die API verbindet sich als Owner und ist davon nicht betroffen.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
  END IF;
END
$$;
