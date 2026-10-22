import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// A geração de SQL não exige conexão; migrate exige DATABASE_URL no ambiente.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
