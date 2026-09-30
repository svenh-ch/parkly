import * as Notifications from 'expo-notifications';
import type { Booking } from '@parking/shared';
import { time } from './format';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const id = (bookingId: string) => `parkly-end-${bookingId}`;

/**
 * Lokale Erinnerung 15 Minuten vor Ende ("Parken verlängern?"). Läuft nur auf dem Gerät,
 * es werden keine Daten an einen Push-Dienst geschickt.
 */
export async function scheduleEndReminder(b: Booking) {
  try {
    await Notifications.cancelScheduledNotificationAsync(id(b.id)).catch(() => undefined);
    if (b.status !== 'CONFIRMED' || b.role !== 'RENTER') return;
    const at = new Date(new Date(b.endAt).getTime() - 15 * 60_000);
    if (at.getTime() < Date.now() + 30_000) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) return;
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return;
    }
    await Notifications.scheduleNotificationAsync({
      identifier: id(b.id),
      content: {
        title: 'Parkzeit endet bald',
        body: `${b.spot.title}: noch 15 Minuten (bis ${time(new Date(b.endAt))}). Jetzt verlängern?`,
        data: { url: `parkly://booking/${b.id}` },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // Erinnerungen sind ein Extra; Fehler (z. B. Expo Go) nicht anzeigen
  }
}

export async function cancelEndReminder(bookingId: string) {
  await Notifications.cancelScheduledNotificationAsync(id(bookingId)).catch(() => undefined);
}

/** Tipp auf die Erinnerung öffnet die Buchung. */
export function onReminderTap(open: (bookingId: string) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r.notification.request.content.data?.url;
    const m = typeof url === 'string' ? url.match(/booking\/([0-9a-f-]{36})/) : null;
    if (m?.[1]) open(m[1]);
  });
  return () => sub.remove();
}
