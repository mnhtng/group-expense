/**
 * Connection selection for SQL migration scripts.
 * DATABASE_URL: pooled runtime connection, DATABASE_URL_DIRECT: direct migration connection.
 * Never print connection strings or passwords.
 */
function parseConnectionString(value, label) {
  if (!value) throw new Error(`${label} is required; configure it outside Git.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a PostgreSQL URL.`); }
  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    throw new Error(`${label} must use the PostgreSQL protocol.`);
  }
  return url;
}

function isNeon(url) {
  return url.hostname.endsWith(".neon.tech");
}

function isPooled(url) {
  return /-pooler\./.test(url.hostname);
}

function ensureNeonTls(url, label) {
  if (isNeon(url) && !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode"))) {
    throw new Error(`${label} requires sslmode=require (or a stronger verification mode) for Neon.`);
  }
}

export function resolveDatabaseUrl(mode, env = process.env) {
  const runtime = parseConnectionString(env.DATABASE_URL, "DATABASE_URL");
  ensureNeonTls(runtime, "DATABASE_URL");

  if (mode === "runtime") return runtime.toString();
  if (mode !== "migration") throw new Error("Unknown database connection mode.");

  const direct = env.DATABASE_URL_DIRECT
    ? parseConnectionString(env.DATABASE_URL_DIRECT, "DATABASE_URL_DIRECT")
    : null;

  if (isNeon(runtime) && !direct) {
    throw new Error("Neon migrations require DATABASE_URL_DIRECT. Never run migrations against the pooled URL.");
  }
  const selected = direct ?? runtime;
  ensureNeonTls(selected, direct ? "DATABASE_URL_DIRECT" : "DATABASE_URL");
  if (isNeon(selected) && isPooled(selected)) {
    throw new Error("Neon migration URL must be direct (without -pooler in the host).");
  }
  if (direct && (direct.hostname !== runtime.hostname || direct.pathname !== runtime.pathname)) {
    // A pooled Neon URL should differ by only the -pooler suffix; other host/db differences risk modifying another database.
    const sameNeonHost =
      isNeon(runtime) &&
      isNeon(direct) &&
      runtime.hostname.replace("-pooler.", ".") === direct.hostname;
    if (!sameNeonHost || direct.pathname !== runtime.pathname) {
      throw new Error("Migration and runtime URLs must point to the same Neon endpoint and database.");
    }
  }
  return selected.toString();
}
