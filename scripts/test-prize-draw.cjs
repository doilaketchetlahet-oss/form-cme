// node --test scripts/test-prize-draw.cjs
// PRIZE_TEST_DEPS points to a directory containing @electric-sql/pglite.
// All records are synthetic and isolated in an in-memory PostgreSQL engine.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const source = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => mocks[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const normalize = load('src/lib/normalize.ts');
const lib = load('src/lib/prize-draw.ts', { './normalize': normalize });
const q = (id, type, extra = {}) => ({ id, type, text: id, options: null, required: true, show_if: null, ...extra });
const fields = [q('name','text'),q('phone','phone'),q('choice','choice',{options:['A','B']})];

test('fresh schema includes the same re-runnable prize migration', () => {
  const normalize=s=>s.replace(/\r\n/g,'\n').trim();
  assert.ok(normalize(readFileSync(path.join(root,'supabase/schema.sql'),'utf8')).includes(normalize(readFileSync(path.join(root,'supabase/prize-draw.sql'),'utf8'))));
});

test('normalizes phones and rejects missing, malformed, hidden-identity or impossible form answers', () => {
  const valid = {name:'Nguyễn An',phone:'+84 900 123 456',choice:0};
  assert.equal(lib.validatePrizeAnswers(fields,'phone',valid).phone,'0900123456');
  for (const patch of [{phone:'123'}, {phone:null}, {name:'  '}, {choice:3}, {choice:'0'}, {choice:[0,0]}, {phone:12}, {name:'x'.repeat(5001)}]) assert.throws(() => lib.validatePrizeAnswers(fields,'phone',{...valid,...patch}));
  const conditional = [...fields,q('reason','paragraph',{show_if:{question_id:'choice',operator:'eq',value:1}})];
  assert.equal(lib.validatePrizeAnswers(conditional,'phone',valid).answers.reason,undefined);
  assert.throws(() => lib.validatePrizeAnswers(conditional,'phone',{...valid,choice:1}));
  assert.ok(lib.prizeFormError(fields.map(f => f.id==='phone'?{...f,required:false}:f),'phone'));
  assert.ok(lib.prizeFormError([...fields,q('face','face_checkin')],'phone'));
  assert.throws(() => lib.validatePrizeAnswers([...fields,q('r','rating')],'phone',{...valid,r:6}));
});

