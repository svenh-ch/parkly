import { pgEnum } from 'drizzle-orm/pg-core';
import {
  BOOKING_STATUSES,
  CANCELLATION_POLICIES,
  FACILITY_STATUSES,
  HOST_ONBOARDING_STATUSES,
  IMAGE_KINDS,
  IMAGE_STATUSES,
  PAYMENT_STATUSES,
  PAYOUT_STATUSES,
  PLATFORMS,
  PRICE_UNITS,
  REFUND_STATUSES,
  REPORT_STATUSES,
  REPORT_TARGETS,
  REVIEW_STATUSES,
  SPOT_STATUSES,
  SPOT_TYPES,
  USER_ROLES,
  USER_STATUSES,
} from '@parking/shared';

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const hostOnboardingStatusEnum = pgEnum('host_onboarding_status', HOST_ONBOARDING_STATUSES);
export const spotTypeEnum = pgEnum('spot_type', SPOT_TYPES);
export const spotStatusEnum = pgEnum('spot_status', SPOT_STATUSES);
export const imageKindEnum = pgEnum('image_kind', IMAGE_KINDS);
export const imageStatusEnum = pgEnum('image_status', IMAGE_STATUSES);
export const cancellationPolicyEnum = pgEnum('cancellation_policy', CANCELLATION_POLICIES);
export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUSES);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const refundStatusEnum = pgEnum('refund_status', REFUND_STATUSES);
export const payoutStatusEnum = pgEnum('payout_status', PAYOUT_STATUSES);
export const reviewStatusEnum = pgEnum('review_status', REVIEW_STATUSES);
export const reportTargetEnum = pgEnum('report_target', REPORT_TARGETS);
export const reportStatusEnum = pgEnum('report_status', REPORT_STATUSES);
export const facilityStatusEnum = pgEnum('facility_status', FACILITY_STATUSES);
export const priceUnitEnum = pgEnum('price_unit', PRICE_UNITS);
export const platformEnum = pgEnum('platform', PLATFORMS);
