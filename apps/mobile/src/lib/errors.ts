import { ApiError } from '@parking/api-client';
import { AuthError } from '@supabase/supabase-js';

/** Übersetzt technische Fehler in verständliche Meldungen für Nutzer. */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;

  if (error instanceof AuthError) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'E-Mail oder Passwort ist falsch.';
      case 'email_not_confirmed':
        return 'Bitte bestätige zuerst deine E-Mail-Adresse.';
      case 'user_already_exists':
      case 'email_exists':
        return 'Mit dieser E-Mail-Adresse existiert bereits ein Konto.';
      case 'weak_password':
        return 'Das Passwort ist zu schwach. Mindestens 10 Zeichen mit Gross-, Kleinbuchstaben und Ziffern.';
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
        return 'Zu viele Versuche. Bitte warte einen Moment.';
      case 'same_password':
        return 'Das neue Passwort muss sich vom alten unterscheiden.';
      default:
        if (error.status === 0 || error.name === 'AuthRetryableFetchError') {
          return 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.';
        }
        return 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.';
    }
  }

  return 'Etwas ist schiefgelaufen. Bitte versuche es erneut.';
}