test('Vietnam inclusive start/exclusive end, demo and sold-out rules; CSV injection protection', () => {
  const campaign = { status:'active', is_demo:false, starts_at:lib.PRIZE_SAMPLE_START, ends_at:lib.PRIZE_SAMPLE_END };
  const items=[{remaining:1}];
  assert.ok(lib.prizeAvailability(campaign,items,Date.parse('2026-11-11T23:59:59+07:00')));
  assert.equal(lib.prizeAvailability(campaign,items,Date.parse('2026-11-12T00:00:00+07:00')),null);
  assert.equal(lib.prizeAvailability(campaign,items,Date.parse('2026-11-24T23:59:59+07:00')),null);
  assert.ok(lib.prizeAvailability(campaign,items,Date.parse('2026-11-25T00:00:00+07:00')));
  assert.equal(lib.prizeAvailability({...campaign,is_demo:true},items,0),null);
  assert.ok(lib.prizeAvailability({...campaign,is_demo:true},[{remaining:0}],0));
  assert.ok(lib.prizeAvailability({...campaign,is_demo:true,status:'paused'},items,0));
  assert.match(lib.prizeCsvCell('=HYPERLINK("bad")'),/^"'/);
});

test('shared wheel always lands at the server-selected segment, including one prize', () => {
  const {nextWheelRotation} = load('src/components/ui/PrizeWheel.tsx');
  for (const count of [1,2,4,12,40]) for(let index=0;index<count;index++) {
    const rotation=nextWheelRotation(1832,index,count);
    assert.ok(rotation>=1832+1800);
    assert.ok(Math.abs(((rotation+(index+.5)*360/count)%360))<1e-8 || Math.abs(((rotation+(index+.5)*360/count)%360)-360)<1e-8);
  }
});

test('public response redacts identity, token hashes and unearned claim codes', () => {
  const server = load('src/lib/server/prize-draw.ts');
  const entry = {id:'entry',prize_id:null,phone:'0900123456',token_hash:'secret',answers:{name:'private'},claim_code:'hidden'};
  const result=server.publicPrizeEntry(entry);
  assert.equal(result.claim_code,'');
  for(const key of ['phone','token_hash','answers']) assert.equal(result[key],undefined);
});

test('public API requires origin/session; validates answers and returns only safe fields', async () => {
  const {NextRequest}=require('next/server');
  const id=randomUUID(); let rpcCalls=[]; let campaign={form_fields:fields,phone_question_id:'phone'};
  const service={
    from(name) { assert.notEqual(name,'survey_questions'); const chain={select(){return chain;},eq(){return chain;},is(){return chain;},order(){return chain;},
      maybeSingle:async()=>({data:name==='prize_campaigns'?campaign:null,error:null}),
      then(resolve,reject){return Promise.resolve({data:fields,error:null}).then(resolve,reject);}}; return chain; },
    async rpc(name,args){rpcCalls.push({name,args});return {data:{id:'safe',prize_id:null,phone:args.p_phone,token_hash:args.p_hash,answers:args.p_answers,claim_code:'hidden'},error:null};}
  };
  const server=load('src/lib/server/prize-draw.ts');
  const route=load('src/app/api/prize-draw/[id]/route.ts',{
    '@/lib/server/booth-public-access':{createBoothServiceClient:()=>service,checkPublicBoothRateLimit:()=>true},
    '@/lib/server/prize-draw':server,'@/lib/prize-draw':lib,
  });
  const post=(body,headers={})=>route.POST(new NextRequest(`https://test.local/api/prize-draw/${id}`,{method:'POST',headers:{origin:'https://test.local',cookie:`prize_${id}=${'a'.repeat(64)}`,...headers},body:JSON.stringify(body)}),{params:Promise.resolve({id})});
  assert.equal((await post({action:'spin'},{origin:'https://evil.local'})).status,403);
  assert.equal((await post({action:'spin'},{cookie:''})).status,401);
  assert.equal((await post({action:'register',answers:{}})).status,400);
  assert.equal(rpcCalls.length,0);
  const response=await post({action:'register',answers:{name:'Test',phone:'+84900123456',choice:0}});
  assert.equal(response.status,200);
  assert.equal(rpcCalls[0].args.p_phone,'0900123456');
  const result=await response.json();
  assert.equal(result.entry.phone,undefined);assert.equal(result.entry.token_hash,undefined);
  await post({action:'spin'});assert.equal(rpcCalls[1].name,'prize_draw_spin');
});

test('admin API rejects viewers and malformed stock before calling SQL', async () => {
  let writable=false;let calls=0;
  const route=load('src/app/api/admin/prize-draw/route.ts',{
    '@/lib/server/admin-api':{authorizeAdminApi:async(_request,write)=>{assert.equal(write,true);return writable?{email:'admin@example.test',service:{rpc:async()=>{calls++;return {data:randomUUID()};}}}:{error:'read only',status:403};}},
    '@/lib/server/prize-draw':load('src/lib/server/prize-draw.ts'),'@/lib/prize-draw':lib,
  });
  const post=body=>route.POST(new Request('https://test.local/api/admin/prize-draw',{method:'POST',body:JSON.stringify(body)}));
  assert.equal((await post({action:'create'})).status,403);writable=true;
  assert.equal((await post({action:'save',id:randomUUID(),data:{revision:1,name:'Test',status:'active',starts_at:lib.PRIZE_SAMPLE_START,ends_at:lib.PRIZE_SAMPLE_END,accent_color:'#123456',instructions:'',banner_url:'',track_redemption:true,items:[{name:'Gift',color:'#123456',total:-1}]}})).status,400);
  assert.equal(calls,0);assert.equal((await post({action:'create'})).status,200);assert.equal(calls,1);
});

const deps=process.env.PRIZE_TEST_DEPS?createRequire(path.join(process.env.PRIZE_TEST_DEPS,'package.json')):null;
test('real SQL: atomic stock, retries, phone dedupe, live windows, edits, redemption, RLS and persistent ledger', {skip:!deps}, async()=>{
  const {PGlite}=deps('@electric-sql/pglite');const db=new PGlite();
  const schema=readFileSync(path.join(root,'supabase/schema.sql'),'utf8');
  const table=name=>schema.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`))[0];
  const migration=readFileSync(path.join(root,'supabase/prize-draw.sql'),'utf8');
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create function is_admin_member() returns boolean language sql as $$select false$$;
      create function can_manage_forms() returns boolean language sql as $$select false$$;
      ${table('quizzes')} ${table('surveys')} ${table('survey_questions')} ${table('survey_responses')}
      alter table survey_responses enable row level security;
      create policy legacy_public on survey_responses for all using(true) with check(true);
      grant all on survey_responses to anon,authenticated;
      ${migration}`);
    await db.exec(migration); // safe re-run
    const admin=async(action,id,data)=>(await db.query('select prize_draw_admin($1,$2,$3,$4) id',[action,id,data,'test@example.test'])).rows[0].id;
    const seed=async(demo=true)=>admin('create',null,{name:'Synthetic test',is_demo:demo,starts_at:lib.PRIZE_SAMPLE_START,ends_at:lib.PRIZE_SAMPLE_END,items:lib.PRIZE_SAMPLE_ITEMS.map(p=>({...p,total:1}))});
    const hash=n=>createHash('sha256').update(String(n)).digest('hex');
    const snapshot=async id=>({...(await db.query('select * from prize_campaigns where id=$1',[id])).rows[0],items:(await db.query('select * from prize_items where campaign_id=$1 order by position',[id])).rows});
    const register=async(id,n,phone=`09000${String(n).padStart(5,'0')}`)=>{
      const c=await snapshot(id);
      return (await db.query('select prize_draw_register($1,$2,$3,$4) result',[id,hash(n),phone,{[c.phone_question_id]:phone}])).rows[0].result;
    };
    const spin=async(id,n)=>(await db.query('select prize_draw_spin($1,$2) result',[id,hash(n)])).rows[0].result;
    const id=await seed();
    await assert.rejects(register(id,1),/NOT_ACTIVE/);
    let c=await snapshot(id);await admin('save',id,{...c,status:'active'});
    const first=await register(id,1);assert.equal((await register(id,1)).id,first.id);
    await assert.rejects(register(id,2,'0900000001'),/PHONE_USED/);
    await Promise.all([register(id,2),register(id,3),register(id,4),register(id,5)]);
    const same=await Promise.all(Array.from({length:6},()=>spin(id,1)));
    assert.equal(new Set(same.map(r=>r.prize_id)).size,1);
    c=await snapshot(id);assert.equal(c.items.reduce((n,p)=>n+p.remaining,0),3);
    const race=await Promise.allSettled([2,3,4,5].map(n=>spin(id,n)));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,3);
    assert.match(race.find(r=>r.status==='rejected').reason.message,/SOLD_OUT/);
    c=await snapshot(id);assert.ok(c.items.every(p=>p.remaining===0));
    assert.equal((await db.query('select count(distinct prize_id)::int n from prize_entries where campaign_id=$1 and prize_id is not null',[id])).rows[0].n,4);
    await assert.rejects(register(id,6),/SOLD_OUT/);
    await assert.rejects(admin('save',id,{...c,revision:0}),/STALE_REVISION/);
    await assert.rejects(admin('save',id,{...c,items:c.items.map(p=>({...p,total:0}))}),/BELOW_DISTRIBUTED/);
    await assert.rejects(admin('save',id,{...c,items:c.items.slice(1)}),/PRIZES_LOCKED/);
    await admin('save',id,{...c,status:'paused',items:c.items.map(p=>({...p,total:2}))});
    const old=await spin(id,1);assert.equal(old.id,first.id);assert.equal(old.drawn_at,same[0].drawn_at);
    const loser=[2,3,4,5][race.findIndex(r=>r.status==='rejected')];
    await assert.rejects(spin(id,loser),/NOT_ACTIVE/);
    await admin('redeem',id,{entry_id:first.id});
    const redeemed=await spin(id,1);assert.ok(redeemed.redeemed_at);
    await admin('redeem',id,{entry_id:first.id});assert.equal((await spin(id,1)).redeemed_at,redeemed.redeemed_at);
    await db.query('delete from survey_responses where id=$1',[first.response_id]);
    assert.equal((await spin(id,1)).response_id,null);
    await assert.rejects(register(id,7,'0900000001'),/PHONE_USED/);
    await assert.rejects(db.query("update survey_questions set required=false where id=$1",[c.phone_question_id]),/SĐT/);
    await assert.rejects(db.query("update surveys set prize_campaign_id=null where id=$1",[c.survey_id]),/liên kết/);
    await assert.rejects(db.query("update surveys set form_type='registration' where id=$1",[c.survey_id]),/loại khảo sát/);
    await db.exec('set role anon');
    for(const name of ['prize_campaigns','prize_items','prize_entries']) await assert.rejects(db.query(`select * from ${name}`),/permission denied/);
    await assert.rejects(spin(id,1),/permission denied/);
    assert.equal((await db.query('select * from survey_responses where survey_id=$1',[c.survey_id])).rows.length,0);
    await assert.rejects(db.query('insert into survey_responses(survey_id,answers) values($1,$2)',[c.survey_id,{}]),/row-level security/);
    await db.exec('reset role');
    const live=await seed(false);let l=await snapshot(live);
    await admin('save',live,{...l,status:'active',starts_at:'2099-11-12T00:00:00+07:00',ends_at:'2099-11-25T00:00:00+07:00'});
    await assert.rejects(register(live,50),/OUTSIDE_WINDOW/);
    l=await snapshot(live);await admin('save',live,{...l,starts_at:'2000-01-01T00:00:00Z',ends_at:'2099-01-01T00:00:00Z'});
    await register(live,1); // same phone in separate campaign is permitted
    l=await snapshot(live);await admin('save',live,{...l,ends_at:'2001-01-01T00:00:00Z'});
    await assert.rejects(spin(live,1),/OUTSIDE_WINDOW/);
    const permissions=(await db.query("select has_function_privilege('anon','prize_draw_spin(uuid,text)','execute') as spin,has_table_privilege('authenticated','prize_entries','select') as entries")).rows[0];
    assert.deepEqual(permissions,{spin:false,entries:false});
  } finally {await db.close();}
});
