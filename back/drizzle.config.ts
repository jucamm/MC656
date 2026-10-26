import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// A geração de SQL não exige conexão; migrate exige DATABASE_URL no ambiente.
/**
 * Configuração única da fonte ORM e do histórico versionado de migrations.
 * @remarks O objeto de conexão só é incluído quando há DATABASE_URL; gerar SQL não
 * exige banco. O comando de aplicação exige conexão, sem URL alternativa embutida.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
