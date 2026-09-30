-- Bewertungen für öffentliche Parkhäuser brauchen keine Buchung.
-- Für private Parkplätze gilt weiterhin: nur eigene, abgeschlossene Buchung des Parkplatzes.
CREATE OR REPLACE FUNCTION enforce_review_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b record;
BEGIN
  IF NEW.booking_id IS NULL THEN
    RETURN NEW; -- Parkhaus-Bewertung; Constraint reviews_spot_requires_booking deckt private Plätze ab
  END IF;
  SELECT renter_id, spot_id, status, end_at INTO b FROM bookings WHERE id = NEW.booking_id;
  IF b IS NULL THEN
    RAISE EXCEPTION 'review_booking_not_found' USING ERRCODE = '23503';
  END IF;
  IF b.renter_id <> NEW.author_id OR NEW.spot_id IS NULL OR b.spot_id <> NEW.spot_id THEN
    RAISE EXCEPTION 'review_booking_mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT (b.status = 'COMPLETED' OR (b.status = 'CONFIRMED' AND b.end_at <= now())) THEN
    RAISE EXCEPTION 'review_booking_not_completed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reviews_enforce_booking ON reviews;
--> statement-breakpoint
CREATE TRIGGER reviews_enforce_booking
  BEFORE INSERT OR UPDATE OF booking_id, author_id, spot_id, facility_id ON reviews
  FOR EACH ROW EXECUTE FUNCTION enforce_review_booking();
