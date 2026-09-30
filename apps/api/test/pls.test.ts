import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { facilityKey, parsePlsFeed } from '../src/adapters/parking-data/zuerich-pls';

const xml = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/pls-feed.xml'), 'utf8');

describe('Parkleitsystem-Feed', () => {
  const entries = parsePlsFeed(xml);

  it('liest alle Einträge', () => {
    expect(entries).toHaveLength(5);
  });

  it('zerlegt Titel, Status, freie Plätze und Zeitstempel', () => {
    expect(entries[0]).toEqual({
      pid: 'accu',
      name: 'Parkhaus Accu',
      street: 'Otto-Schütz-Weg',
      status: 'OPEN',
      freeSpaces: 171,
      observedAt: new Date('2026-09-29T19:36:21Z'),
      link: 'https://www.pls-zh.ch/parkhaus/accu.jsp?pid=accu',
    });
    expect(entries[2]).toMatchObject({ status: 'CLOSED', freeSpaces: 0 });
  });

  it('behandelt fehlende Werte als unbekannt', () => {
    expect(entries[3]).toMatchObject({ name: 'Parkhaus Opéra', status: 'UNKNOWN', freeSpaces: null });
  });

  it('bildet stabile Schlüssel über Quellen hinweg', () => {
    expect(facilityKey('Parkhaus Opéra')).toBe('parkhaus-opera');
    expect(facilityKey('Parkhaus Züri 11 Shopping')).toBe('parkhaus-zuri-11-shopping');
  });

  it('ist robust gegen leere oder kaputte Feeds', () => {
    expect(parsePlsFeed('')).toEqual([]);
    expect(parsePlsFeed('<rss><channel><item><title></title></item></channel></rss>')).toEqual([]);
  });
});
