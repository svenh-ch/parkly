ALTER TABLE "parking_spots" ADD COLUMN "floor" text;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "spot_number" text;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "vehicle_types" text[] DEFAULT '{CAR}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "amenities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "ev_power_kw" numeric(5, 1);--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "access_method" text DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "lead_time_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "rights_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD CONSTRAINT "spots_lead_time_range" CHECK ("parking_spots"."lead_time_minutes" between 0 and 10080);