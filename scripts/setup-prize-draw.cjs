// Apply additive migration. --seed-demo creates one reusable demo configuration,
// no registrations or emails. Existing demo/stock is never reset.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));
function load(file, mocks={}) {
  const mod={exports:{}};
  new Function('require','module','exports',ts.transpileModule(readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>mocks[name]??require(name),mod,mod.exports);
  return mod.exports;
}
const sample=load('src/lib/prize-draw.ts',{'./normalize':load('src/lib/normalize.ts')});
(async()=>{
  let db=load('src/lib/server/db.ts').createDbClient();
  const host=process.env.PRIZE_DB_POOLER_HOST || process.env.CHECKIN_DB_POOLER_HOST || process.env.GAME_SHARE_DB_POOLER_HOST;
  if(host && process.env.SUPABASE_DB_URL) {
    const url=new URL(process.env.SUPABASE_DB_URL);
    const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
    db=new (require('pg').Client)({host,port:5432,database:'postgres',user:`postgres.${ref}`,password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
  }
  if(!db) throw new Error('SUPABASE_DB_URL is not configured.');
  try {
    await db.connect();await db.query('begin');
    const installed=(await db.query("select to_regclass('public.prize_entries') is not null as installed")).rows[0].installed;
    const ledger=async()=> (await db.query('select (select count(*)::int from prize_campaigns) campaigns, (select count(*)::int from prize_entries) entries, (select count(*)::int from prize_entries where prize_id is not null) awards, (select coalesce(sum(total),0)::int from prize_items) total, (select coalesce(sum(remaining),0)::int from prize_items) remaining')).rows[0];
    const before=installed?await ledger():null;
    await db.query(readFileSync(path.join(__dirname,'../supabase/prize-draw.sql'),'utf8'));
    await db.query(readFileSync(path.join(__dirname,'../supabase/prize-draw-permissions.sql'),'utf8'));
    await db.query(readFileSync(path.join(__dirname,'../supabase/prize-draw-standalone.sql'),'utf8'));
    const after=await ledger();
    if(before && JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Ledger preservation verification failed.');
    const perms=await db.query("select has_table_privilege('anon','prize_entries','select') a,has_function_privilege('authenticated','prize_draw_spin(uuid,text)','execute') b");
    if(perms.rows[0].a || perms.rows[0].b) throw new Error('Permission verification failed.');
    let id;
    if(process.argv.includes('--seed-demo')) {
      const existing=await db.query("select id from prize_campaigns where is_demo and deleted_at is null and name='DEMO · Merap · Vòng quay nhận quà' order by created_at limit 1");
      id=existing.rows[0]?.id;
      if(!id) {
        const owner=(await db.query("select email from admin_members where active and role='owner' order by created_at limit 1")).rows[0]?.email;
        if(!owner) throw new Error('An active owner is required to seed the demo.');
        const created=await db.query('select prize_draw_admin($1,null,$2,$3) id',['create',{name:'DEMO · Merap · Vòng quay nhận quà',is_demo:true,starts_at:sample.PRIZE_SAMPLE_START,ends_at:sample.PRIZE_SAMPLE_END,items:sample.PRIZE_SAMPLE_ITEMS},owner]);
        id=created.rows[0].id;
        const c=(await db.query('select * from prize_campaigns where id=$1',[id])).rows[0];
        const items=(await db.query('select * from prize_items where campaign_id=$1 order by position',[id])).rows;
        await db.query('select prize_draw_admin($1,$2,$3,$4)',['save',id,{...c,status:'active',items},owner]);
      }
    }
    await db.query('commit');
    console.log('Prize draw migration applied; table/RPC permissions verified.');
    if(before) console.log('Preserved campaign/registration/award counts and stock:',JSON.stringify(after));
    if(id) {
      console.log(`Demo: /prize-draw/${id}\nForm: /prize-draw/${id}/register`);
    }
  } finally { await db.end(); }
})().catch(error=>{console.error('Prize draw setup failed:',error.code || (error.message.startsWith('SUPABASE_')?error.message:'database_error'));process.exitCode=1;});
