import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename");
  console.table(r.rows);
} finally {
  await pool.end();
}
