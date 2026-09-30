import type { FacilityStatus } from '@parking/shared';

/**
 * Parkleitsystem Stadt Zürich (PLS): Echtzeit-Belegung der angeschlossenen Parkhäuser.
 *
 * Quelle:   https://www.pls-zh.ch/plsFeed/rss  (RSS 2.0)
 * Lizenz:   CC0 (Creative-Commons-Null-Lizenz), kommerzielle Nutzung erlaubt
 * Kosten:   keine
 * Limits:   keine dokumentiert; wir fragen höchstens alle paar Minuten ab
 * Update:   laufend (je Parkhaus mit eigenem Zeitstempel)
 *
 * Format eines Eintrags:
 *   <title>Parkhaus Accu / Otto-Schütz-Weg</title>
 *   <link>https://www.pls-zh.ch/parkhaus/accu.jsp?pid=accu</link>
 *   <description>open /  171</description>
 *   <dc:date>2026-09-29T19:36:21Z</dc:date>
 */

export const PLS_FEED_URL = 'https://www.pls-zh.ch/plsFeed/rss';

export interface PlsEntry {
  /** Stabile ID aus dem Link (?pid=accu) */
  pid: string | null;
  /** z. B. "Parkhaus Accu" */
  name: string;
  /** z. B. "Otto-Schütz-Weg" */
  street: string | null;
  status: FacilityStatus;
  freeSpaces: number | null;
  observedAt: Date;
  link: string | null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .trim();

const tag = (xml: string, name: string): string | null => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match?.[1] !== undefined ? decodeEntities(match[1]) : null;
};

function parseStatus(raw: string): FacilityStatus {
  const s = raw.trim().toLowerCase();
  if (s === 'open') return 'OPEN';
  if (s === 'closed') return 'CLOSED';
  return 'UNKNOWN';
}

export function parsePlsFeed(xml: string, now: Date = new Date()): PlsEntry[] {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) ?? [];
  const entries: PlsEntry[] = [];

  for (const item of items) {
    const title = tag(item, 'title');
    if (!title) continue;
    const [namePart, ...rest] = title.split(' / ');
    const name = namePart?.trim();
    if (!name) continue;

    const link = tag(item, 'link');
    let pid: string | null = null;
    if (link) {
      try {
        pid = new URL(link).searchParams.get('pid');
      } catch {
        pid = null;
      }
    }

    const description = tag(item, 'description') ?? '';
    const [statusRaw = '', freeRaw = ''] = description.split('/');
    const free = Number.parseInt(freeRaw.trim(), 10);

    const dateRaw = tag(item, 'dc:date') ?? tag(item, 'pubDate');
    const date = dateRaw ? new Date(dateRaw) : now;

    entries.push({
      pid,
      name,
      street: rest.join(' / ').trim() || null,
      status: parseStatus(statusRaw),
      freeSpaces: Number.isFinite(free) && free >= 0 ? free : null,
      observedAt: Number.isNaN(date.getTime()) ? now : date,
      link,
    });
  }
  return entries;
}

export async function fetchPlsFeed(fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<PlsEntry[]> {
  const res = await fetchImpl(PLS_FEED_URL, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
  });
  if (!res.ok) throw new Error(`PLS-Feed antwortet mit HTTP ${res.status}`);
  return parsePlsFeed(await res.text());
}

/** Einheitlicher Schlüssel für den Abgleich von Namen aus verschiedenen Quellen. */
export function facilityKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
