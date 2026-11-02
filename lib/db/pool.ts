import "server-only";
import { Pool } from "pg";

/** One pool per Node.js process, reused during Next.js hot reload. */
const cache = globalThis as typeof globalThis & { __groupExpensePool?: Pool };

export const pool =
  cache.__groupExpensePool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  cache.__groupExpensePool = pool;
}
