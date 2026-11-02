import pg from "pg";
import { resolveDatabaseUrl } from "./connection.mjs";
const pool = new pg.Pool({ connectionString: resolveDatabaseUrl("migration"), max: 1 });
try {
  const r = await pool.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename");
  console.table(r.rows);
} finally {
  await pool.end();
}
