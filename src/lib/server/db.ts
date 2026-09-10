import { Client, type ClientConfig } from "pg";

export function createDbClient() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return null;

  return new Client({
    ...parsePostgresUrl(dbUrl),
    ssl: dbUrl.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
}

function parsePostgresUrl(dbUrl: string): ClientConfig {
  try {
    const url = new URL(dbUrl);
    return {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: url.pathname.replace(/^\//, "") || "postgres",
    };
  } catch {
    const match = dbUrl.match(/^postgres(?:ql)?:\/\/([^:]+):(.+)@([^:/]+):(\d+)\/([^?]+)(?:\?.*)?$/);
    if (!match) throw new Error("SUPABASE_DB_URL không đúng định dạng Postgres URI.");
    const [, user, password, host, port, database] = match;
    return {
      user,
      password,
      host,
      port: Number(port),
      database,
    };
  }
}
