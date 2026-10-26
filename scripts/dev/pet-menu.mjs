// #148 우클릭 메뉴 구조와 작업 연결. 실제 메뉴를 화면에 띄우지 않는다.
// npm run build && OUT=/tmp/fairy-settings LANG_UNDER_TEST=ko node scripts/dev/pet-menu.mjs
// BASELINE=1은 빌드된 이전 판에서 첫 안내 크기와 화면만 기록한다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';

const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const scratch = mkdtempSync(join(tmpdir(), 'fairy-settings-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
process.env.OUT ??= '/tmp/fairy-settings';
for (const d of [data, home, process.env.OUT]) mkdirSync(d, {recursive:true});
writeFileSync(join(data, 'settings.json'), JSON.stringify({onboarded:true, lang, osNotify:false, wander:false, pet3d:false, saverTold:true, chatter:'quiet', shortcuts:{quickAdd:'CommandOrControl+Alt+N'}}));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({prefs:{auto:false, fromMinute:480}}));
async function port() {
  const s = createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return String(p);
}
process.env.JJ_INSPECT_PORT = await port();
process.env.JJ_PAGE_PORT = await port();
const app = spawn(electron, [`--inspect=${process.env.JJ_INSPECT_PORT}`, '.', `--remote-debugging-port=${process.env.JJ_PAGE_PORT}`], {
  cwd:resolve(import.meta.dirname,'../..'),
  env:{...process.env, HOME:home, PATH:`/usr/bin:/bin:${dirname(process.execPath)}`, SHELL:'/usr/bin/false', JJ_NO_FOCUS:'1', JJ_SHOW:'', JJ_USER_DATA:data, JJ_TEST_SECRETS:'memory'},
  stdio:['ignore','pipe','pipe'],
});
let logs = '';
app.stdout.on('data', b => {logs += b;});
app.stderr.on('data', b => {logs += b;});
const {main,page,sleep,disconnect} = await import('./cdp.mjs');
async function until(fn, label) {
  for (let i=0;i<100;i++) {try {if (await fn()) return;} catch {} await sleep(100);}
  throw new Error(`timeout: ${label}`);
}
const checks = [];
async function check(label, fn) {await fn(); checks.push(label); console.log('PASS',label);}
const tag = lang;
let code=0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  const L=(ko,en)=>lang==='ko'?ko:en;
  await main(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const build=E.Menu.buildFromTemplate.bind(E.Menu);
    E.Menu.buildFromTemplate=tpl=>{const m=build(tpl);globalThis.__menu=tpl;m.popup=()=>{};return m;};
    return 1;
  })()`);
  const pet=await page('pet');
  const refresh=async()=>{await pet.ev('window.jjakkung.contextMenu()');await sleep(150);};
  const click=async(label,more=false)=>main(`__menu${more?'.find(i=>i.submenu && i.label==='+JSON.stringify(L('더 보기','More'))+').submenu':''}.find(i=>i.label===${JSON.stringify(label)}).click(); 1`);
  await refresh();
  const items=await main('__menu.filter(i=>i.label && i.enabled!==false).map(i=>i.label)');
  await check('할 일·집중·밥·메모·패널을 맨 위에',async()=>assert.deepEqual(items.slice(0,5),[L('할 일 추가','Add to-do'),L('집중 25분 시작','Start 25 min focus'),L('밥 주기','Feed'),L('메모 추가','Add note'),L('패널 열기','Open panel')]));
  await check('최상위 실행 항목은 13개 이하',async()=>assert.ok(items.length<=13,items.join(' | ')));
  const more=await main(`__menu.find(i=>i.label===${JSON.stringify(L('더 보기','More'))}).submenu.map(i=>i.label).filter(Boolean)`);
  for(const label of [L('말풍선','Speech bubbles'),L('배터리일 때 움직임 줄이기','Reduce motion on battery'),L('같이 타자 치기','Type along'),L('새로고침','Refresh')]) {
    await check(`${label}: 더 보기 안에 있고 최상위에는 없음`,async()=>{assert.ok(more.includes(label));assert.ok(!items.includes(label));});
  }
  await check('끝내기 앞 구분선, 다시 켜기는 더 보기 안에',async()=>{assert.equal(await main('__menu.at(-1).role'),'quit');assert.equal(await main('__menu.at(-2).type'),'separator');assert.ok(more.some(x=>x.includes(L('다시 켜기','Restart'))));});
  writeFileSync(join(process.env.OUT,`${tag}-menu.json`),JSON.stringify({items,more},null,2));
  await click(L('할 일 추가','Add to-do'));
  const quick=await page('quick');await until(()=>quick.ev('!!document.querySelector("input")'),'quick');
  await check('할 일 추가는 빠른 입력 열기',async()=>assert.ok(await quick.ev('!!document.querySelector("input")')));
  await main('__jj.panel.quickWindow.close(); 1');
  await click(L('메모 추가','Add note'));
  let panel=await page('panel');await until(()=>panel.ev('!!document.querySelector(".note-editor textarea")'),'new note');
  await check('처음 패널을 열어도 새 메모는 한 개만 생성',async()=>assert.equal(await main('__jj.notes.list().length'),1));
  await panel.ev('document.querySelector(".note-editor textarea").focus()');
  await panel.send('Input.insertText',{text:'KEEP_OLD_NOTE'});await sleep(1100);
  await click(L('메모 추가','Add note'));
  await until(()=>panel.ev('document.querySelector(".note-editor textarea")?.value===""'),'second note');
  await check('기존 편집기에서 메모 추가: 새 메모 한 개, 쓰던 메모 보존',async()=>{assert.equal(await main('__jj.notes.list().length'),2);assert.ok(await main('__jj.notes.list().some(n=>n.body.includes("KEEP_OLD_NOTE"))'));});
  await panel.shot(`${tag}-new-note`);
  await click(L('패널 열기','Open panel'));await sleep(200);
  await check('열린 패널은 닫지 않고 보던 메모 유지',async()=>assert.ok(await panel.ev('!!document.querySelector(".note-editor textarea")')));
  await main(`__jj.panel.closePanel(); __jj.home.open(); 1`);const readyHome=await page('home');await until(()=>readyHome.ev('!!document.querySelector("#ptab-note")'),'home ready');
  const beforeHome=await main('__jj.notes.list().length');
  await click(L('메모 추가','Add note'));
  const homePage=await page('home');await until(()=>homePage.ev('!!document.querySelector(".note-editor textarea")'),'home note');
  await check('큰 창에서도 새 메모는 한 번만 생성',async()=>assert.equal(await main('__jj.notes.list().length'),beforeHome+1));
  await homePage.shot(`${tag}-home-note`);
  // 하위 메뉴의 체크 상태와 동작도 그대로다.
  await refresh();
  const saver=L('배터리일 때 움직임 줄이기','Reduce motion on battery'),type=L('같이 타자 치기','Type along');
  await main(`__menu.find(i=>i.label===${JSON.stringify(L('더 보기','More'))}).submenu.find(i=>i.label===${JSON.stringify(saver)}).click({checked:false}); 1`);
  await check('움직임 줄이기 체크 동작 유지',async()=>assert.equal(await main('__jj.settings.get().batterySaver'),'off'));
  await main(`__menu.find(i=>i.label===${JSON.stringify(L('더 보기','More'))}).submenu.find(i=>i.label===${JSON.stringify(type)}).click({checked:false}); 1`);
  await refresh();
  await check('같이 타자 체크 상태 갱신',async()=>assert.equal(await main(`__menu.find(i=>i.label===${JSON.stringify(L('더 보기','More'))}).submenu.find(i=>i.label===${JSON.stringify(type)}).checked`),false));
  writeFileSync(join(process.env.OUT,`${tag}-checks.json`),JSON.stringify(checks,null,2));
} catch(e) {console.error(e);code=1;} finally {
  disconnect();
  const gone=new Promise(r=>app.once('exit',r));
  app.kill('SIGTERM');
  await Promise.race([gone,sleep(4000)]);
  if(app.exitCode===null)app.kill('SIGKILL');
  writeFileSync(join(process.env.OUT,`${tag}-app.log`),logs);
  rmSync(scratch,{recursive:true,force:true});
  process.exit(code);
}
