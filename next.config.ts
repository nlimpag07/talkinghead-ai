import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The pg driver and the Prisma adapter resolve at runtime, not build time.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
