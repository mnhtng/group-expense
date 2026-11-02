import "server-only";
import { betterAuth } from "better-auth";
import { pool } from "@/lib/db/pool";

/** Better Auth uses its built-in PostgreSQL adapter directly; there is no ORM. */
export const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL,
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
