import { z } from 'zod';
import { PARKING_KINDS } from '../enums';
import { nearbyItemSchema } from './map';

/* ─────────────── Favoriten ─────────────── */

export const favoriteParamsSchema = z.object({
  kind: z.enum(PARKING_KINDS),
  id: z.uuid(),
});
export type FavoriteTarget = z.infer<typeof favoriteParamsSchema>;

export const favoritesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** Favorit mit Kartendaten; distanceMeters nur, wenn ein Standort mitgeschickt wurde. */
export const favoriteItemSchema = nearbyItemSchema.extend({
  distanceMeters: z.number().int().nullable(),
  savedAt: z.string(),
});
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;
export const favoritesResponseSchema = z.object({ items: z.array(favoriteItemSchema) });

/* ─────────────── Bewertungen ─────────────── */

export const REVIEW_COMMENT_MAX = 1000;

export const upsertReviewSchema = z
  .object({
    rating: z.number().int().min(1, 'Bitte 1 bis 5 Sterne wählen').max(5),
    comment: z
      .string()
      .trim()
      .max(REVIEW_COMMENT_MAX, `Maximal ${REVIEW_COMMENT_MAX} Zeichen`)
      .transform((v) => (v.length ? v : null))
      .nullable()
      .optional(),
  })
  .strict();
export type UpsertReviewInput = z.input<typeof upsertReviewSchema>;

export const reviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** "Anna M." (nie der volle Nachname) */
  authorName: z.string(),
  isMine: z.boolean(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** ISO-Zeitstempel der letzten Bewertung der vorherigen Seite */
  before: z.iso.datetime({ offset: true }).optional(),
});

export const reviewListSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
  mine: reviewSchema.nullable(),
});
export type ReviewList = z.infer<typeof reviewListSchema>;

export const myReviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  status: z.enum(['VISIBLE', 'HIDDEN']),
  target: z.object({ kind: z.enum(PARKING_KINDS), id: z.uuid(), name: z.string() }),
});
export type MyReview = z.infer<typeof myReviewSchema>;
export const myReviewsResponseSchema = z.object({ items: z.array(myReviewSchema) });

export const REPORT_REASONS = ['SPAM', 'OFFENSIVE', 'FALSE_INFORMATION', 'PERSONAL_DATA', 'OTHER'] as const;
export const reportReviewSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(500).optional(),
  })
  .strict();
export type ReportReviewInput = z.infer<typeof reportReviewSchema>;

export const moderateReviewSchema = z.object({ status: z.enum(['VISIBLE', 'HIDDEN']) }).strict();
