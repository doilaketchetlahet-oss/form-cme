// Re-runnable function/trigger migration. Does not rewrite registrations or send mail.
// Uses SUPABASE_DB_URL; optionally CHECKIN_DB_POOLER_HOST for a known session pooler.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'), false, { info() {}, error() {} });
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(
  readFileSync(path.join(__dirname, '../src/lib/server/db.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, mod, mod.exports);
(async () => {
  let db = mod.exports.createDbClient();
  if (process.env.CHECKIN_DB_POOLER_HOST && process.env.SUPABASE_DB_URL) {
    const url = new URL(process.env.SUPABASE_DB_URL);
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
    db = new (require('pg').Client)({ host: process.env.CHECKIN_DB_POOLER_HOST, port: 5432, database: 'postgres',
      user: `postgres.${ref}`, password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  }
  if (!db) throw new Error('SUPABASE_DB_URL is not configured.');
  try {
    await db.connect();
    await db.query(readFileSync(path.join(__dirname, '../supabase/checkin-sessions.sql'), 'utf8'));
    const { rows } = await db.query("select has_function_privilege('anon','public.record_session_checkin(uuid,uuid,text,text,text,text)','execute') as anon, has_function_privilege('authenticated','public.record_session_checkin(uuid,uuid,text,text,text,text)','execute') as authenticated, has_function_privilege('service_role','public.record_session_checkin(uuid,uuid,text,text,text,text)','execute') as service");
    if (rows[0]?.anon || rows[0]?.authenticated || !rows[0]?.service) throw new Error('Unexpected RPC permissions.');
    console.log('Session check-in migration applied; hall validation RPC restricted to service_role.');
  } finally { await db.end(); }
})().catch((error) => {
  console.error('Session check-in migration failed:', error.code || (error.message.startsWith('SUPABASE_') ? error.message : 'database_error'));
  process.exitCode = 1;
});
