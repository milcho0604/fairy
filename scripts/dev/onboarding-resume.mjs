// #149: 일하는 시간 안내, 파일 출처 이름, 닫기/종료 뒤 첫 안내 이어보기.
// npm run build && OUT=/tmp/fairy-onboarding LANG_UNDER_TEST=ko node scripts/dev/onboarding-resume.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';
const lang=process.env.LANG_UNDER_TEST==='en'?'en':'ko';
process.env.OUT ??= '/tmp/fairy-onboarding';
const scratch=mkdtempSync(join(tmpdir(),'fairy-onboarding-'));
const data=join(scratch,'data'),home=join(scratch,'home');
for(const d of [data,home,process.env.OUT])mkdirSync(d,{recursive:true});
writeFileSync(join(data,'settings.json'),JSON.stringify({onboarded:false,lang,pet3d:false,wander:false,osNotify:false,chatter:'quiet',saverTold:true}));
writeFileSync(join(data,'day-plan.json'),JSON.stringify({prefs:{auto:false,fromMinute:480}}));
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return String(p);}
process.env.JJ_INSPECT_PORT=await port();process.env.JJ_PAGE_PORT=await port();
let logs='';
function launch(){const app=spawn(electron,[`--inspect=${process.env.JJ_INSPECT_PORT}`,'.',`--remote-debugging-port=${process.env.JJ_PAGE_PORT}`],{
 cwd:resolve(import.meta.dirname,'../..'),env:{...process.env,HOME:home,PATH:`/usr/bin:/bin:${dirname(process.execPath)}`,SHELL:'/usr/bin/false',JJ_USER_DATA:data,JJ_NO_FOCUS:'1',JJ_SHOW:'',JJ_TEST_SECRETS:'memory'},stdio:['ignore','pipe','pipe']});
 app.stdout.on('data',b=>{logs+=b;});app.stderr.on('data',b=>{logs+=b;});return app;}
