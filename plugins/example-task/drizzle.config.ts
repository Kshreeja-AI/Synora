import { defineConfig } from 'drizzle-kit';

/** Generates SQL migrations for this plugin's own schema — run `pnpm --filter @synora/plugin-example-task db:generate`. */
export default defineConfig({
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/synora',
  },
});
