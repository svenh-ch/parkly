import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { readdir, readFile } from 'node:fs/promises';
import { FacilityService, type RegionFile } from '../services/facility-service';
import { createDb } from './client';
import { dataSources, platformFeeRules, regions } from './schema';

/**
 * Stammdaten (keine Fake-Parkplätze): Startregion, Standard-Plattformgebühr und
 * die dokumentierten Datenquellen. Idempotent, kann beliebig oft ausgeführt werden.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt');
  process.exit(1);
}
const defaultFeeBps = Number(process.env.DEFAULT_PLATFORM_FEE_BPS ?? 1500);

const { db, close } = createDb(url, 1);

try {
  await db.transaction(async (tx) => {
    const [zurich] = await tx
      .insert(regions)
      .values({
        slug: 'zuerich',
        name: 'Zürich',
        countryCode: 'CH',
        currency: 'CHF',
        timezone: 'Europe/Zurich',
        center: { x: 8.5417, y: 47.3769 },
        minLat: '47.320200',
        minLng: '8.448100',
        maxLat: '47.434700',
        maxLng: '8.625400',
        isActive: true,
      })
      .onConflictDoUpdate({ target: regions.slug, set: { isActive: true } })
      .returning({ id: regions.id });

    const existingDefault = await tx.execute(
      sql`select 1 from platform_fee_rules where region_id is null and host_tier is null and valid_to is null limit 1`,
    );
    if (existingDefault.rows.length === 0) {
      await tx.insert(platformFeeRules).values({ regionId: null, hostTier: null, hostFeeBps: defaultFeeBps });
    }

    await tx
      .insert(dataSources)
      .values([
        {
          key: 'zh_ogd_parkhaeuser',
          name: 'Stadt Zürich: Öffentlich zugängliche Parkhäuser',
          license: 'CC0-1.0',
          attribution: 'Daten: Stadt Zürich (Open Government Data)',
          url: 'https://data.stadt-zuerich.ch/dataset/geo_oeffentlich_zugaengliche_parkhaeuser',
        },
        {
          key: 'zh_pls',
          name: 'Parkleitsystem Stadt Zürich (Echtzeit)',
          license: 'CC0-1.0',
          attribution: 'Belegung: Parkleitsystem Stadt Zürich (CC0) · Standorte: ParkAPI-Projekt (MIT)',
          url: 'https://data.stadt-zuerich.ch/dataset/parkleitsystem',
        },
        {
          key: 'osm',
          name: 'OpenStreetMap',
          license: 'ODbL-1.0',
          attribution: '© OpenStreetMap-Mitwirkende',
          url: 'https://www.openstreetmap.org/copyright',
        },
      ])
      .onConflictDoUpdate({
        target: dataSources.key,
        set: {
          name: sql`excluded.name`,
          license: sql`excluded.license`,
          attribution: sql`excluded.attribution`,
          url: sql`excluded.url`,
        },
      });

    console.log(`✔ Stammdaten (Region Zürich: ${zurich?.id}, Standardgebühr ${defaultFeeBps / 100} %)`);
  });

  // Öffentliche Parkhäuser (Standorte); die Belegung kommt live über den PLS-Sync der API
  const dataFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/zuerich-parkleitsystem.geojson');
  const { upserted } = await new FacilityService(db).importPlsLocations(dataFile);
  console.log(`✔ ${upserted} Parkhäuser Zürich importiert`);

  // Weitere Regionen: je eine Datei in data/regions (neue Stadt = neue Datei)
  const regionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/regions');
  for (const file of (await readdir(regionsDir)).filter((f) => f.endsWith('.json')).sort()) {
    const data = JSON.parse(await readFile(path.join(regionsDir, file), 'utf8')) as RegionFile;
    const res = await new FacilityService(db).importRegion(data);
    console.log(`✔ Region ${data.region.name}: ${res.upserted} Parkhäuser/Parkplätze`);
  }
  console.log('✔ Seed abgeschlossen');
} catch (err) {
  console.error('✖ Seed fehlgeschlagen', err);
  process.exitCode = 1;
} finally {
  await close();
}
