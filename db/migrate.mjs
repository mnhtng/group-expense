import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "./connection.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const directory = resolve(root, "migrations");
const pool = new pg.Pool({ connectionString: resolveDatabaseUrl("migration"), max: 1 });
const connection = await pool.connect();
try {
  await connection.query("BEGIN");
  // Transaction-scoped advisory lock prevents concurrent deployment migrations.
  await connection.query("SELECT pg_advisory_xact_lock(240011, 2026)");
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    checksum_sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = await connection.query("SELECT filename, checksum_sha256 FROM schema_migrations");
  const checksums = new Map(applied.rows.map((row) => [row.filename, row.checksum_sha256]));
  const filenames = (await readdir(directory)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  for (const filename of filenames) {
    const source = await readFile(resolve(directory, filename), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    if (checksums.has(filename)) {
      if (checksums.get(filename) !== checksum) {
        throw new Error(`Migration ${filename} changed after it was applied`);
      }
      continue;
    }
    await connection.query(source);
    await connection.query(
      "INSERT INTO schema_migrations(filename, checksum_sha256) VALUES ($1, $2)",
      [filename, checksum],
    );
    console.log(`Applied ${filename}`);
  }
  for (const prior of checksums.keys()) {
    if (!filenames.includes(prior)) throw new Error(`Applied migration missing: ${prior}`);
  }
  await connection.query("COMMIT");
  console.log("SQL migrations verified");
} catch (error) {
  await connection.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
