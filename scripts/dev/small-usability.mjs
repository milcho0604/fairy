// #145 빠른 입력 초안, #146 반복 완료 안내, #144 넓은 설정 가운데 정렬.
// npm run build && OUT=/tmp/fairy-settings LANG_UNDER_TEST=ko node scripts/dev/small-usability.mjs
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
  await main('__jj.panel.openQuick(); 1');
  let q = await page('quick');
  await until(() => q.ev('!!document.querySelector("input")'), 'quick');
  await q.ev('document.querySelector("input").focus()');
  await q.send('Input.insertText', {text:'QUICK_DRAFT_CHECK'});
  // 디바운스가 끝나기 전에 닫아도 초안을 보존한다.
  await main('__jj.panel.quickWindow.close(); 1');
  await sleep(300);
  await main('__jj.panel.openQuick(); 1');
  q = await page('quick');
  await until(() => q.ev('document.querySelector("input")?.value === "QUICK_DRAFT_CHECK"'), 'restored draft');
  await check('빠른 입력을 바로 닫았다 열면 초안 복원', async () => assert.equal(await q.ev('document.querySelector("input").value'),'QUICK_DRAFT_CHECK'));
  await q.ev('document.querySelector("input").focus()');
  await q.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await q.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(() => q.ev('document.querySelector("input")?.value === ""'), 'submitted');
  await main('__jj.panel.quickWindow.close(); 1');
  await sleep(300);
  await main('__jj.panel.openQuick(); 1');
  q = await page('quick');
  await until(() => q.ev('!!document.querySelector("input")'), 'reopen');
  await check('등록한 초안은 다시 열어도 비어 있음', async () => assert.equal(await q.ev('document.querySelector("input").value'),''));
  await main('__jj.panel.quickWindow.close(); 1');

  await main(`(() => { for (const repeat of ['daily','weekdays','weekly','monthly']) __jj.store.add({title:'REPEAT_'+repeat,repeat},Date.now()); __jj.store.add({title:'PLAIN_CHECK'},Date.now()); __jj.panel.openTab('todo'); return 1; })()`);
  const panel=await page('panel');
  await until(() => panel.ev('!!document.querySelector("li.todo")'), 'todos');
  for (const name of ['daily','weekdays','weekly','monthly']) {
    await panel.ev(`(() => {const row=[...document.querySelectorAll('li.todo')].find(e=>e.textContent.includes('REPEAT_${name}')); row.querySelector('.check').click();})()`);
    await until(() => panel.ev(`document.querySelector('.toast-stack')?.textContent.includes(${JSON.stringify(lang==='ko'?'다음은':'Next:')})`), 'repeat toast');
    const next=await main(`__jj.store.list(Date.now()).open.find(t=>t.title==='REPEAT_${name}').due`);
    await check(`${name}: 실제 다음 회차 생성 및 완료 안내`, async () => {assert.match(next,/^\d{4}-\d{2}-\d{2}$/); assert.equal(await panel.ev("window.jjakkungPanel.toastsGet().find(k=>k.toast.kind==='done')?.toast.nextDue"),next); assert.ok(await panel.ev(`document.querySelector('.toast-stack').textContent.includes(${JSON.stringify(lang==='ko'?'다음은':'Next:')})`));});
    await panel.shot(`${tag}-repeat-${name}`);
    await panel.ev('document.querySelectorAll(".toast .undo").forEach(b=>b.click())');
    await sleep(200);
  }
  await panel.ev(`(()=>{const row=[...document.querySelectorAll('li.todo')].find(e=>e.textContent.includes('PLAIN_CHECK')); row.querySelector('.check').click();})()`);
  await sleep(200);
  await check('반복 없는 할 일에는 다음 날짜 안내 없음', async () => assert.ok(!(await panel.ev(`document.querySelector('.toast-stack').textContent.includes(${JSON.stringify(lang==='ko'?'다음은':'Next:')})`))));

  await main('__jj.settingsWindow.open(); 1');
  const settings=await page('settings');
  await until(() => settings.ev('!!document.querySelector(".tab-panel")'), 'settings');
  for(const width of [360,760,1280]) {
    await main(`__jj.settingsWindow.window.setSize(${width},720); 1`); await sleep(200);
    for(const tab of ['pet','ai','data','about']) {
      await settings.ev(`document.querySelector('#tab-${tab}').click()`); await sleep(100);
      const box=await settings.ev(`(()=>{const m=document.querySelector('main'),p=document.querySelector('#panel-${tab}'),a=m.getBoundingClientRect(),b=p.getBoundingClientRect();return {left:b.left-a.left,right:a.right-b.right,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      await check(`${width}px ${tab}: 본문 정렬 및 가로 넘침 없음`, async () => {assert.equal(box.overflow,false);assert.ok(Math.abs(box.left-box.right)<=18,JSON.stringify(box));});
    }
    await settings.shot(`${tag}-settings-${width}`);
  }
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
