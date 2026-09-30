import { z } from 'zod';
import { latLngSchema } from './common';

/**
 * In-App-Route. Anbieterneutral: jeder Routing-Adapter (openrouteservice, Mapbox, …)
 * liefert dieses Format. Koordinaten als [lat, lng]-Tupel, damit lange Routen kompakt bleiben.
 */

export const MANEUVER_TYPES = [
  'DEPART',
  'STRAIGHT',
  'SLIGHT_LEFT',
  'LEFT',
  'SHARP_LEFT',
  'SLIGHT_RIGHT',
  'RIGHT',
  'SHARP_RIGHT',
  'KEEP_LEFT',
  'KEEP_RIGHT',
  'UTURN',
  'ROUNDABOUT',
  'EXIT_ROUNDABOUT',
  'MERGE',
  'RAMP',
  'ARRIVE',
] as const;
export type ManeuverType = (typeof MANEUVER_TYPES)[number];

export const routeRequestSchema = z.object({
  from: latLngSchema,
  to: latLngSchema,
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export const routeStepSchema = z.object({
  type: z.enum(MANEUVER_TYPES),
  /** Anweisung des Anbieters (Deutsch), nur als Rückfall; die App baut ihren eigenen Text. */
  instruction: z.string(),
  streetName: z.string().nullable(),
  exitNumber: z.number().int().positive().nullable(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  /** Index in `coordinates`, an dem das Manöver stattfindet (Beginn des Schritts). */
  startIndex: z.number().int().nonnegative(),
});
export type RouteStep = z.infer<typeof routeStepSchema>;

export const routeSchema = z.object({
  provider: z.string(),
  attribution: z.string(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  steps: z.array(routeStepSchema).min(1),
});
export type Route = z.infer<typeof routeSchema>;
