import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * `datasource.url` here is consumed by the Prisma CLI only — migrations,
 * `db execute`, and Studio. It must be the DIRECT connection (port 5432),
 * because Supavisor's transaction pooler cannot run DDL sessions.
 *
 * Runtime queries do not read this file at all; they go through the
 * driver adapter in `lib/prisma.ts` using DATABASE_URL (port 6543).
 *
 * `process.env` rather than the `env()` helper: `env()` throws whenever the
 * config loads, which breaks `prisma generate` in CI where no database URL
 * is present.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