let app=launch();
const {main,page,sleep,disconnect}=await import('./cdp.mjs');
const results=[];
async function until(fn,label){for(let i=0;i<120;i++){try{if(await fn())return;}catch{}await sleep(100);}throw new Error(`timeout: ${label}`);}
async function check(label,fn){await fn();results.push(label);console.log('PASS',label);}
async function boot(){await until(async()=>(await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok,'inspector');await until(()=>main('typeof __jj!=="undefined"'),'__jj');}
async function stop(){disconnect();const gone=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await Promise.race([gone,sleep(4000)]);if(app.exitCode===null){app.kill('SIGKILL');await gone;}}
async function open(){await main('__jj.onboarding.open(); 1');const p=await page('onboarding');await until(()=>p.ev('!!document.querySelector("main h1")'),'onboarding content');return p;}
async function close(){await main('__jj.onboarding.window.close(); 1');await until(()=>main('!__jj.onboarding.window'),'onboarding closed');}
async function current(p){return p.ev('[...document.querySelectorAll(".dots li")].findIndex(e=>e.classList.contains("on"))');}
async function next(p){await p.ev('document.querySelector("footer .primary").click()');await sleep(150);}
async function spy(){await main('globalThis.doneCalls=0; globalThis.originalJourneyStart=__jj.journey.start; __jj.journey.start=()=>{doneCalls++;originalJourneyStart()}; 1');}
let code=0;
try{
 await boot();
 let p=await page('onboarding');await until(()=>p.ev('!!document.querySelector(".choice")'),'first boot');await spy();
 await check('최초 실행은 1쪽이며 미완료',async()=>{assert.equal(await current(p),0);assert.equal(await main('__jj.settings.get().onboarded'),false);});
 const petName=lang==='ko'?'봄':'Pip';
 await p.ev(`(()=>{const e=document.querySelector('.field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(petName)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.blur();})()`);await sleep(200);
 await next(p);
 await check('일하는 시간의 쉬운 제목과 9시/6시 예시',async()=>{const text=await p.ev('document.querySelector("main").innerText');assert.ok(text.includes(lang==='ko'?'일 시작과 마치는 시간':'Your work hours'));assert.ok(text.includes(lang==='ko'?'9시~오후 6시':'9am to 6pm'));});
 await p.ev('document.querySelector(".pick-two button").click()');await sleep(150);
 await p.shot(`${lang}-routine-default`);
 await main('__jj.onboarding.window.setSize(360,500); 1');await sleep(200);await p.shot(`${lang}-routine-small`);
 await check('작은 창에서도 다음 단추가 화면 안',async()=>assert.ok(await p.ev('document.querySelector("footer").getBoundingClientRect().bottom<=innerHeight+1')));
 await close();
 await check('OS 닫기는 완료/첫 여정을 시작하지 않고 2쪽 저장',async()=>{assert.equal(await main('__jj.settings.get().onboarded'),false);assert.equal(await main('doneCalls'),0);assert.equal(await main('!!__jj.journey.state.start'),false);const s=JSON.parse(readFileSync(join(data,'settings.json'),'utf8'));assert.equal(s.onboardPage,1);assert.equal(s.onboarded,false);});
 p=await open();
 await check('다시 열면 보던 쪽과 고른 이름/일하는 시간 유지',async()=>{assert.equal(await current(p),1);assert.equal(await main('__jj.settings.get().petName'),petName);assert.equal(await main('__jj.settings.get().routine.on'),true);});
 await p.ev('document.activeElement?.blur()');await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
 await until(()=>main('__jj.settings.get().onboardPage===2'),'keyboard saved');
 await check('방향키 이동도 쪽을 저장',async()=>assert.equal(await current(p),2));
 await stop();app=launch();await boot();p=await page('onboarding');await until(()=>p.ev('!!document.querySelector("main h1")'),'restart content');
 await check('안내 중 앱 종료/재시작 뒤 3쪽 자동 이어보기',async()=>{assert.equal(await current(p),2);assert.equal(await main('__jj.settings.get().onboarded'),false);assert.equal(await main('!!__jj.journey.state.start'),false);});
 await spy();await next(p);await next(p);
 await check('마지막 쪽에 도착만 해서는 완료되지 않음',async()=>assert.equal(await main('__jj.settings.get().onboarded'),false));
 await next(p);await until(()=>main('!__jj.onboarding.window'),'finished');
 await check('시작 단추는 완료·쪽 초기화·첫 여정 한 번',async()=>{assert.equal(await main('__jj.settings.get().onboarded'),true);assert.equal(await main('__jj.settings.get().onboardPage'),0);assert.equal(await main('doneCalls'),1);assert.ok(await main('__jj.journey.state.start'));});
 p=await open();assert.equal(await current(p),0);await next(p);await close();p=await open();
 await check('완료 뒤 다시 보기는 첫 쪽이며 닫아도 완료 유지',async()=>{assert.equal(await current(p),0);assert.equal(await main('__jj.settings.get().onboarded'),true);assert.equal(await main('doneCalls'),1);});
 await p.ev('document.querySelector("footer .link").click()');await until(()=>main('!__jj.onboarding.window'),'replay skip');
 await check('다시 보기 건너뛰기는 첫 여정을 중복 시작하지 않음',async()=>assert.equal(await main('doneCalls'),1));
 // 같은 격리 데이터에서 미완료 안내의 건너뛰기 경로도 검사한다.
 await main('__jj.settings.set({onboarded:false,onboardPage:0}); 1');p=await open();await p.ev('document.querySelector("footer .link").click()');await until(()=>main('!__jj.onboarding.window'),'first skip');
 await check('미완료 안내의 건너뛰기는 명시적 완료로 처리',async()=>{assert.equal(await main('__jj.settings.get().onboarded'),true);assert.equal(await main('__jj.settings.get().onboardPage'),0);assert.equal(await main('doneCalls'),2);});
 await stop();app=launch();await boot();await sleep(1800);
 await check('완료 뒤 앱 재시작은 안내 자동 열림 없음',async()=>assert.equal(await main('!!__jj.onboarding.window'),false));
 await main('globalThis.dialogs149=[]; __jj.dialog.showOpenDialog=async(...args)=>{dialogs149.push(args.at(-1));return {canceled:true,filePaths:[]}}; __jj.settingsWindow.open(); 1');
 const settings=await page('settings');await until(()=>settings.ev('!!document.querySelector("#tab-data")'),'settings');await settings.ev('document.querySelector("#tab-data").click()');await sleep(150);
 const labels=lang==='ko'?['백업 파일에서 복원','페어리 파일에서 가져오기']:['Restore a backup file','Import a fairy file'];
 for(const [i,label]of labels.entries()){
  await settings.ev(`[...document.querySelectorAll('#panel-data button')].find(e=>e.textContent===${JSON.stringify(label)}).click()`);
  await until(()=>main(`dialogs149.length===${i+1}`),'file dialog route');
  const opts=await main(`dialogs149[${i}]`);
  await check(`'${label}' 기존 파일 선택 경로`,async()=>assert.ok(opts.filters.flatMap(f=>f.extensions).includes(i===0?'fairybackup':'fairy')));
 }
 await main('__jj.settingsWindow.window.setMinimumSize(320,420); 1');
 for(const width of [320,440]){await main(`__jj.settingsWindow.window.setSize(${width},620); 1`);await sleep(150);assert.equal(await main('__jj.settingsWindow.window.getBounds().width'),width);
  await check(`${width}: 파일 출처 단추 글자 넘침 없음`,async()=>assert.ok(await settings.ev(`[...document.querySelectorAll('#panel-data button')].filter(e=>${JSON.stringify(labels)}.includes(e.textContent)).every(e=>e.scrollWidth<=e.clientWidth+1)`)));
  await settings.shot(`${lang}-import-${width}`);
 }
 await settings.dark(true);await settings.shot(`${lang}-import-dark`);
 writeFileSync(join(process.env.OUT,`${lang}-results.json`),JSON.stringify(results,null,2));
}catch(e){console.error(e);code=1;}finally{await stop();writeFileSync(join(process.env.OUT,`${lang}-app.log`),logs);rmSync(scratch,{recursive:true,force:true});process.exit(code);}
