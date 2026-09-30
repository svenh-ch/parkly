ALTER TABLE "reviews" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "spot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_facilities" ADD COLUMN "rating_avg" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "parking_facilities" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "facility_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_facility_id_parking_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."parking_facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_facility_idx" ON "reviews" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_author_idx" ON "reviews" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_author_facility_uq" ON "reviews" USING btree ("author_id","facility_id") WHERE "reviews"."facility_id" is not null;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_one_target" CHECK (num_nonnulls("reviews"."spot_id", "reviews"."facility_id") = 1);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_spot_requires_booking" CHECK ("reviews"."spot_id" is null or "reviews"."booking_id" is not null);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_comment_length" CHECK ("reviews"."comment" is null or char_length("reviews"."comment") <= 1000);