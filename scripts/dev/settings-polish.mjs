// #149 설정 검색/스크롤, #144 첫 안내 높이. 앱은 내장 화면에 숨겨 띄우고 CDP만 쓴다.
// npm run build && OUT=/tmp/fairy-settings LANG_UNDER_TEST=ko node scripts/dev/settings-polish.mjs
// BASELINE=1은 빌드된 이전 판에서 첫 안내 크기와 화면만 기록한다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';

const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const baseline = process.env.BASELINE === '1';
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
const checks = [], metrics = [];
async function check(label, fn) {await fn(); checks.push(label); console.log('PASS',label);}
const tag = `${lang}-${baseline?'before':'after'}`;
let code=0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  if (!baseline) {
    await main('__jj.settingsWindow.open(); 1');
    const settings = await page('settings');
    await until(() => settings.ev('!!document.querySelector("#tab-pet")'), 'settings');
    // 제품의 최소 폭(360)보다 좁은 320 경계도 실제로 검사한다. 시험 창에만 하한을 낮춘다.
    await main('__jj.settingsWindow.window.setMinimumSize(320,420); 1');
    const tab = async id => {await settings.ev(`document.querySelector('#tab-${id}').click()`); await sleep(100);};
    const scroll = async value => {await settings.ev(`document.querySelector('main').scrollTop=${value}`); await sleep(100); return settings.ev('document.querySelector("main").scrollTop');};
    const pos = () => settings.ev('document.querySelector("main").scrollTop');
    const query = async text => {
      await settings.ev(`(() => {const i=document.querySelector('input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(text)}); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await sleep(150);
    };
    const key = async (key, code=key, modifiers=0) => {
      await settings.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});
      await settings.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});
      await sleep(100);
    };
    for (const width of [440,760,320]) {
      await main(`__jj.settingsWindow.window.setSize(${width},620); 1`); await sleep(200);
      assert.equal(await main('__jj.settingsWindow.window.getBounds().width'), width);
      const saved={};
      for (const [i,id] of ['pet','assist','ai','ease','data','about'].entries()) {await tab(id); saved[id]=await scroll(210+i*63);}
      for (const id of ['pet','ai','about','assist','data','ease','pet']) {
        await tab(id);
        await check(`${width}: ${id} 탭 위치 복원`, async () => assert.ok(Math.abs(await pos()-saved[id])<=1, `${id}: ${await pos()} / ${saved[id]}`));
      }
      await tab('ai');
      await settings.ev('document.querySelector("#tab-ai").focus()');
      await key('ArrowRight');
      await check(`${width}: 방향키 탭 전환 위치 복원`, async () => assert.ok(Math.abs(await pos()-saved.ease)<=1));
      const mod=process.platform==='darwin'?4:2;
      await key('3','Digit3',mod);
      await check(`${width}: Cmd/Ctrl+3 위치 복원`, async () => assert.ok(Math.abs(await pos()-saved.ai)<=1));
      await query('자동 실행');
      await check(`${width}: 검색은 위에서 시작`, async () => assert.equal(await pos(),0));
      await query('');
      await check(`${width}: 검색 해제 뒤 원래 탭 위치`, async () => assert.ok(Math.abs(await pos()-saved.ai)<=1));
      await tab('pet');
      // scroll 이벤트가 오기 전에 탭을 옮겨도 마지막 위치를 잃지 않아야 한다.
      await settings.ev('document.querySelector("main").scrollTop=333; document.querySelector("#tab-ai").click()');
      await sleep(100);
      await tab('pet');
      await check(`${width}: 스크롤 직후 빠른 탭 전환`, async () => assert.ok(Math.abs(await pos()-333)<=1));
    }
    for (const [q,expected] of [
      ['자동 실행',lang==='ko'?'컴퓨터를 켜면 같이 켜기':'Open at login'],
      ['autostart',lang==='ko'?'컴퓨터를 켜면 같이 켜기':'Open at login'],
      ['초기화',lang==='ko'?'기본으로':'Reset'],
      ['삭제',lang==='ko'?'AI 기록 지우기':'Clear AI history'],
    ]) {
      await query(q);
      const shown=await settings.ev(`[...document.querySelectorAll('main section')].filter(e=>e.getClientRects().length).map(e=>e.innerText).join(' | ')`);
      await check(`검색 '${q}' 실제 항목 표시`, async () => assert.ok(shown.includes(expected), shown));
      await settings.shot(`${tag}-search-${q==='autostart'?'startup':q}`);
    }
    await query('없는설정zzzz');
    await query('');
    await tab('pet');
    const original=await scroll(400);
    await query('삭제');
    await settings.ev('document.querySelector("input[type=search]").focus()');
    await key('Escape');
    await check('Esc는 검색만 지우고 탭 위치 복원', async () => assert.ok(Math.abs(await pos()-original)<=1));
    await settings.dark(true); await settings.shot(`${tag}-settings-dark`); await settings.dark(false);
    await main('__jj.settingsWindow.window.close(); 1');
  }
  await main('__jj.onboarding.open(); 1');
  let onboard=await page('onboarding');
  await until(() => onboard.ev('!!document.querySelector(".choice")'),'onboarding');
  const sizes=baseline?['default']:['default','small'];
  for (const size of sizes) {
    if (size==='small') {
      // 진짜 모니터를 바꾸지 않고 작은 작업 영역을 주입한다. 처음부터 맞는 크기로 열려야 한다.
      await main('__jj.onboarding.window.close(); 1');
      await until(() => main('!__jj.onboarding.window'), 'onboarding closed');
      await main('globalThis.primarySettingsTest=__jj.screen.getPrimaryDisplay; const d=__jj.screen.getPrimaryDisplay(); __jj.screen.getPrimaryDisplay=()=>({...d,workArea:{...d.workArea,width:360,height:500}}); __jj.onboarding.open(); __jj.screen.getPrimaryDisplay=primarySettingsTest; 1');
      onboard=await page('onboarding');
      await until(() => onboard.ev('!!document.querySelector(".choice")'),'small onboarding');
    }
    await sleep(400);
    const bounds=await main('__jj.onboarding.window.getBounds()');
    if (!baseline) await check(`${size}: 첫 안내 창 크기`, async () => {assert.equal(bounds.height,size==='default'?(lang==='en'?664:580):500); assert.equal(bounds.width,size==='default'?480:360);});
    for (let p=0;p<4;p++) {
      await onboard.ev('document.activeElement?.blur()');
      if (p>0) {await onboard.ev('document.querySelector("footer .primary").click()'); await sleep(200);}
      const m=await onboard.ev(`(() => {const e=document.querySelector('main'), f=document.querySelector('footer').getBoundingClientRect(); return {page:${p},size:${JSON.stringify(size)},viewport:[innerWidth,innerHeight],client:e.clientHeight,scroll:e.scrollHeight,footerBottom:f.bottom,footerTop:f.top,over:document.documentElement.scrollWidth>innerWidth};})()`);
      metrics.push({...m,bounds});
      if (!baseline) await check(`${size}: 첫 안내 ${p+1}쪽 버튼 접근`, async () => {assert.ok(m.footerBottom<=m.viewport[1]+1);assert.ok(m.footerTop>=0);assert.equal(m.over,false);});
      // 기본 창은 모든 쪽의 불필요한 스크롤을 없앤다. 작은 화면은 본문 스크롤로 읽는다.
      if (!baseline && size==='default') await check(`기본 ${p+1}쪽 불필요한 스크롤 없음`, async () => assert.ok(m.scroll<=m.client,JSON.stringify(m)));
      await onboard.shot(`${tag}-onboarding-${size}-${p+1}`);
      if (p===3) {
        await onboard.ev('document.querySelector("main").scrollTop=1e6'); await sleep(100);
        const last=await onboard.ev(`(() => {const a=document.querySelector('main').getBoundingClientRect(),b=[...document.querySelectorAll('.tips dd')].at(-1).getBoundingClientRect();return {bottom:b.bottom,area:a.bottom};})()`);
        if (!baseline) await check(`${size}: 마지막 설정 안내까지 읽기`, async () => assert.ok(last.bottom<=last.area+1,JSON.stringify(last)));
      }
    }
  }
  writeFileSync(join(process.env.OUT,`${tag}-metrics.json`),JSON.stringify(metrics,null,2));
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
