// Apply the additive sharing migration using the configured database URL.
// Does not print credentials or connect through the public browser client.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require("@next/env").loadEnvConfig(path.resolve(__dirname, ".."));
const mod = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(
  readFileSync(path.join(__dirname, "../src/lib/server/db.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, mod, mod.exports);
(async () => {
  let db = mod.exports.createDbClient();
  // An IPv6-only direct hostname may be unreachable on this Windows network.
  // Set this to the project's Supabase pooler host when applying the migration.
  if (process.env.GAME_SHARE_DB_POOLER_HOST && process.env.SUPABASE_DB_URL) {
    const url = new URL(process.env.SUPABASE_DB_URL);
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    db = new (require("pg").Client)({ host: process.env.GAME_SHARE_DB_POOLER_HOST, port: 5432, database: "postgres",
      user: `postgres.${ref}`, password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  }
  if (!db) throw new Error("SUPABASE_DB_URL is not configured.");
  try {
    await db.connect();
    await db.query("begin");
    await db.query(readFileSync(path.join(__dirname, "../supabase/game-shares.sql"), "utf8"));
    await db.query("notify pgrst, 'reload schema'");
    await db.query("commit");
    const { rows } = await db.query("select has_table_privilege('anon','public.game_project_shares','select') as anon, has_table_privilege('authenticated','public.game_project_shares','select') as authenticated, relrowsecurity as rls from pg_class where oid='public.game_project_shares'::regclass");
    if (rows[0]?.anon || rows[0]?.authenticated || !rows[0]?.rls) throw new Error("Unexpected sharing table permissions.");
    console.log("Game sharing migration applied; browser roles have no table access and RLS is enabled.");
  } finally { await db.end(); }
})().catch((error) => {
  // Connection errors can include infrastructure details. Keep output minimal.
  console.error("Game sharing migration failed:", error.code || (error.message.startsWith("SUPABASE_") ? error.message : "database_error"));
  process.exitCode = 1;
});
