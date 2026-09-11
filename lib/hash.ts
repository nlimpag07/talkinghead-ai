import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Keyed hash, not a bare digest. The IPv4 space is small enough that a plain
 * SHA-256 of an address is trivially reversible by brute force; the HMAC key
 * is what makes the stored value useless to anyone who takes the database.
 */
export function hashIp(ip: string): string {
  return createHmac("sha256", env.IP_HASH_SALT).update(ip).digest("hex");
}

/**
 * Trusts `x-forwarded-for` only as far as the first entry, which is what the
 * platform proxy sets. Everything after it is client-supplied and forgeable.
 * Returns a sentinel rather than throwing — a missing IP should degrade to
 * "treat them as one shared bucket", not 500 the request.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return headers.get("x-real-ip")?.trim() ?? "unknown";
}
