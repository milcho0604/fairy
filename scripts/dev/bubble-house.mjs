// #185. npm run build && OUT=/tmp/fairy-185 LANG_UNDER_TEST=ko node scripts/dev/bubble-house.mjs
// 빈 데이터, 숨은 내장 화면, CDP 전용 입력. 기본 펫만 스크린샷을 남긴다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const scratch = mkdtempSync(join(tmpdir(), 'fairy-185-'));
const data = join(scratch, 'data');
const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
process.env.OUT ??= '/tmp/fairy-185';
mkdirSync(data);
mkdirSync(join(scratch, 'home'));
mkdirSync(process.env.OUT, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang, wander: false, pet3d: false, petKind: 'bear', chatter: 'quiet', friends: [], saverTold: true }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
async function port() {
  const s = createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return String(p);
}
process.env.JJ_INSPECT_PORT = await port();
process.env.JJ_PAGE_PORT = await port();
let logs = '';
function launch() {
  const app = spawn(electron, [`--inspect=${process.env.JJ_INSPECT_PORT}`, '.', `--remote-debugging-port=${process.env.JJ_PAGE_PORT}`], {
    cwd: resolve(import.meta.dirname, '../..'),
    env: { ...process.env, HOME: join(scratch, 'home'), JJ_USER_DATA: data, JJ_NO_FOCUS: '1', JJ_SHOW: '', JJ_TEST_SECRETS: 'memory' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', b => { logs += b; });
  app.stderr.on('data', b => { logs += b; });
  return app;
}
let app = launch();
const cdp = await import('./cdp.mjs');
const clients = [cdp];
const { main, page, sleep } = cdp;
const results = [];
async function until(fn, name) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fn(); if (r) return r; } catch {}
    await sleep(100);
  }
  throw new Error(`timeout: ${name}`);
}
async function check(name, fn) {
  await fn();
  console.log('PASS', name);
  results.push(name);
}
let exitCode = 0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  const pet = await page('pet');
  await until(() => pet.ev('typeof __pet !== "undefined"'), '__pet');
  await sleep(1200);
  const area = await main('__jj.screen.getPrimaryDisplay().workArea');
  await check('시험 창 내장 화면 / 투명 / Dock 호출 없음', async () => {
    assert.equal((await main('__jj.screen.getAllDisplays()')).length, 1);
    assert.equal(await main('__jj.pet.win.getOpacity()'), 0);
    assert.equal((await main('__jj.dock.stats()')).shows, 0);
  });
  await main(`for (const title of ${JSON.stringify(lang === 'ko' ? ['분기 보고서 검토', '회의 준비', '문서 확인'] : ['Review report', 'Prepare meeting', 'Check document'])}) { const todo = __jj.store.add({title}, Date.now()); __jj.doing.set(todo.id, true); } 1`);
  const text = await main('__jj.petChips.statusNow()');
  const measure = () => pet.ev(`(() => {
    const c = document.querySelector('#pet-gpu:not([hidden])') ?? document.querySelector('#pet');
    const r = c.getBoundingClientRect(), b = document.querySelector('#bubble'), q = b.getBoundingClientRect();
    const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let top = c.height, bottom = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (rgba[(y*c.width+x)*4+3] >= 96) { top = Math.min(top, y); bottom = Math.max(bottom, y+1); }
    const side = b.dataset.side;
    const tail = getComputedStyle(b, '::after');
    const border = parseFloat(getComputedStyle(b).borderTopWidth);
    // 회전한 12px 사각형의 끝. CSS 위치는 말풍선 padding edge 기준.
    const reach = Math.SQRT2 * (parseFloat(tail.width) + parseFloat(tail.borderLeftWidth) + parseFloat(tail.borderRightWidth)) / 2;
    const tip = side === 'above'
      ? q.bottom - border - parseFloat(tail.bottom) - (parseFloat(tail.height)+parseFloat(tail.borderTopWidth)+parseFloat(tail.borderBottomWidth))/2 + reach
      : q.top + border + parseFloat(tail.top) + (parseFloat(tail.height)+parseFloat(tail.borderTopWidth)+parseFloat(tail.borderBottomWidth))/2 - reach;
    const artTop = r.top + top * r.height / c.height, artBottom = r.top + bottom * r.height / c.height;
    return { side, gap: side === 'above' ? artTop-tip : tip-artBottom, artTop, artBottom, tip,
      bubbleY: q.y, tailX: q.x + parseFloat(getComputedStyle(b).getPropertyValue('--tail-x')),
      petX: r.x, petY: r.y, petSize: r.width, windowW: innerWidth, windowH: innerHeight, shown: getComputedStyle(b).visibility,
      text: b.querySelector('p').textContent, ambient: b.hasAttribute('data-ambient') };
  })()`);
  const readings = [];
  const image = await pet.ev(`(() => {const c=document.createElement('canvas'); c.width=c.height=160; const g=c.getContext('2d'); g.fillStyle='#ac58db'; g.fillRect(40,80,80,64); return c.toDataURL();})()`);
  for (const source of process.env.ONLY === 'house' ? [] : ['default', 'photo', 'sheet', 'default3d']) {
    if (source === 'default3d') await main('__jj.settings.set({pet3d:true, petKind:"kong"}); 1');
    else if (source !== 'default') await main(`__jj.pet.win.webContents.send('pet:image', ${JSON.stringify({ main: image, poses: {}, ...(source === 'sheet' ? { sprites: { idle: image } } : {}) })}); 1`);
    await sleep(source === 'default3d' ? 3000 : 700);
    for (const scale of [0.5, 1, 1.5, 2]) {
      for (const position of ['above', 'below', 'edge']) {
        await main(`__jj.pet.debugScale(${scale}); __jj.pet.debugMoveTo(${position === 'edge' ? area.x + area.width - 160 * scale : area.x + area.width / 2 - 80 * scale}, ${position === 'below' ? area.y : area.y + area.height - 160 * scale}); __jj.pet.setStatus({text:${JSON.stringify(text)}}); 1`);
        await pet.ev('__pet.setInputs({talkingUntil:0, userIdleMs:0, thinking:false, excitedUntil:0, systemBusy:false, grabbed:false})');
        await sleep(650);
        const m = await measure();
        await check(`${source} / ${scale} / ${position}`, async () => {
          assert.equal(m.shown, 'visible');
          assert.equal(m.text, text);
          assert.equal(m.ambient, true);
          if (position !== 'below') assert.equal(m.side, 'above');
          // 투명 여백에 자리가 있으면 화면 맨 위에서도 위로 뜬다.
          if (position === 'below' && m.side === 'above') assert.ok(m.bubbleY >= 0);
          // 배치는 알파 24, 화면 측정은 96 기준이므로 확대 시 흐린 가장자리를 허용한다.
          assert.ok(m.gap >= -1 && m.gap <= 18, JSON.stringify(m));
          assert.ok(Math.abs(m.tailX - (m.petX + m.petSize/2)) < 2, JSON.stringify(m));
          assert.ok(m.petY >= 0 && m.petY + m.petSize <= m.windowH, JSON.stringify(m));
        });
        readings.push({source, scale, position, ...m});
        if (source === 'default') await pet.shot(`${lang}-${source}-${scale}-${position}`);
      }
    }
    await main(`__jj.pet.debugScale(1); __jj.pet.debugMoveTo(${area.x + area.width/2}, ${area.y + area.height - 160}); 1`);
    await sleep(400);
    const before = await measure();
    for (const type of ['walk', 'hop']) {
      await pet.ev(`__pet.debugActivity({type:${JSON.stringify(type)}, ms:5000, dir:1, speed:100}, 0.25)`);
      await sleep(300);
      const after = await measure();
      await check(`${source} / ${type} 프레임에서 말풍선 기준 고정`, async () => assert.equal(after.bubbleY, before.bubbleY));
    }
    await pet.ev('__pet.debugActivity()');
    await sleep(400);
    await check(`${source} / CDP 꾹 누르기 확대와 놓기`, async () => {
      const initial = await measure();
      const x = initial.petX + initial.petSize / 2;
      const y = (initial.artTop + initial.artBottom) / 2;
      await pet.send('Input.dispatchMouseEvent', {type:'mouseMoved', x, y});
      await pet.send('Input.dispatchMouseEvent', {type:'mousePressed', x, y, button:'left', buttons:1, clickCount:1});
      await sleep(1000);
      const held = await measure();
      assert.equal(held.text, text);
      assert.ok(Math.abs(held.petSize - initial.petSize * 1.4) <= 2, JSON.stringify({initial,held}));
      assert.ok(held.gap >= -1 && held.gap <= 18, JSON.stringify(held));
      if (source === 'default') await pet.shot(`${lang}-default-held`);
      await pet.send('Input.dispatchMouseEvent', {type:'mouseReleased', x, y, button:'left', buttons:0, clickCount:1});
      await sleep(600);
      assert.equal((await measure()).petSize, initial.petSize);
    });
  }
  writeFileSync(join(process.env.OUT, `${lang}-measurements.json`), JSON.stringify(readings, null, 2));
  await main('__jj.pet.setStatus(undefined); __jj.shop.setOwnedItems({house:1},Date.now()); __jj.house.show({level:1,style:"wood"},__jj.pet.bounds()); 1');
  await sleep(500);
  // 집 창은 data: SVG 한 장. 현재 창을 매번 다시 찾아 재생성도 검증한다.
  await main('globalThis.house185 = () => __jj.pet.win.constructor.getAllWindows().find(w => w.webContents.getURL().startsWith("data:text/html")); 1');
  const visible = () => main('__jj.house.visible()');
  await check('집 초기 표시', async () => assert.equal(await visible(), true));
  for (const reason of ['user', 'presentation']) {
    await main(`__jj.pet.setHidden(${JSON.stringify(reason)}, true, false); 1`);
    await until(async () => !(await visible()), `house hidden ${reason}`);
    await main(`__jj.pet.setHidden(${JSON.stringify(reason)}, false, false); 1`);
    await check(`펫 ${reason} 숨김 해제 후 집 복원`, async () => { await until(visible, 'house visible'); });
  }
  await check('집 숨김 + 펫 숨김 중 한 이유만 풀어도 집은 숨김 유지', async () => {
    await main('__jj.house.stow(true); __jj.pet.setHidden("user",true,false); 1');
    await sleep(2200);
    await main('__jj.pet.setHidden("user",false,false); 1');
    await sleep(2200);
    assert.equal(await visible(), false);
    await main('__jj.house.show({level:2,style:"wood"},__jj.pet.bounds()); 1');
    await sleep(500);
    assert.equal(await visible(), false);
    await main('__jj.house.stow(false); 1');
    await until(visible, 'unstow upgraded house');
  });
  await check('내려간 집 창 복원', async () => {
    await main('house185().hide(); __jj.house.heal(); 1');
    assert.equal(await visible(), true);
  });
  await check('모니터 제거 / 해상도 / Dock 작업 영역 변화 뒤 화면 밖 집 복원', async () => {
    // 외부 화면을 연결하지 않고 창이 화면 밖에 남은 결과를 CDP로 넣는다.
    await main(`house185().setPosition(${area.x-500},${area.y-500}); __jj.house.heal(); 1`);
    const b = await main('__jj.house.bounds()');
    assert.ok(b.x >= area.x && b.y >= area.y && b.x+b.width <= area.x+area.width && b.y+b.height <= area.y+area.height);
  });
  await check('집 렌더러 재로딩 뒤 문/문간 그림 복원', async () => {
    await main(`__jj.house.setSprites({awake:${JSON.stringify(image)},sleep:${JSON.stringify(image)},box:{x:0.2,y:0.2,side:0.6}}); __jj.house.setDoor(true); __jj.house.setWalker('at'); house185().webContents.reload(); 1`);
    await until(() => main(`house185().webContents.executeJavaScript("document.body.classList.contains('open') && document.body.classList.contains('wk-at') && !!document.querySelector('image.wk')?.getAttribute('href')")`), 'house reload state');
    assert.equal(await visible(), true);
    await main('__jj.house.setWalker("none"); __jj.house.setDoor(false); 1');
  });
  await check('없어진 집 창 재생성', async () => {
    await main('house185().destroy(); __jj.house.heal(); 1');
    await until(visible, 'destroyed house rebuild');
  });
  await check('펫 화면 재로딩 뒤 집 표시', async () => {
    await main('__jj.pet.reload(false); 1');
    await sleep(1700);
    await until(visible, 'pet reload house');
  });
  await check('큰 창/전체 화면 복귀 때 집 창 설정 재적용 (Dock 실제 호출 0)', async () => {
    await main('globalThis.houseAsserts185=0; const w=house185(); const keep=w.setVisibleOnAllWorkspaces.bind(w); w.setVisibleOnAllWorkspaces=(...a)=>{ houseAsserts185++; return keep(...a); }; __jj.home.open(); 1');
    await sleep(600);
    await main('__jj.home.window.emit("enter-full-screen"); __jj.home.window.emit("leave-full-screen"); __jj.home.hide(); 1');
    assert.ok(await main('houseAsserts185 >= 2'));
    assert.equal(await visible(), true);
    assert.equal((await main('__jj.dock.stats()')).shows, 0);
  });
  for (const phase of ['going', 'inside', 'leaving']) {
    await check(`집 ${phase} 중 펫 숨기기와 다시 부르기`, async () => {
      await main('void __jj.rest.start(); 1');
      await until(() => main(`__jj.rest.phase() === ${JSON.stringify(phase === 'leaving' ? 'inside' : phase)}`), 'rest phase');
      if (phase === 'leaving') await main('void __jj.rest.call(false); 1');
      await main('__jj.pet.setHidden("user",true,false); 1');
      await until(async () => !(await visible()), 'rest hidden');
      await main('__jj.pet.setHidden("user",false,false); void __jj.rest.call(false); 1');
      await until(() => main('__jj.rest.phase() === "out" && !__jj.rest.doorBusy() && __jj.house.visible()'), 'rest restored');
    });
  }
  await check('집 안에서 잠자기/깨우기 알림 뒤 집 유지', async () => {
    await main('void __jj.rest.start(); 1');
    await until(() => main('__jj.rest.phase() === "inside"'), 'inside before suspend');
    await main('__jj.powerMonitor.emit("suspend"); __jj.powerMonitor.emit("resume"); __jj.house.heal(); 1');
    assert.equal(await visible(), true);
  });
  await check('집 안에서 앱 종료 후 다시 시작하면 펫과 집이 보임', async () => {
    cdp.disconnect();
    const gone = new Promise(r => app.once('exit', r));
    app.kill('SIGTERM');
    await gone;
    app = launch();
    const fresh = await import('./cdp.mjs?restart');
    clients.push(fresh);
    await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'restart inspector');
    await until(() => fresh.main('typeof __jj !== "undefined" && __jj.house.visible()'), 'restart house');
    assert.equal(await fresh.main('__jj.rest.phase()'), 'out');
    assert.equal(await fresh.main('__jj.pet.isHidden()'), false);
    await fresh.main('__jj.setHouseHidden(true); 1');
    await until(() => fresh.main('__jj.house.stowed() && !__jj.house.visible()'), 'stowed before restart');
    fresh.disconnect();
    const goneAgain = new Promise(r => app.once('exit', r));
    app.kill('SIGTERM');
    await goneAgain;
    app = launch();
    const hidden = await import('./cdp.mjs?restart-hidden');
    clients.push(hidden);
    await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'hidden restart inspector');
    await until(() => hidden.main('typeof __jj !== "undefined" && __jj.house.stowed()'), 'stowed after restart');
    assert.equal(await hidden.main('__jj.house.visible()'), false);
    await hidden.main('__jj.setHouseHidden(false); 1');
    await until(() => hidden.main('__jj.house.visible()'), 'unstowed after restart');
  });
  writeFileSync(join(process.env.OUT, `${lang}-results.json`), JSON.stringify(results, null, 2));
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  for (const client of clients) client.disconnect();
  writeFileSync(join(process.env.OUT, `${lang}-app.log`), logs);
  const gone = new Promise(r => app.once('exit', r));
  app.kill('SIGTERM');
  await Promise.race([gone, sleep(4000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
  rmSync(scratch, {recursive:true, force:true});
  process.exit(exitCode);
}
