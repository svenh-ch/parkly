import type { BookingStatus, LoyaltyTier } from '@parking/shared';
import { colors } from '@/ui';

const TZ = 'Europe/Zurich';

export const weekdayShort = (d: Date) => d.toLocaleDateString('de-CH', { timeZone: TZ, weekday: 'short' }).replace('.', '');
export const dayMonth = (d: Date) => d.toLocaleDateString('de-CH', { timeZone: TZ, day: 'numeric', month: 'short' });
export const time = (d: Date) => d.toLocaleTimeString('de-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

function isSameDay(a: Date, b: Date) {
  return a.toLocaleDateString('de-CH', { timeZone: TZ }) === b.toLocaleDateString('de-CH', { timeZone: TZ });
}

/** "Heute", "Morgen" oder "Fr, 3. Okt." */
export function dayLabel(d: Date, now = new Date()) {
  if (isSameDay(d, now)) return 'Heute';
  if (isSameDay(d, new Date(now.getTime() + 86_400_000))) return 'Morgen';
  return `${weekdayShort(d)}, ${dayMonth(d)}`;
}

/** "Heute 14:00 – 16:30" oder "Fr, 3. Okt. 08:00 – Sa, 4. Okt. 10:00" */
export function rangeLabel(startIso: string, endIso: string, now = new Date()) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return isSameDay(s, e) ? `${dayLabel(s, now)} ${time(s)} – ${time(e)}` : `${dayLabel(s, now)} ${time(s)} – ${dayLabel(e, now)} ${time(e)}`;
}

export function durationLabel(minutes: number) {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d ? `${d} ${d === 1 ? 'Tag' : 'Tage'}` : '', h ? `${h} Std.` : '', m ? `${m} Min.` : ''].filter(Boolean).join(' ') || '0 Min.';
}

/** Rappen -> "CHF 12.50" */
export const money = (rappen: number, currency = 'CHF') => `${currency} ${(rappen / 100).toFixed(2)}`;

export const BOOKING_STATUS: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  PENDING_PAYMENT: { label: 'Zahlung offen', color: colors.warning, bg: colors.warningSoft },
  PENDING_APPROVAL: { label: 'Wartet auf Bestätigung', color: colors.warning, bg: colors.warningSoft },
  CONFIRMED: { label: 'Bestätigt', color: colors.success, bg: colors.successSoft },
  CANCELLED: { label: 'Storniert', color: colors.inkSecondary, bg: colors.surface },
  EXPIRED: { label: 'Abgelaufen', color: colors.inkSecondary, bg: colors.surface },
  COMPLETED: { label: 'Abgeschlossen', color: colors.inkSecondary, bg: colors.surface },
};

export const TIER: Record<LoyaltyTier, { label: string; color: string; soft: string; icon: 'medal-outline' | 'medal' | 'trophy' | 'diamond' }> = {
  BRONZE: { label: 'Bronze', color: '#A0612B', soft: '#F7ECE2', icon: 'medal-outline' },
  SILVER: { label: 'Silber', color: '#6B7684', soft: '#EEF1F4', icon: 'medal' },
  GOLD: { label: 'Gold', color: '#B7860B', soft: '#FBF3DC', icon: 'medal' },
  PLATINUM: { label: 'Platin', color: '#3F5A73', soft: '#E6EDF3', icon: 'trophy' },
  DIAMOND: { label: 'Diamant', color: '#1F8FB5', soft: '#E1F4FA', icon: 'diamond' },
};

export const pct = (bps: number) => `${(bps / 100).toLocaleString('de-CH', { maximumFractionDigits: 1 })} %`;
