// PRIZE_TEST_DEPS supplies PGlite. Everything is synthetic / isolated.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');const {randomUUID,createHash}=require('node:crypto');const ts=require('typescript');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8').replace(/\r\n/g,'\n');
function load(file,mocks={}){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)(name=>mocks[name]??require(name),mod,mod.exports);return mod.exports;}
const lib=load('src/lib/prize-draw.ts',{'./normalize':load('src/lib/normalize.ts')});
test('field editor validates unique IDs, required phone, choices and conditional graphs',()=>{
  const phone=randomUUID(),name=randomUUID();const fields=[{id:phone,type:'phone',text:'Phone',required:true},{id:name,type:'text',text:'Name',required:true}];
  assert.equal(lib.validatePrizeFields(fields,phone).length,2);
  for(const invalid of [[fields[0],fields[0]],fields.map(f=>({...f,required:false})),[fields[0],{...fields[1],type:'choice',options:[]}],[fields[0],{...fields[1],show_if:{question_id:name,operator:'eq',value:1}}]])assert.throws(()=>lib.validatePrizeFields(invalid,phone));
  assert.equal(lib.prizeTextColor('#ffffff'),'#0f172a');assert.equal(lib.prizeTextColor('#000000'),'#ffffff');
});
test('standalone schema is included in fresh installs',()=>assert.ok(read('supabase/schema.sql').includes(read('supabase/prize-draw-standalone.sql').trim())));
test('real SQL: migrate existing awards, release CME deletion, standalone create/register, images and soft delete', {skip:!process.env.PRIZE_TEST_DEPS}, async()=>{
  const {PGlite}=createRequire(path.join(process.env.PRIZE_TEST_DEPS,'package.json'))('@electric-sql/pglite');const db=new PGlite();
  const schema=read('supabase/schema.sql'),table=name=>schema.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`))[0];
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create function can_manage_forms() returns boolean language sql as $$select false$$;
      ${table('quizzes')} ${table('surveys')} ${table('survey_questions')} ${table('survey_responses')}
      ${read('supabase/prize-draw.sql')}`);
    const admin=async(action,id,data)=>(await db.query('select prize_draw_admin($1,$2,$3,$4) id',[action,id,data,'synthetic@example.test'])).rows[0].id;
    const snap=async id=>({...(await db.query('select * from prize_campaigns where id=$1',[id])).rows[0],items:(await db.query('select * from prize_items where campaign_id=$1 order by position',[id])).rows});
    const seed=()=>admin('create',null,{name:'Synthetic',is_demo:true,starts_at:'2026-11-12T00:00:00+07:00',ends_at:'2026-11-25T00:00:00+07:00',items:lib.PRIZE_SAMPLE_ITEMS});
    const hash=n=>createHash('sha256').update(String(n)).digest('hex');
    const register=async(id,n)=>{const c=await snap(id);return (await db.query('select prize_draw_register($1,$2,$3,$4) entry',[id,hash(n),'09000'+String(n).padStart(5,'0'),{[c.phone_question_id]:'09000'+String(n).padStart(5,'0')}])).rows[0].entry;};
    const spin=async(id,n)=>(await db.query('select prize_draw_spin($1,$2) entry',[id,hash(n)])).rows[0].entry;
    const legacy=await seed();let c=await snap(legacy);const sid=c.survey_id;
    await admin('save',legacy,{...c,status:'active'});await register(legacy,1);const award=await spin(legacy,1);
    const migration=read('supabase/prize-draw-standalone.sql');await db.exec(migration);await db.exec(migration);
    c=await snap(legacy);assert.equal(c.survey_id,null);assert.equal(c.legacy_form_id,sid);assert.equal(c.form_fields.length,3);
    assert.equal((await spin(legacy,1)).claim_code,award.claim_code);
    assert.equal((await db.query('select prize_campaign_id from surveys where id=$1',[sid])).rows[0].prize_campaign_id,null);
    // Archived CME copies stay private even under an overly broad legacy policy.
    await db.exec('alter table survey_responses enable row level security; grant select on survey_responses to anon; create policy synthetic_public_read on survey_responses for select to anon using (true); set role anon');
    assert.equal((await db.query('select count(*)::int n from survey_responses where survey_id=$1',[sid])).rows[0].n,0);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from survey_responses where survey_id=$1',[sid])).rows[0].n,1);
    assert.ok(c.items.every(p=>p.image_url.startsWith('/prize-draw/gifts/')));
    await db.query("update prize_items set image_url='' where id=$1",[c.items[0].id]);await db.exec(migration);
    assert.equal((await snap(legacy)).items[0].image_url,'');
    // The old form is now deletable without impacting the independent ledger.
    await db.query('delete from surveys where id=$1',[sid]);assert.equal((await spin(legacy,1)).prize_id,award.prize_id);
    const before=(await db.query('select count(*)::int n from surveys')).rows[0].n;
    // New live campaigns need no schedule; historical future/past windows are inert.
    const manual=await admin('create',null,{name:'Manual live',is_demo:false,items:lib.PRIZE_SAMPLE_ITEMS});
    let m=await snap(manual);assert.equal(m.starts_at,null);assert.equal(m.ends_at,null);
    await admin('save',manual,{...m,status:'active',starts_at:undefined,ends_at:undefined});
    await db.query("update prize_campaigns set starts_at='2099-01-01',ends_at='2100-01-01' where id=$1",[manual]);
    await register(manual,10);await spin(manual,10);
    await db.query("update prize_campaigns set starts_at='2000-01-01',ends_at='2001-01-01' where id=$1",[manual]);
    await register(manual,11);await spin(manual,11);await register(manual,12);
    for(const status of ['draft','paused','closed']) {
      m=await snap(manual);await admin('save',manual,{...m,status});
      await assert.rejects(register(manual,13),/NOT_ACTIVE/);await assert.rejects(spin(manual,12),/NOT_ACTIVE/);
      assert.ok((await spin(manual,10)).prize_id);
    }
    m=await snap(manual);await admin('save',manual,{...m,status:'active'});await spin(manual,12);
    const fresh=await seed();let f=await snap(fresh);assert.equal(f.survey_id,null);assert.equal(f.form_fields.length,3);
    assert.equal((await db.query('select count(*)::int n from surveys')).rows[0].n,before);
    await admin('save',fresh,{...f,status:'active',items:f.items.map(p=>({...p,image_url:'https://images.example.test/gift.webp'}))});
    await assert.rejects(db.query('select prize_draw_register_current($1,$2,$3,$4,$5)',[fresh,hash(99),'0900000099',{},f.revision]),/STALE_REVISION/);
    f=await snap(fresh);
    await db.query('select prize_draw_register_current($1,$2,$3,$4,$5)',[fresh,hash(2),'0900000002',{[f.phone_question_id]:'0900000002'},f.revision]);
    await register(fresh,2);const prize=await spin(fresh,2);assert.equal(prize.prize_image_url,'https://images.example.test/gift.webp');
    f=await snap(fresh);await assert.rejects(admin('save',fresh,{...f,form_fields:f.form_fields.slice(1)}),/FORM_LOCKED|PHONE_QUESTION_INVALID/);
    await assert.rejects(admin('save',fresh,{...f,items:f.items.map(p=>({...p,total:0}))}),/BELOW_DISTRIBUTED/);
    await admin('save',fresh,{...f,form_title:'Independent form',items:f.items.map(p=>({...p,image_url:'https://images.example.test/new.webp'}))});
    assert.equal((await spin(fresh,2)).prize_image_url,prize.prize_image_url);
    f=await snap(fresh);await assert.rejects(admin('delete',fresh,{revision:f.revision-1}),/STALE_REVISION/);
    await admin('delete',fresh,{revision:f.revision});
    await assert.rejects(register(fresh,3),/NOT_FOUND/);await assert.rejects(spin(fresh,2),/NOT_FOUND/);await assert.rejects(admin('save',fresh,f),/NOT_FOUND/);
    assert.equal((await db.query('select count(*)::int n from prize_entries where campaign_id=$1',[fresh])).rows[0].n,1);
    await db.exec(migration);assert.ok((await snap(fresh)).deleted_at);assert.equal((await snap(fresh)).form_title,'Independent form');
    await db.exec('set role authenticated');await assert.rejects(db.query('select * from prize_entries'),/permission denied/);
  } finally {await db.close();}
});
test('asset upload: tool permission first; actual image decode, normalized WebP, invalid/oversized files',async()=>{
  let allowed=false,exists=true,writes=0;const sharp=require('sharp');
  const chain={select(){return this;},eq(){return this;},is(){return this;},maybeSingle:async()=>({data:exists?{id:'ok'}:null})};
  const service={from(){return chain;},storage:{from(bucket){assert.equal(bucket,'prize-assets');return {async upload(key,buffer,options){writes++;assert.match(key,/\.webp$/);assert.equal(options.contentType,'image/webp');assert.equal((await sharp(buffer).metadata()).format,'webp');return {error:null};},getPublicUrl(key){return {data:{publicUrl:'https://images.example.test/'+key}};}};}}};
  const route=load('src/app/api/admin/prize-draw/asset/route.ts',{'@/lib/server/admin-api':{authorizeAdminApi:async(_req,write,tool)=>{assert.equal(write,true);assert.equal(tool,'prize-draw');return allowed?{service}:{error:'Forbidden',status:403};}},'@/lib/prize-draw':lib});
  const req=(buffer,type='image/png')=>{const form=new FormData();form.set('campaign_id',randomUUID());form.set('file',new Blob([buffer],{type}),'image.png');return new Request('https://test.local/api/admin/prize-draw/asset',{method:'POST',body:form});};
  const png=await sharp({create:{width:10,height:10,channels:3,background:'#0284c7'}}).png().toBuffer();
  assert.equal((await route.POST(req(png))).status,403);allowed=true;
  assert.equal((await route.POST(req('invalid'))).status,400);assert.equal((await route.POST(req('<svg/>','image/svg+xml'))).status,400);
  exists=false;assert.equal((await route.POST(req(png))).status,404);exists=true;
  assert.equal((await route.POST(req(Buffer.alloc(4*1024*1024+1)))).status,400);
  const response=await route.POST(req(png));assert.equal(response.status,200);assert.match((await response.json()).url,/\.webp$/);assert.equal(writes,1);
});
