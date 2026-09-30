CREATE TYPE "public"."booking_status" AS ENUM('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."cancellation_policy" AS ENUM('FLEXIBLE', 'MODERATE', 'STRICT');--> statement-breakpoint
CREATE TYPE "public"."facility_status" AS ENUM('OPEN', 'CLOSED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."host_onboarding_status" AS ENUM('NOT_STARTED', 'PENDING', 'COMPLETE', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."image_kind" AS ENUM('FRONT', 'TOP', 'ACCESS', 'SURROUNDINGS', 'GARAGE', 'ENTRANCE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('PENDING_UPLOAD', 'READY', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('IOS', 'ANDROID', 'WEB');--> statement-breakpoint
CREATE TYPE "public"."price_unit" AS ENUM('HOUR', 'DAY', 'WEEK', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('USER', 'SPOT', 'REVIEW', 'BOOKING');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('VISIBLE', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."spot_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."spot_type" AS ENUM('OUTDOOR', 'CARPORT', 'GARAGE', 'UNDERGROUND');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('RENTER', 'HOST', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TABLE "host_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"stripe_account_id" text,
	"onboarding_status" "host_onboarding_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"tier" text DEFAULT 'STANDARD' NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_profiles_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" "platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"avatar_path" text,
	"locale" text DEFAULT 'de-CH' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"street" text NOT NULL,
	"house_number" text,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"subdivision" text,
	"country_code" char(2) NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid,
	"host_tier" text,
	"host_fee_bps" integer NOT NULL,
	"renter_fee_bps" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_rules_host_bps_range" CHECK ("platform_fee_rules"."host_fee_bps" between 0 and 10000),
	CONSTRAINT "fee_rules_renter_bps_range" CHECK ("platform_fee_rules"."renter_fee_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"timezone" text NOT NULL,
	"center" geometry(Point, 4326) NOT NULL,
	"min_lat" numeric(9, 6) NOT NULL,
	"min_lng" numeric(9, 6) NOT NULL,
	"max_lat" numeric(9, 6) NOT NULL,
	"max_lng" numeric(9, 6) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"license" text NOT NULL,
	"attribution" text,
	"url" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "facility_occupancy" (
	"facility_id" uuid PRIMARY KEY NOT NULL,
	"free_spaces" integer,
	"status" "facility_status" DEFAULT 'UNKNOWN' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"unit" "price_unit" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parking_facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"operator" text,
	"facility_type" text DEFAULT 'GARAGE' NOT NULL,
	"street" text,
	"postal_code" text,
	"city" text,
	"location" geometry(Point, 4326) NOT NULL,
	"capacity" integer,
	"opening_hours" text,
	"has_ev_charging" boolean,
	"max_height_cm" integer,
	"website" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"source_attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"is_blocked" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_exceptions_range" CHECK ("availability_exceptions"."end_at" > "availability_exceptions"."start_at")
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_weekday_range" CHECK ("availability_rules"."weekday" between 1 and 7),
	CONSTRAINT "availability_minutes_range" CHECK ("availability_rules"."start_minute" >= 0 and "availability_rules"."end_minute" <= 1440 and "availability_rules"."end_minute" > "availability_rules"."start_minute")
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"kind" "image_kind" DEFAULT 'OTHER' NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"mime_type" text,
	"status" "image_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "parking_spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"approx_location" geometry(Point, 4326) NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"spot_type" "spot_type" NOT NULL,
	"status" "spot_status" DEFAULT 'DRAFT' NOT NULL,
	"is_covered" boolean DEFAULT false NOT NULL,
	"has_ev_charging" boolean DEFAULT false NOT NULL,
	"ev_connector" text,
	"access_24h" boolean DEFAULT false NOT NULL,
	"max_length_cm" integer,
	"max_width_cm" integer,
	"max_height_cm" integer,
	"access_instructions" text,
	"rules" text,
	"price_hourly" integer,
	"price_daily" integer,
	"price_weekly" integer,
	"price_monthly" integer,
	"currency" char(3) NOT NULL,
	"min_duration_minutes" integer DEFAULT 60 NOT NULL,
	"max_duration_minutes" integer DEFAULT 129600 NOT NULL,
	"cancellation_policy" "cancellation_policy" DEFAULT 'MODERATE' NOT NULL,
	"instant_book" boolean DEFAULT true NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spots_has_price" CHECK (coalesce("parking_spots"."price_hourly", "parking_spots"."price_daily", "parking_spots"."price_weekly", "parking_spots"."price_monthly") is not null or "parking_spots"."status" = 'DRAFT'),
	CONSTRAINT "spots_prices_positive" CHECK (coalesce("parking_spots"."price_hourly", 1) > 0 and coalesce("parking_spots"."price_daily", 1) > 0 and coalesce("parking_spots"."price_weekly", 1) > 0 and coalesce("parking_spots"."price_monthly", 1) > 0),
	CONSTRAINT "spots_duration_range" CHECK ("parking_spots"."min_duration_minutes" > 0 and "parking_spots"."max_duration_minutes" >= "parking_spots"."min_duration_minutes")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal" integer NOT NULL,
	"renter_fee" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"platform_fee" integer NOT NULL,
	"host_payout" integer NOT NULL,
	"host_fee_bps" integer NOT NULL,
	"renter_fee_bps" integer DEFAULT 0 NOT NULL,
	"price_breakdown" jsonb NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_time_range" CHECK ("bookings"."end_at" > "bookings"."start_at"),
	CONSTRAINT "bookings_amounts" CHECK ("bookings"."subtotal" >= 0 and "bookings"."total" = "bookings"."subtotal" + "bookings"."renter_fee" and "bookings"."platform_fee" + "bookings"."host_payout" = "bookings"."subtotal")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"object_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_status" DEFAULT 'REQUIRES_PAYMENT' NOT NULL,
	"method_type" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"provider_payout_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payout_status" NOT NULL,
	"arrival_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_provider_payout_id_unique" UNIQUE("provider_payout_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider_refund_id" text,
	"amount" integer NOT NULL,
	"reason" text,
	"status" "refund_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"spot_id" uuid,
	"facility_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_one_target" CHECK (num_nonnulls("favorites"."spot_id", "favorites"."facility_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"spot_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"host_reply" text,
	"status" "review_status" DEFAULT 'VISIBLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee_rules" ADD CONSTRAINT "platform_fee_rules_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_occupancy" ADD CONSTRAINT "facility_occupancy_facility_id_parking_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."parking_facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_tariffs" ADD CONSTRAINT "facility_tariffs_facility_id_parking_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."parking_facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_renter_id_users_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_facility_id_parking_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."parking_facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "addresses_location_gix" ON "addresses" USING gist ("location");--> statement-breakpoint
CREATE INDEX "fee_rules_lookup_idx" ON "platform_fee_rules" USING btree ("region_id","host_tier","valid_from");--> statement-breakpoint
CREATE INDEX "facility_tariffs_facility_idx" ON "facility_tariffs" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_source_external_uq" ON "parking_facilities" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "facilities_location_gix" ON "parking_facilities" USING gist ("location");--> statement-breakpoint
CREATE INDEX "facilities_region_idx" ON "parking_facilities" USING btree ("region_id","is_active");--> statement-breakpoint
CREATE INDEX "availability_exceptions_spot_idx" ON "availability_exceptions" USING btree ("spot_id","start_at");--> statement-breakpoint
CREATE INDEX "availability_rules_spot_idx" ON "availability_rules" USING btree ("spot_id");--> statement-breakpoint
CREATE INDEX "images_spot_position_idx" ON "images" USING btree ("spot_id","position");--> statement-breakpoint
CREATE INDEX "spots_approx_location_gix" ON "parking_spots" USING gist ("approx_location");--> statement-breakpoint
CREATE INDEX "spots_region_status_idx" ON "parking_spots" USING btree ("region_id","status");--> statement-breakpoint
CREATE INDEX "spots_host_idx" ON "parking_spots" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "bookings_renter_idx" ON "bookings" USING btree ("renter_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_host_idx" ON "bookings" USING btree ("host_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_spot_idx" ON "bookings" USING btree ("spot_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_pending_hold_idx" ON "bookings" USING btree ("hold_expires_at") WHERE "bookings"."status" = 'PENDING_PAYMENT';--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payouts_host_idx" ON "payouts" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_spot_uq" ON "favorites" USING btree ("user_id","spot_id") WHERE "favorites"."spot_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_facility_uq" ON "favorites" USING btree ("user_id","facility_id") WHERE "favorites"."facility_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_spot_idx" ON "reviews" USING btree ("spot_id","created_at");