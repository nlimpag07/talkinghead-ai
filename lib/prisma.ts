import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Pool sizing is an adapter concern in Prisma 7. The old `connection_limit=1`
 * query parameter is no longer read by anything — `max` below is what actually
 * bounds connections, and on serverless it must stay at 1, because every
 * function instance opens its own pool against a shared Supavisor.
 *
 * Timeouts are set explicitly: node-postgres defaults to waiting forever,
 * which turns a pooler hiccup into a hung request rather than a fast error.
 */
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.PRISMA_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
