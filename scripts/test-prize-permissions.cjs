// Synthetic auth and isolated PostgreSQL only; no production writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const ts=require('typescript');
const read=file=>readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
function load(file,mocks){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>mocks[name]??require(name),mod,mod.exports);return mod.exports;}

test('real authorization + tool routes: explicit grants, roles, revocation and missing schema fail closed',async()=>{
  const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  const saved=keys.map(k=>process.env[k]);
  keys.forEach((k,i)=>process.env[k]=i===0?'https://synthetic.supabase.co':'synthetic');
  let member={role:'owner',active:true,prize_draw_enabled:false},memberError=null,valid=true,reads=0,writes=0;
  const service={from(table){
    if(table==='admin_members')return {select(){return this;},ilike(){return this;},eq(){return this;},async maybeSingle(){return {data:member,error:memberError};}};
    reads++;
    return {select(){return this;},eq(){return this;},is(){return this;},async order(){return {data:[],error:null};}};
  },async rpc(){writes++;return {data:'synthetic',error:null};}};
  const auth=load('src/lib/server/admin-api.ts',{'@supabase/supabase-js':{createClient(_url,_key,options){return options.global?{auth:{getUser:async()=>({data:{user:valid?{email:'owner@example.test'}:null},error:null})}}:service;}}});
  const route=load('src/app/api/admin/prize-draw/route.ts',{
    '@/lib/server/admin-api':auth,
    '@/lib/server/prize-draw':{prizeError(){throw Error('Unexpected data error');}},
    '@/lib/prize-draw':{PRIZE_SAMPLE_ITEMS:[]},
  });
  const request=(method,token=true)=>new Request('https://test.local/api/admin/prize-draw',{method,headers:token?{authorization:'Bearer synthetic'}:{},...(method==='POST'?{body:JSON.stringify({action:'create'})}:{})});
  try {
    for(const method of ['GET','POST'])assert.equal((await route[method](request(method,false))).status,401);
    valid=false;assert.equal((await route.GET(request('GET'))).status,401);valid=true;
    for(const role of ['owner','admin','viewer'])for(const flag of [false,undefined]){
      member={role,active:true,prize_draw_enabled:flag};
      for(const method of ['GET','POST'])assert.equal((await route[method](request(method))).status,403);
    }
    member={role:'admin',active:false,prize_draw_enabled:true};assert.equal((await route.GET(request('GET'))).status,403);
    member=null;assert.equal((await route.GET(request('GET'))).status,403);
    memberError={message:'column missing'};assert.equal((await route.GET(request('GET'))).status,500);memberError=null;
    assert.equal(reads,0);assert.equal(writes,0);
    for(const role of ['owner','admin','viewer']){
      member={role,active:true,prize_draw_enabled:true};
      assert.equal((await route.GET(request('GET'))).status,200);
      assert.equal((await route.POST(request('POST'))).status,role==='viewer'?403:200);
    }
    member.prize_draw_enabled=false;
    const before=reads;assert.equal((await route.GET(request('GET'))).status,403);assert.equal(reads,before);
    assert.equal(writes,2);
    assert.ok(!('error' in await auth.authorizeAdminApi(request('GET')))); // Other tools unchanged.
  } finally {keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
});

test('fresh schema and bootstrap include the same additive permission migration',()=>{
  const sql=read('supabase/prize-draw-permissions.sql').trim();
  for(const file of ['supabase/schema.sql','supabase/authorization.sql','src/app/api/admin/permissions/bootstrap/route.ts'])assert.ok(read(file).includes(sql),file);
});

test('SQL: existing/new owners default off; only owners grant/revoke, rerun preserves grants', {skip:!process.env.PRIZE_TEST_DEPS},async()=>{
  const deps=createRequire(path.join(process.env.PRIZE_TEST_DEPS,'package.json'));
  const {PGlite}=deps('@electric-sql/pglite');const db=new PGlite();
  try {
    await db.exec(`create role authenticated;create schema auth;
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('test.email',true))$$;
      grant usage on schema auth to authenticated;
      create table admin_members(id uuid primary key default gen_random_uuid(), email text unique,role text,active boolean default true,created_at timestamptz default now());
      insert into admin_members(email,role) values('owner@example.test','owner'),('admin@example.test','admin'),('viewer@example.test','viewer');
      create table quizzes(id uuid);create table surveys(id uuid);create table survey_questions(id uuid);`);
    const sql=read('supabase/prize-draw-permissions.sql');await db.exec(sql);
    const auth=read('supabase/authorization.sql');await db.exec(auth.slice(auth.indexOf('create or replace function current_admin_role()'),auth.indexOf('drop policy if exists "owners read quizzes"')));
    assert.deepEqual((await db.query('select distinct prize_draw_enabled flag from admin_members')).rows,[{flag:false}]);
    await db.exec('grant select,insert,update,delete on admin_members to authenticated;set role authenticated;');
    for(const role of ['admin','viewer']){
      await db.query("select set_config('test.email',$1,false)",[role+'@example.test']);
      assert.equal((await db.query('update admin_members set prize_draw_enabled=true returning id')).rows.length,0);
      await assert.rejects(db.query("insert into admin_members(email,role,prize_draw_enabled) values('intruder@example.test','owner',true)"),/row-level security/);
    }
    await db.query("select set_config('test.email','owner@example.test',false)");
    assert.equal((await db.query("update admin_members set prize_draw_enabled=true where role in ('owner','admin') returning id")).rows.length,2);
    await db.exec('reset role');await db.exec(sql);
    assert.equal((await db.query('select count(*)::int n from admin_members where prize_draw_enabled')).rows[0].n,2);
    await db.exec("set role authenticated;update admin_members set prize_draw_enabled=false where role='admin';insert into admin_members(email,role) values('new@example.test','owner');reset role;");
    assert.equal((await db.query('select count(*)::int n from admin_members where prize_draw_enabled')).rows[0].n,1);
  } finally {await db.close();}
});
