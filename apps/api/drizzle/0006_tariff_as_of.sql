ALTER TABLE "facility_tariffs" ADD COLUMN "as_of" date;--> statement-breakpoint
ALTER TABLE "facility_tariffs" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "facility_tariffs" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;