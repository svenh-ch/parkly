import type { AvailabilityRule } from '@parking/shared';

export interface DayEdit {
  enabled: boolean;
  from: number; // Minuten ab Mitternacht
  to: number; // <= from bedeutet: bis am nächsten Morgen
}

export const DEFAULT_DAY: DayEdit = { enabled: false, from: 7 * 60, to: 19 * 60 };

/** Wochentage (Mo=0 … So=6) in Regeln umwandeln; Zeiten über Mitternacht werden aufgeteilt. */
export function daysToRules(days: DayEdit[]): AvailabilityRule[] {
  const rules: AvailabilityRule[] = [];
  days.forEach((d, i) => {
    if (!d.enabled) return;
    if (d.to > d.from) {
      rules.push({ weekday: i + 1, startMinute: d.from, endMinute: d.to });
    } else {
      if (d.from < 1440) rules.push({ weekday: i + 1, startMinute: d.from, endMinute: 1440 });
      if (d.to > 0) rules.push({ weekday: ((i + 1) % 7) + 1, startMinute: 0, endMinute: d.to });
    }
  });
  return rules;
}

/** Regeln zurück in die Wochenansicht (Gegenstück zu daysToRules). */
export function rulesToDays(rules: AvailabilityRule[]): DayEdit[] {
  const byDay = (w: number) => rules.filter((r) => r.weekday === w);
  const days: DayEdit[] = Array.from({ length: 7 }, () => ({ ...DEFAULT_DAY }));
  const consumed = new Set<AvailabilityRule>();
  for (let i = 0; i < 7; i++) {
    const own = byDay(i + 1).filter((r) => !consumed.has(r));
    const late = own.find((r) => r.endMinute === 1440 && r.startMinute > 0);
    const next = byDay(((i + 1) % 7) + 1).find((r) => r.startMinute === 0 && r.endMinute < 1440);
    if (late && next) {
      days[i] = { enabled: true, from: late.startMinute, to: next.endMinute };
      consumed.add(late);
      consumed.add(next);
      continue;
    }
    const first = own.find((r) => !(r.startMinute === 0 && r.endMinute < 1440 && days[(i + 6) % 7]!.enabled && days[(i + 6) % 7]!.to === r.endMinute));
    if (first) {
      days[i] = { enabled: true, from: first.startMinute, to: first.endMinute === 1440 && first.startMinute === 0 ? 0 : first.endMinute };
      consumed.add(first);
    }
  }
  return days;
}

export function parseTime(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export const PRESETS: { label: string; days: DayEdit[] }[] = [
  { label: 'Mo–Fr 07–19', days: Array.from({ length: 7 }, (_, i) => ({ enabled: i < 5, from: 7 * 60, to: 19 * 60 })) },
  { label: 'Nachts 19–07', days: Array.from({ length: 7 }, () => ({ enabled: true, from: 19 * 60, to: 7 * 60 })) },
  { label: 'Wochenende', days: Array.from({ length: 7 }, (_, i) => ({ enabled: i >= 5, from: 0, to: 0 })) },
];
