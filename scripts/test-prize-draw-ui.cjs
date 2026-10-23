// Start app on port 3111. PRIZE_TEST_DEPS supplies Playwright.
// Auth, registrations, stock and API writes are mocked; no real records/emails.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const {mkdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const deps=process.env.PRIZE_TEST_DEPS?createRequire(path.join(process.env.PRIZE_TEST_DEPS,'package.json')):require;
const {chromium}=deps('playwright');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const base=process.env.PRIZE_E2E_BASE || 'http://localhost:3111';
const host=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const shots=path.join(tmpdir(),'form-cme-prize-ui');mkdirSync(shots,{recursive:true});
const user={id:randomUUID(),email:'admin@example.test',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{}};
const exp=Math.floor(Date.now()/1000)+3600;
const token=`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp})).toString('base64url')}.test-only`;
const session={access_token:token,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:exp,user};
let browser;
async function run(viewport) {
  const id=randomUUID(),sid=randomUUID();
  const questions=['Họ và tên','Số điện thoại','Đơn vị / Công ty'].map((text,i)=>({id:randomUUID(),survey_id:sid,text,type:i===1?'phone':'text',position:i,required:i<2,options:null,allow_multiple:false,show_if:null}));
  let campaign={id,form_fields:questions,form_title:'Đăng ký nhận quà Merap',form_description:'Điền thông tin để nhận một lượt quay và khám phá phần quà dành cho bạn.',thank_you_message:'Cảm ơn bạn! Mời bạn quay nhận quà.',phone_question_id:questions[1].id,name:'DEMO · Merap · Vòng quay nhận quà',status:'active',is_demo:true,starts_at:'2026-11-12T00:00:00+07:00',ends_at:'2026-11-25T00:00:00+07:00',accent_color:'#0284c7',banner_url:'',instructions:'Vui lòng đưa mã nhận quà cho nhân viên tại booth.',track_redemption:true,revision:1};
  let items=['Bình nước','Túi vải','Ô cầm tay','Bộ quà đặc biệt'].map((name,i)=>({id:randomUUID(),name,color:['#0284c7','#7c3aed','#db2777','#d97706'][i],total:[120,90,60,30][i],remaining:[120,90,60,30][i],position:i}));
  items=items.map((p,i)=>({...p,image_url:`/prize-draw/gifts/${['bottle','bag','umbrella','gift'][i]}.svg`}));
  let entry=null,records=[],spins=0,registrations=0,dropSpin=false,failSnapshot=false,role='owner',creates=0,toolAllowed=true,adminCalls=0,permissionWrites=0,uploads=0,deletes=0,deleted=false;
  const context=await browser.newContext({viewport,reducedMotion:'reduce',hasTouch:viewport.width<600});
  const errors=[];const blockedWrites=[];
  try {
    await context.addInitScript(({host,session})=>localStorage.setItem(`sb-${host.split('.')[0]}-auth-token`,JSON.stringify(session)),{host,session});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());let data;
      if(url.host===host) {
        if(url.pathname.endsWith('/admin_members')) {
          if(req.method()==='PATCH') {
            assert.equal(role,'owner');toolAllowed=req.postDataJSON().prize_draw_enabled;permissionWrites++;
            data={id:user.id};
          } else {
            assert.equal(req.method(),'GET');
            const member={id:user.id,email:user.email,role,active:true,prize_draw_enabled:toolAllowed,created_at:new Date().toISOString()};
            data=url.searchParams.has('email')?member:[member];
          }
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
        }
        if(req.method()!=='GET'){blockedWrites.push(url.pathname);return route.abort();}
        if(url.pathname.endsWith('/surveys') || url.pathname.endsWith('/survey_questions'))throw new Error('Standalone prize must not fetch CME forms');
        else if(url.pathname.endsWith('/user'))data=user;
        else data=[];
      } else if(url.pathname===`/api/prize-draw/${id}`) {
        if(req.method()==='GET') {
          if(deleted)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Không tìm thấy chương trình.'})});
          if(failSnapshot)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Mất kết nối thử nghiệm'})});
          data={ok:true,campaign,items,entry};
        } else {
          const body=req.postDataJSON();
          if(body.action==='register') {
            registrations++;
            if(!entry){entry={id:randomUUID(),prize_id:null,claim_code:'',drawn_at:null,redeemed_at:null};records=[{...entry,phone:'0900123456',answers:body.answers,created_at:new Date().toISOString()}];}
            data={ok:true,entry};
          } else if(body.action==='spin') {
            spins++;
            if(!entry.prize_id){entry={...entry,prize_id:items[0].id,prize_name:items[0].name,prize_color:items[0].color,prize_image_url:items[0].image_url,claim_code:'ABCDEF0123456789ABCDEF0123456789',drawn_at:new Date().toISOString()};items[0].remaining--;records[0]={...records[0],...entry};}
            if(dropSpin){dropSpin=false;return route.abort('failed');}
            data={ok:true,entry};
          } else throw new Error('Unexpected public write');
        }
      } else if(url.pathname==='/api/admin/prize-draw/asset') {
        assert.equal(toolAllowed,true);assert.notEqual(role,'viewer');uploads++;data={ok:true,url:'/prize-draw/gifts/gift.svg'};
      } else if(url.pathname==='/api/admin/prize-draw') {
        adminCalls++;assert.equal(toolAllowed,true);
        if(req.method()==='POST') {
          assert.notEqual(role,'viewer');const body=req.postDataJSON();
          if(body.action==='create'){creates++;data={ok:true,id};}
          else if(body.action==='save'){campaign={...campaign,...body.data,revision:campaign.revision+1};items=body.data.items.map(p=>({...p,remaining:p.total-(items.find(s=>s.id===p.id)?.total-items.find(s=>s.id===p.id)?.remaining||0)}));data={ok:true,id};}
          else if(body.action==='redeem'){entry.redeemed_at=new Date().toISOString();records[0].redeemed_at=entry.redeemed_at;data={ok:true,id};}
          else if(body.action==='delete'){deleted=true;deletes++;data={ok:true,id};}
          else throw new Error('Unexpected admin write');
        } else data=url.searchParams.has('id')?{ok:true,campaigns:[campaign],campaign,items,entries:records,questions:campaign.form_fields,role}:{ok:true,campaigns:deleted?[]:[campaign],role};
      } else if(url.pathname==='/api/admin/permissions/users') {
        data={ok:true,users:[]};
      } else if(url.pathname==='/api/admin/events' && req.method()==='GET') {
        data={ok:true,events:[]};
      } else if(url.pathname==='/api/qr') {
        return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/></svg>'});
      } else if(url.pathname.startsWith('/api/')) {
        blockedWrites.push(url.pathname);return route.abort();
      } else if(url.origin===new URL(base).origin)return route.continue();
      else return route.abort();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/prize-draw/${id}/register`);
    await page.getByRole('button',{name:'Đăng ký nhận lượt quay'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(shots,`register-${viewport.width}.png`),fullPage:true});
    await page.locator('input[type="text"]').first().fill('Nguyễn An');
    await page.locator('input[type="tel"]').fill('0900123456');
    await page.getByRole('button',{name:'Đăng ký nhận lượt quay'}).click();
    await page.getByRole('link',{name:'Quay nhận quà',exact:true}).waitFor();
    assert.equal(registrations,1);assert.equal(await page.getByRole('button',{name:'Gửi lượt khác'}).count(),0);
    await page.reload();await page.getByRole('link',{name:'Quay nhận quà',exact:true}).waitFor();
    await page.getByRole('link',{name:'Quay nhận quà',exact:true}).click();
    await page.getByRole('button',{name:'Quay nhận quà',exact:true}).waitFor();
    assert.ok(['rgb(255, 255, 255)','rgb(15, 23, 42)'].includes(await page.getByRole('button',{name:'Quay nhận quà',exact:true}).evaluate(el=>getComputedStyle(el).color)));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(shots,`wheel-${viewport.width}.png`),fullPage:true});
    dropSpin=true; // Response lost AFTER server allocated. GET must recover it.
    await page.getByRole('button',{name:'Quay nhận quà',exact:true}).click();
    await page.getByRole('heading',{name:'Bạn đã trúng Bình nước!'}).waitFor();
    assert.equal(spins,1);assert.equal(items[0].remaining,119);
    await page.reload();await page.getByRole('heading',{name:'Bạn đã trúng Bình nước!'}).waitFor();assert.equal(spins,1);
    await page.screenshot({path:path.join(shots,`result-${viewport.width}.png`),fullPage:true});
    await page.goto(`${base}/admin/tools/prize-draw`);
    await page.getByLabel('Tên chương trình',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Đóng từ thời điểm (giờ Việt Nam)').inputValue(),'2026-11-25T00:00');
    await page.getByLabel('Tên chương trình',{exact:true}).fill('Merap tùy chỉnh');
    await page.getByRole('button',{name:'Kho quà',exact:true}).click();
    await page.getByLabel('Số lượng quà 1').fill('150');
    const png=await require('sharp')({create:{width:10,height:10,channels:3,background:'#0284c7'}}).png().toBuffer();
    await page.getByLabel('Tải ảnh quà 1',{exact:true}).setInputFiles({name:'gift.png',mimeType:'image/png',buffer:png});
    await page.getByText('Đã tải ảnh. Bấm Lưu thay đổi để áp dụng.',{exact:true}).waitFor();assert.equal(uploads,1);
    assert.equal(await page.getByLabel('Chọn chương trình').isDisabled(),true);
    await page.getByRole('button',{name:'Lưu thay đổi'}).click();await page.getByText('Đã lưu cấu hình.',{exact:true}).waitFor();
    assert.equal(items[0].remaining,149);assert.equal(campaign.name,'Merap tùy chỉnh');
    assert.equal(items[0].image_url,'/prize-draw/gifts/gift.svg');
    await page.screenshot({path:path.join(shots,`gifts-${viewport.width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Form đăng ký',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Thêm câu hỏi',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Người tham gia',exact:true}).click();
    await page.getByRole('button',{name:'Xác nhận đã trao',exact:true}).click();await page.getByText('Đã xác nhận trao quà.',{exact:true}).waitFor();assert.ok(entry.redeemed_at);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Xuất CSV danh sách đang tải'}).click();assert.match((await download).suggestedFilename(),/\.csv$/);
    await page.screenshot({path:path.join(shots,`admin-${viewport.width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Tạo chương trình',exact:true}).click();
    await page.getByRole('button',{name:'Tạo demo mẫu',exact:true}).click();await page.getByText(/Đã tạo chương trình nháp/).waitFor();assert.equal(creates,1);
    role='viewer';await page.reload();await page.getByLabel('Chọn chương trình').selectOption(id);await page.getByLabel('Tên chương trình',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Tên chương trình',{exact:true}).isDisabled(),true);
    // Denied for every role without the explicit grant, with no tool API fetch.
    toolAllowed=false;const callsBefore=adminCalls;
    for(const deniedRole of ['owner','admin','viewer']) {
      role=deniedRole;await page.reload();
      await page.getByRole('heading',{name:'Chưa được cấp quyền Vòng quay nhận quà'}).waitFor();
      assert.equal(await page.locator('a[href="/admin/tools/prize-draw"]').count(),0);
      await page.keyboard.press('Control+k');await page.getByPlaceholder('Tìm trang, form, sự kiện…').fill('Vòng quay nhận quà');
      await page.getByText('Không tìm thấy.',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
    }
    assert.equal(adminCalls,callsBefore);
    role='owner';await page.goto(`${base}/admin/permissions`);
    const permission=page.getByRole('checkbox',{name:`Vòng quay nhận quà: ${user.email}`});
    await permission.waitFor();assert.equal(await permission.isChecked(),false);
    await permission.click();await page.locator('a[href="/admin/tools/prize-draw"]').first().waitFor({state:'attached'});
    assert.equal(toolAllowed,true);assert.equal(permissionWrites,1);
    await permission.click();
    await page.waitForFunction(()=>!document.querySelector('a[href="/admin/tools/prize-draw"]'));
    assert.equal(toolAllowed,false);assert.equal(permissionWrites,2);
    role='admin';await page.reload();await permission.waitFor();assert.equal(await permission.isDisabled(),true);
    // Sold-out, time window and missing registration states.
    entry=null;items=items.map(p=>({...p,remaining:0}));
    await page.goto(`${base}/prize-draw/${id}`);await page.getByText('Quà đã hết. Cảm ơn bạn đã tham gia!',{exact:true}).waitFor();
    campaign={...campaign,is_demo:false,starts_at:'2099-11-12T00:00:00Z',ends_at:'2099-11-25T00:00:00Z'};
    await page.reload();await page.getByText('Chương trình chưa đến giờ bắt đầu.',{exact:true}).waitFor();
    failSnapshot=true;await page.reload();await page.getByRole('button',{name:'Tải lại',exact:true}).waitFor();failSnapshot=false;await page.getByRole('button',{name:'Tải lại',exact:true}).click();await page.getByRole('link',{name:'Điền form để nhận lượt quay',exact:true}).waitFor();
    // Empty campaign form is independently editable; deletion requires the dialog.
    role='owner';toolAllowed=true;records=[];
    await page.goto(`${base}/admin/tools/prize-draw`);await page.getByLabel('Tên chương trình',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Form đăng ký',exact:true}).click();
    await page.getByRole('button',{name:'Thêm câu hỏi',exact:true}).click();
    await page.getByLabel('Nội dung câu 4',{exact:true}).fill('Bạn quan tâm sản phẩm nào?');
    await page.getByLabel('Loại câu 4',{exact:true}).selectOption('choice');
    await page.getByRole('button',{name:'Đưa câu 4 lên',exact:true}).click();
    assert.equal(await page.getByLabel('Nội dung câu 3',{exact:true}).inputValue(),'Bạn quan tâm sản phẩm nào?');
    await page.getByRole('button',{name:'Lưu thay đổi'}).click();await page.getByText('Đã lưu cấu hình.',{exact:true}).waitFor();
    await page.reload();await page.getByRole('button',{name:'Form đăng ký',exact:true}).click();
    assert.equal(await page.getByLabel('Nội dung câu 3',{exact:true}).inputValue(),'Bạn quan tâm sản phẩm nào?');
    await page.getByRole('button',{name:'Cài đặt',exact:true}).click();
    await page.getByRole('button',{name:'Xóa chương trình',exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'Huỷ',exact:true}).click();assert.equal(deletes,0);
    await page.getByRole('button',{name:'Xóa chương trình',exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'Xóa chương trình',exact:true}).click();
    await page.getByText('Đã xóa chương trình khỏi danh sách và đóng trang tham gia.',{exact:true}).waitFor();assert.equal(deletes,1);
    await page.goto(`${base}/prize-draw/${id}/register`);await page.getByText('Không tìm thấy chương trình.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual(blockedWrites,[]);
    console.log(`PASS ${viewport.width}px: registration, reload, lost response recovery, stock config, redemption, CSV, viewer, permission grant/revoke, denied menu/page/search, sold-out, schedule, error retry.`);
  } finally {await context.close();}
}
(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {for(const viewport of [{width:375,height:812},{width:844,height:390},{width:1440,height:1000}])await run(viewport);console.log('Screenshots:',shots);}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
