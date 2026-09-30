import { z } from 'zod';

export const uuidSchema = z.uuid();

/** WGS84-Koordinate. */
export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

/** Kartenausschnitt: minLng,minLat,maxLng,maxLat */
export const bboxSchema = z
  .string()
  .transform((value, ctx) => {
    const parts = value.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: 'custom', message: 'bbox muss "minLng,minLat,maxLng,maxLat" sein' });
      return z.NEVER;
    }
    const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
    return { minLng, minLat, maxLng, maxLat };
  });

export const moneyAmountSchema = z.number().int().positive().max(100_000_000);

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

/** Einheitliches Fehlerformat aller API-Antworten. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
