import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

/** Serializa migrations quando suítes de integração compartilham banco vazio. */
export async function migrateIdentityTestDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(656, 1)');
    try {
      await migrate(drizzle({ client }), { migrationsFolder: './drizzle' });
    } finally {
      await client.query('SELECT pg_advisory_unlock(656, 1)');
    }
  } finally {
    client.release();
  }
}
