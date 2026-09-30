import type { Booking } from '@parking/shared';

export async function scheduleEndReminder(_b: Booking) {}
export async function cancelEndReminder(_bookingId: string) {}
export function onReminderTap(_open: (bookingId: string) => void) {
  return () => undefined;
}
