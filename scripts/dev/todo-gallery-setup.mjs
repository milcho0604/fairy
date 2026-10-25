// #146/#149: 새 할 일 위치, 내장 갤러리 중복, 첫 안내 기본 설정. 빈 데이터/숨은 내장 화면/CDP 전용.
// npm run build && OUT=/tmp/fairy-146149 LANG_UNDER_TEST=ko node scripts/dev/todo-gallery-setup.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';
const lang=process.env.LANG_UNDER_TEST==='en'?'en':'ko';
process.env.OUT ??= '/tmp/fairy-146149';
const root=resolve(import.meta.dirname,'../..');
const scratch=mkdtempSync(join(tmpdir(),'fairy-146149-')),data=join(scratch,'data'),home=join(scratch,'home');
for(const d of [data,home,process.env.OUT])mkdirSync(d,{recursive:true});
writeFileSync(join(data,'settings.json'),JSON.stringify({onboarded:true,lang,pet3d:false,wander:false,osNotify:false,chatter:'quiet',saverTold:true,panelPin:true}));
writeFileSync(join(data,'day-plan.json'),JSON.stringify({prefs:{auto:false,fromMinute:480}}));
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return String(p);}
process.env.JJ_INSPECT_PORT=await port();process.env.JJ_PAGE_PORT=await port();
const index=JSON.parse(readFileSync(join(root,'gallery/index.json'),'utf8'));
const milk=index.pets.find(p=>p.id==='milk');
index.pets.push({...milk,id:'guest',name:'Sprout',file:'pets/guest.jjpet',thumbnail:'thumbs/guest.png'});
const requests=[];
const gallery=httpServer((req,res)=>{requests.push(req.url);if(req.url==='/index.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(index));return;}
 const key=req.url==='/thumbs/guest.png'?'/thumbs/milk.png':req.url;
 if(['/thumbs/milk.png','/thumbs/choco.png'].includes(key)){res.setHeader('content-type','image/png');res.end(readFileSync(join(root,'gallery',key)));return;}
 res.writeHead(404);res.end('test download unavailable');});
await new Promise(r=>gallery.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${gallery.address().port}/`;
let logs='';
const app=spawn(electron,[`--inspect=${process.env.JJ_INSPECT_PORT}`,'.',`--remote-debugging-port=${process.env.JJ_PAGE_PORT}`],{
 cwd:root,env:{...process.env,HOME:home,PATH:`/usr/bin:/bin:${dirname(process.execPath)}`,SHELL:'/usr/bin/false',JJ_USER_DATA:data,JJ_NO_FOCUS:'1',JJ_SHOW:'',JJ_TEST_SECRETS:'memory',JJ_GALLERY_URL:base},stdio:['ignore','pipe','pipe']});
app.stdout.on('data',b=>{logs+=b;});app.stderr.on('data',b=>{logs+=b;});
const {main,page,sleep,disconnect}=await import('./cdp.mjs');
const results=[];
async function until(fn,label){for(let i=0;i<120;i++){try{if(await fn())return;}catch{}await sleep(50);}throw new Error(`timeout: ${label}`);}
async function check(label,fn){await fn();results.push(label);console.log('PASS',label);}
let code=0;
try{
 await until(async()=>(await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok,'inspector');
 await until(()=>main('typeof __jj!=="undefined"'),'__jj');
 await main('for(let i=0;i<235;i++)__jj.store.add({title:`Seed ${i} #work`},Date.now()-100000+i); __jj.panel.openTab("todo"); 1');
 let p=await page('panel');await until(()=>p.ev('document.querySelectorAll("li.todo").length===100'),'first page');
 const submitted=[];
 async function add(title,tag){
  await p.ev(`(()=>{const e=document.querySelector('.todo-main .add input');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(title)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  let id;await until(async()=>{id=await main(`__jj.store.list(Date.now()).open.find(x=>x.title===${JSON.stringify(title)})?.id`);return !!id;},'todo added');
  submitted.push(id);
  if(tag==='hidden')return id;
  await until(()=>p.ev(`document.querySelector('li.todo[data-id="${id}"]')?.classList.contains('just-added')`),'highlight');
  const b=await p.ev(`(()=>{const e=document.querySelector('li.todo[data-id="${id}"]'),r=e.getBoundingClientRect(),u=e.parentElement.getBoundingClientRect();return {top:r.top,bottom:r.bottom,clipTop:Math.max(0,u.top),clipBottom:Math.min(innerHeight,u.bottom),focus:document.activeElement===document.querySelector('.todo-main .add input')};})()`);
  await check(`${tag}: 새 줄을 그려 화면 안으로 이동`,async()=>{assert.ok(b.top>=b.clipTop-1&&b.bottom<=b.clipBottom+1,JSON.stringify(b));assert.equal(b.focus,true);});
  await p.shot(`${lang}-${tag}-new-todo`);
  await sleep(1100);await check(`${tag}: 강조는 잠깐 뒤 사라짐`,async()=>assert.equal(await p.ev(`document.querySelector('li.todo[data-id="${id}"]')?.classList.contains('just-added')`),false));
  return id;
 }
 await add(lang==='ko'?'새 보고서 확인':'Review new report','panel');
 await check('100개씩 나누는 목록에서도 새 줄까지 자동 펼침',async()=>assert.ok(await p.ev('document.querySelectorAll("li.todo").length>235')));
 await p.ev('document.querySelector(".find-btn").click()');
 await p.ev(`(()=>{const e=document.querySelector('.find-row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Seed 001');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 // 태그와 검색을 함께 유지한 상태에서 일치하지 않는 새 할 일을 넣는다.
 await p.ev(`[...document.querySelectorAll('.tag-chips button')].find(e=>e.textContent.startsWith('#work')).click()`);
 const hidden=await add(lang==='ko'?'필터 밖 새 할 일':'A new hidden item','hidden');
 await until(()=>p.ev('!!document.querySelector(".todo-added-notice .link")'),'hidden feedback');
 await check('검색/태그에 가려진 추가는 조건을 유지하고 보기 안내',async()=>{assert.equal(await p.ev('document.querySelector(".find-row input").value'),'Seed 001');assert.equal(await p.ev(`!!document.querySelector('li.todo[data-id="${hidden}"]')`),false);assert.ok(await p.ev(`[...document.querySelectorAll('.tag-chips button')].some(e=>e.textContent.startsWith('#work')&&e.getAttribute('aria-pressed')==='true')`));});
 await p.shot(`${lang}-hidden-feedback`);
 await p.ev('document.querySelector(".todo-added-notice .link").click()');
 await until(()=>p.ev(`document.querySelector('li.todo[data-id="${hidden}"]')?.classList.contains('just-added')`),'reveal hidden');
 await check('보기를 누르면 새 줄을 펼치고 강조',async()=>assert.equal(await p.ev('!!document.querySelector(".find-row input")'),false));
 await main('__jj.panel.closePanel(); __jj.home.open("todo"); 1');
 p=await page('home');await until(()=>p.ev('!!document.querySelector(".todo-main .add input")'),'home todo');
 await main('__jj.home.window.setSize(1100,760); 1');await sleep(200);
 await add(lang==='ko'?'큰 창 새 할 일':'New to-do in home','home');
 await p.dark(true);await add(lang==='ko'?'어두운 화면 새 할 일':'New dark to-do','home-dark');await p.dark(false);
 await add(lang==='ko'?'아주 긴 할 일 제목 '.repeat(16)+'확인':'A long to-do title '.repeat(10)+'check','long-title');
 await check('긴 제목의 추가 안내는 두 줄 안에 표시',async()=>{const s=await p.ev('(()=>{const e=document.querySelector(".todo-added-notice > span"),g=getComputedStyle(e);return {height:e.clientHeight,line:parseFloat(g.lineHeight)};})()');assert.ok(s.height<=s.line*2+1,JSON.stringify(s));});
 const pasted=lang==='ko'?['여러 줄 첫째','여러 줄 마지막']:['First pasted task','Last pasted task'];
 await p.ev(`(()=>{const e=document.querySelector('.todo-main .add input');e.focus();const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(pasted.join('\n'))});e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));})()`);
 let pastedId;await until(async()=>{pastedId=await main(`__jj.store.list(Date.now()).open.find(x=>x.title===${JSON.stringify(pasted[1])})?.id`);return pastedId;},'pasted tasks');
 await until(()=>p.ev(`document.querySelector('li.todo[data-id="${pastedId}"]')?.classList.contains('just-added')`),'last pasted highlight');
 await check('여러 줄 붙여넣기는 마지막으로 추가한 할 일을 강조',async()=>assert.equal(await main(`__jj.store.list(Date.now()).open.filter(x=>${JSON.stringify(pasted)}.includes(x.title)).length`),2));
 await p.ev('document.querySelector(".find-btn").click()');
 await p.ev(`(()=>{const e=document.querySelector('.find-row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Tiny');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await add('Tiny matching task','matching-filter');
 await check('검색에 맞는 새 할 일은 검색을 유지한 채 바로 표시',async()=>{assert.equal(await p.ev('document.querySelector(".find-row input").value'),'Tiny');assert.equal(await p.ev('document.querySelectorAll("li.todo").length'),1);});
 await main('globalThis.closing146=__jj.home.window; __jj.home.close(); 1');
 await until(()=>main('closing146.isDestroyed()'),'home closed');await sleep(100);
 await check('큰 창 닫기 뒤 파괴된 화면 참조 오류 없음',async()=>assert.equal(logs.includes('[error] uncaught'),false,logs));
 await main('__jj.settingsWindow.open(); 1');
 const settings=await page('settings');await until(()=>settings.ev('!!document.querySelector("#tab-pet")'),'settings');
 await settings.ev('document.querySelector("#tab-pet").click()');
 const galleryOpen=lang==='ko'?'페어리 갤러리 열기':'Open the fairy gallery';
 await settings.ev(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(galleryOpen)}).click()`);
 await until(()=>settings.ev('document.querySelectorAll(".gallery-card").length===3'),'gallery fixture');
 await check('내장 둘은 이미 있어요 표시와 다운로드 비활성',async()=>{
  const cards=await settings.ev(`[...document.querySelectorAll('.gallery-card')].map(e=>({text:e.textContent,buttons:[...e.querySelectorAll('button')].map(b=>b.disabled)}))`);
  assert.ok(cards[0].text.includes(lang==='ko'?'이미 있어요':'Already included'));assert.ok(cards[1].text.includes(lang==='ko'?'이미 있어요':'Already included'));
  assert.deepEqual(cards[0].buttons,[true]);assert.deepEqual(cards[1].buttons,[true]);assert.deepEqual(cards[2].buttons,[false,false]);
 });
 const before=await main('JSON.stringify({image:__jj.settings.get().petImage,library:__jj.settings.get().petLibrary,friends:__jj.settings.get().friends})');
 for(const id of ['milk','choco'])for(const friend of [false,true]){
  const r=await settings.ev(`window.jjakkungSettings.galleryAdopt(${JSON.stringify(id)},${friend})`);
  await check(`${id}/${friend}: 직접 요청도 중복 가져오기 거절`,async()=>assert.equal(r.ok,false));
 }
 await check('내장 재요청은 파일 다운로드와 저장 데이터 변경 없음',async()=>{assert.equal(requests.filter(p=>p.startsWith('/pets/')).length,0);assert.equal(await main('JSON.stringify({image:__jj.settings.get().petImage,library:__jj.settings.get().petLibrary,friends:__jj.settings.get().friends})'),before);});
 await settings.ev('document.querySelectorAll(".gallery-card")[2].querySelector("button").click()');
 await until(()=>Promise.resolve(requests.includes('/pets/guest.jjpet')),'nonbuilt-in download');
 await check('다른 갤러리 펫은 기존 받기 경로 유지',async()=>assert.equal(requests.filter(p=>p==='/pets/guest.jjpet').length,1));
 await sleep(2600);
 await main('__jj.settingsWindow.window.setMinimumSize(320,420); __jj.settingsWindow.window.setSize(320,620); 1');await sleep(200);
 await settings.ev('document.querySelector(".gallery-grid").scrollIntoView({block:"start"})');await settings.shot(`${lang}-gallery-320`);await settings.dark(true);await settings.shot(`${lang}-gallery-dark`);await settings.dark(false);
 await main('__jj.settingsWindow.window.close(); __jj.settings.set({onboarded:false,onboardPage:4}); __jj.onboarding.open(); 1');
 const onboard=await page('onboarding');await until(()=>onboard.ev('!!document.querySelector(".onboard-preferences")'),'setup page');
 await check('기존 네 쪽을 유지하고 다섯 번째 설정 쪽 추가',async()=>{assert.equal(await onboard.ev('document.querySelectorAll(".dots li").length'),5);assert.equal(await onboard.ev('[...document.querySelectorAll(".dots li")].findIndex(e=>e.classList.contains("on"))'),4);});
 await check('개발/격리 실행에서는 자동 실행을 비활성',async()=>{assert.equal(await onboard.ev('document.querySelector(".onboard-preferences input").disabled'),true);const r=await onboard.ev('window.jjakkungOnboard.set({launchAtLogin:true})');assert.equal(r.launchAtLogin,false);});
 await onboard.shot(`${lang}-setup-default`);
 await onboard.ev('document.querySelectorAll(".onboard-preferences input")[1].click();document.querySelectorAll(".onboard-preferences input")[2].click()');
 await until(()=>main('!__jj.settings.get().sysMonitor&&!__jj.settings.get().typeAlong'),'preference save');
 await check('컴퓨터 상태/같이 타자 선택은 실제 설정에 저장',async()=>{const s=JSON.parse(readFileSync(join(data,'settings.json'),'utf8'));assert.equal(s.sysMonitor,false);assert.equal(s.typeAlong,false);assert.equal(s.onboarded,false);});
 await main('__jj.onboarding.window.close(); 1');await until(()=>main('!__jj.onboarding.window'),'close setup');await main('__jj.onboarding.open(); 1');
 const again=await page('onboarding');await until(()=>again.ev('!!document.querySelector(".onboard-preferences")'),'resume setup');
 await check('설정 쪽에서 닫아도 그 쪽과 선택 상태 복원',async()=>assert.deepEqual(await again.ev('[...document.querySelectorAll(".onboard-preferences input")].map(e=>e.checked)'),[false,false,false]));
 await main('__jj.onboarding.window.setSize(360,500); 1');await sleep(200);
 await check('작은 설정 안내에서도 시작 단추 접근',async()=>assert.ok(await again.ev('document.querySelector("footer").getBoundingClientRect().bottom<=innerHeight+1')));
 await again.shot(`${lang}-setup-small`);
 await again.ev('document.querySelector("footer .primary").click()');await until(()=>main('!__jj.onboarding.window'),'complete setup');
 await check('새 설정 쪽의 시작 단추로만 완료',async()=>assert.equal(await main('__jj.settings.get().onboarded'),true));
 writeFileSync(join(process.env.OUT,`${lang}-results.json`),JSON.stringify(results,null,2));
}catch(e){console.error(e);code=1;}finally{
 disconnect();const gone=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await Promise.race([gone,sleep(4000)]);if(app.exitCode===null)app.kill('SIGKILL');
 gallery.closeAllConnections();await new Promise(r=>gallery.close(r));writeFileSync(join(process.env.OUT,`${lang}-app.log`),logs);writeFileSync(join(process.env.OUT,`${lang}-requests.json`),JSON.stringify(requests,null,2));rmSync(scratch,{recursive:true,force:true});process.exit(code);
}
