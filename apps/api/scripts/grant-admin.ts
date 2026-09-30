import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';

/**
 * Admin-Rolle vergeben: pnpm --filter @parking/api admin:grant sven@example.ch
 * (Die Person muss sich vorher einmal in der App angemeldet haben.)
 */
const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.DATABASE_URL;
if (!email || !url) {
  console.error('Aufruf: pnpm --filter @parking/api admin:grant <e-mail>  (DATABASE_URL aus apps/api/.env)');
  process.exit(1);
}
const { db, close } = createDb(url, 1);
try {
  const res = await db.execute<{ id: string }>(sql`select id from users where lower(email) = ${email} and status = 'ACTIVE'`);
  const user = res.rows[0];
  if (!user) {
    console.error(`✖ Kein aktives Konto mit ${email}. Melde dich zuerst einmal in der App an.`);
    process.exitCode = 1;
  } else {
    await db.execute(sql`insert into user_roles (user_id, role) values (${user.id}, 'ADMIN') on conflict do nothing`);
    console.log(`✔ ${email} ist jetzt Admin`);
  }
} finally {
  await close();
}
