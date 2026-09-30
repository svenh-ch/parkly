import { customType, geometry, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** WGS84-Punkt (EPSG:4326). Distanzen werden über ::geography in Metern berechnet. */
export const point = (name: string) => geometry(name, { type: 'point', mode: 'xy', srid: 4326 });

/** ISO-3166-1 alpha-2 */
export const countryCode = customType<{ data: string }>({
  dataType: () => 'char(2)',
});

/** ISO-4217 */
export const currencyCode = customType<{ data: string }>({
  dataType: () => 'char(3)',
});
