ALTER TYPE "public"."booking_status" ADD VALUE 'PENDING_APPROVAL' BEFORE 'CONFIRMED';--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"radius_meters" integer DEFAULT 1500 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"public_open_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_tiers" (
	"tier" text PRIMARY KEY NOT NULL,
	"rank" smallint NOT NULL,
	"min_points" integer NOT NULL,
	"renter_fee_bps" integer NOT NULL,
	"host_fee_bps" integer NOT NULL,
	"early_access_hours" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_tiers_rank_unique" UNIQUE("rank")
);
--> statement-breakpoint
CREATE TABLE "user_loyalty" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'BRONZE' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"tier_held_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "approval_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "renter_tier" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "host_tier" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "extension_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payout_state" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "transfer_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "purpose" text DEFAULT 'BOOKING' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_loyalty" ADD CONSTRAINT "user_loyalty_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_location_gix" ON "events" USING gist ("location");--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
-- Buchungen auf Anfrage blockieren den Zeitraum ebenfalls. Formuliert über die nicht blockierenden
-- Status, weil der neue Enum-Wert in derselben Transaktion noch nicht verwendet werden darf.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "spot_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" NOT IN ('CANCELLED', 'EXPIRED', 'COMPLETED'));--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_tiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_loyalty" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON events, loyalty_tiers, user_loyalty FROM anon, authenticated';
  END IF;
END
$$;--> statement-breakpoint
-- Standard-Stufen (anpassbar): Punkte = abgeschlossene Buchungen der letzten 12 Monate
INSERT INTO "loyalty_tiers" ("tier", "rank", "min_points", "renter_fee_bps", "host_fee_bps", "early_access_hours") VALUES
  ('BRONZE', 1, 0, 1000, 1500, 0),
  ('SILVER', 2, 5, 900, 1400, 12),
  ('GOLD', 3, 15, 800, 1300, 24),
  ('PLATINUM', 4, 40, 700, 1200, 48),
  ('DIAMOND', 5, 100, 500, 1000, 72)
ON CONFLICT ("tier") DO NOTHING;
