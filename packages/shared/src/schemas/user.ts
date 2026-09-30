import { z } from 'zod';
import { HOST_ONBOARDING_STATUSES, USER_ROLES, USER_STATUSES } from '../enums';

/** Profil, wie es die API an den eingeloggten Nutzer zurückgibt (GET /v1/me). */
export const meSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  roles: z.array(z.enum(USER_ROLES)),
  status: z.enum(USER_STATUSES),
  createdAt: z.string(),
  termsAcceptedAt: z.string().nullable(),
  hostProfile: z
    .object({
      displayName: z.string(),
      onboardingStatus: z.enum(HOST_ONBOARDING_STATUSES),
      payoutsEnabled: z.boolean(),
      since: z.string(),
    })
    .nullable(),
});
export type Me = z.infer<typeof meSchema>;

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Darf nicht leer sein')
  .max(80, 'Maximal 80 Zeichen')
  .regex(/^[\p{L}\p{M}' .-]+$/u, 'Enthält ungültige Zeichen');

/** E.164, z. B. +41791234567 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Bitte im Format +41 79 123 45 67 eingeben'));

export const updateMeSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    phone: phoneSchema.nullable(),
    locale: z.enum(['de-CH', 'fr-CH', 'it-CH', 'en']),
  })
  .partial()
  .strict();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Passwortregeln (müssen mit supabase/config.toml übereinstimmen). */
export const passwordSchema = z
  .string()
  .min(10, 'Mindestens 10 Zeichen')
  .max(128, 'Maximal 128 Zeichen')
  .regex(/[a-z]/, 'Mindestens ein Kleinbuchstabe')
  .regex(/[A-Z]/, 'Mindestens ein Grossbuchstabe')
  .regex(/\d/, 'Mindestens eine Ziffer');

export const signUpSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: z.email('Ungültige E-Mail-Adresse').trim().toLowerCase(),
  password: passwordSchema,
  acceptTerms: z.boolean().refine((v) => v, 'Bitte AGB und Datenschutzerklärung akzeptieren'),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email('Ungültige E-Mail-Adresse').trim().toLowerCase(),
  password: z.string().min(1, 'Passwort fehlt'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const becomeHostSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Mindestens 2 Zeichen').max(60, 'Maximal 60 Zeichen'),
    acceptHostTerms: z.boolean().refine((v) => v, 'Bitte die Vermieter-Bedingungen akzeptieren'),
  })
  .strict();
export type BecomeHostInput = z.infer<typeof becomeHostSchema>;

export const pushTokenSchema = z
  .object({
    token: z.string().min(10).max(300),
    platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  })
  .strict();
