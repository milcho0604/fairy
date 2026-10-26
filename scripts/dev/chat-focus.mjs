// #144 채팅 위치 초기화, #146 집중 시간 직접 입력.
// npm run build && OUT=/tmp/fairy-settings LANG_UNDER_TEST=ko node scripts/dev/chat-focus.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  let chat=await page('chat');
  await until(()=>chat.ev('!!document.querySelector(".near-pet")'),'chat');
  await main('__jj.chat.window.setSize(520,600); __jj.chat.window.setPosition(120,80); __jj.chat.window.emit("moved"); 1');
  await sleep(250);
  const before=await main('__jj.chat.window.getBounds()');
  const saved=()=>JSON.parse(readFileSync(join(data,'window-bounds.json'),'utf8')).chat;
  await check('옮긴 채팅 위치를 기억',async()=>assert.equal(typeof saved().x,'number'));
  await chat.ev('document.querySelector(".near-pet").click()');await sleep(400);
  const after=await main('__jj.chat.window.getBounds()');
  await check('펫 옆으로: 크기 유지·위치 이동·저장 위치 해제',async()=>{assert.equal(after.width,before.width);assert.equal(after.height,before.height);assert.ok(after.x!==before.x||after.y!==before.y);assert.equal(saved().x,undefined);assert.equal(saved().y,undefined);});
  await chat.shot(`${tag}-chat-near`);
  await main('__jj.chat.window.close(); 1');await sleep(200);
  await check('닫을 때도 위치를 다시 저장하지 않음',async()=>assert.equal(saved().x,undefined));
  await main('__jj.chat.open(__jj.pet.bounds()); 1');chat=await page('chat');
  await until(()=>chat.ev('!!document.querySelector(".near-pet")'),'reopened');
  await check('다시 열면 펫 옆 위치·크기 유지',async()=>assert.deepEqual(await main('__jj.chat.window.getBounds()'),after));
  await main('__jj.chat.window.setPosition(90,65); __jj.chat.window.emit("moved"); 1');await sleep(200);
  await check('다시 직접 옮기면 위치 기억 재개',async()=>assert.equal(saved().x,90));
  await chat.ev('document.querySelector(".near-pet").click()');await sleep(200);
  await main('__jj.chat.window.setMinimumSize(320,300); __jj.chat.window.setSize(360,600); 1');await sleep(200);
  await check('360px 채팅 머리줄 가로 넘침 없음',async()=>assert.ok(await chat.ev('document.querySelector("header").scrollWidth<=document.querySelector("header").clientWidth+1')));
  await chat.shot(`${tag}-chat-360`);
  await main('__jj.chat.window.close(); __jj.panel.openTab("today"); 1');
  let panel=await page('panel');await until(()=>panel.ev('!!document.querySelector(".focus-card.idle")'),'focus');
  const custom=async()=>{await panel.ev(`(()=>{const b=[...document.querySelectorAll('.focus-len button')].find(b=>b.textContent===${JSON.stringify(lang==='ko'?'직접':'Custom')}); b.click();})()`);await until(()=>panel.ev('!!document.querySelector(".focus-custom input")'),'custom input');};
  const fill=async value=>{await panel.ev(`(()=>{const e=document.querySelector('.focus-custom input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(80);};
  await custom();
  for(const value of ['', '4','121','5.5']) {
    await fill(value);
    await check(`직접 ${value||'빈 값'}: 시작 금지`,async()=>assert.ok(await panel.ev('document.querySelector(".focus-card .primary").disabled')));
  }
  for(const minutes of [5,17,120]) {
    await fill(String(minutes));
    await panel.ev('document.querySelector(".focus-card .primary").click()');
    await until(()=>main('__jj.planner.focus.phase==="focus"'),'started');
    await check(`${minutes}분 타이머·다음 선택 저장`,async()=>{const state=await main('__jj.planner.focus');assert.equal(state.endsAt-state.startedAt,minutes*60000);assert.equal(await main('__jj.settings.get().focusMin'),minutes);});
    await main('__jj.planner.stopFocus(); 1');await until(()=>panel.ev('!!document.querySelector(".focus-card.idle")'),'stopped');
    await until(()=>panel.ev('!!document.querySelector(".focus-custom input")'),'custom remembered');
  }
  await main('__jj.panel.closePanel(); 1');await sleep(200);await main('__jj.panel.openTab("today"); 1');panel=await page('panel');
  await until(()=>panel.ev('document.querySelector(".focus-custom input")?.value==="120"'),'reopen custom');
  await check('패널을 다시 열어도 직접 입력 120분 기억',async()=>assert.equal(await panel.ev('document.querySelector(".focus-custom input").value'),'120'));
  for(const width of [320,360,560]) {
    await main(`__jj.panel.window.setMinimumSize(320,420); __jj.panel.window.setSize(${width},720); 1`);await sleep(150);
    await check(`${width}px 집중 입력 가로 넘침 없음`,async()=>assert.ok(await panel.ev('document.querySelector(".focus-card").scrollWidth<=document.querySelector(".focus-card").clientWidth+1')));
    await panel.shot(`${tag}-focus-${width}`);
  }
  await panel.ev('document.querySelector(".focus-len button").click()');await sleep(100);
  await check('기본 15분 선택으로 전환',async()=>assert.ok(await panel.ev('!document.querySelector(".focus-custom input") && document.querySelector(".focus-len button").getAttribute("aria-pressed")==="true"')));
  await main('__jj.panel.closePanel(); __jj.home.open(); 1');const homePage=await page('home');await until(()=>homePage.ev('!!document.querySelector("main")'),'home');await main('__jj.home.openChat(); 1');chat=await page('chat');
  await until(()=>chat.ev('location.hash==="#embed" && !!document.querySelector("header")'),'embedded');
  await check('큰 창 안의 채팅에는 위치 이동 단추 없음',async()=>assert.ok(await chat.ev('!document.querySelector(".near-pet")')));
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
