import pg from "pg";
import { resolveDatabaseUrl } from "./connection.mjs";

// Read-only sanity check. Does not create a database, table, or account.
const url = resolveDatabaseUrl("migration");
const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 10_000,
});
try {
  const { rows } = await pool.query(
    "SELECT current_database() AS database_name, current_user AS role_name, version() AS version",
  );
  const row = rows[0];
  console.log("Connected to PostgreSQL", {
    database: row.database_name,
    role: row.role_name,
    version: String(row.version).split(" ").slice(0, 2).join(" "),
  });
  const { rows: migrationTables } = await pool.query(
    "SELECT to_regclass('schema_migrations')::text AS migrations_table",
  );
  console.log("SQL migrations table:", migrationTables[0].migrations_table ?? "not created");
} catch (error) {
  console.error("PostgreSQL verification failed:", error?.code ?? error?.name ?? "unknown");
  process.exitCode = 1;
} finally {
  await pool.end();
}
