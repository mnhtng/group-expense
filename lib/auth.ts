import "server-only";
import { betterAuth } from "better-auth";
import { pool } from "@/lib/db/pool";

/**
 * Vercel serves each Preview at its own hostname. Better Auth needs to accept
 * both the immutable deployment URL and the stable branch alias, but never
 * arbitrary *.vercel.app hosts from another project.
 *
 * The hostnames below are supplied by Vercel, not by untrusted request headers.
 */
const vercelHosts = [
  process.env.VERCEL_URL,
  process.env.VERCEL_ENV === "production"
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL
    : process.env.VERCEL_BRANCH_URL,
]
  .filter((host): host is string => Boolean(host))
  .map((host) => host.toLowerCase());

const baseURL = process.env.VERCEL_URL
  ? { allowedHosts: [...new Set(vercelHosts)], protocol: "https" as const }
  : process.env.BETTER_AUTH_URL;

/** Better Auth uses its built-in PostgreSQL adapter directly; there is no ORM. */
export const auth = betterAuth({
  database: pool,
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    // Sliding 365-day session; active sessions refresh after 24 hours.
    expiresIn: 365 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
});
