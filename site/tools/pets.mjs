#!/usr/bin/env node
// 홈페이지의 페어리 그림을 지금 앱에서 크게(4배) 다시 찍는다. 모두 투명 배경 PNG 한 장씩:
//   kind-<id>.png    기본 페어리 다섯과 그림 친구 밀크, 초코 (입체 피규어)
//   style-<id>.png   콩이의 모습: figure, game, real, fluffy, flat(납작한 2D), photo3d(밀크 그림 + 설계도 예시로 만든 입체)
//   mood-<id>.png    쓰다듬기(하트), 기뻐하기, 춤추기, 하품, 졸기, AI 답 기다리기
//   walk-<n>.png, idle-<n>.png, cheer-<n>.png   걷는 콩이 (히어로 바닥), 시계를 멈춰 한 칸씩 찍는다
// Re-shoots the site's fairy pictures from the current app at 4x (pet scale 2, device scale 2), one transparent PNG each.
// Then `python3 site/tools/shots.py pets <OUT>` lays them out and writes the site's webp.
//
//   npm run build
//   OUT=<dir> node site/tools/pets.mjs [kinds styles moods sprite]
//
// 시험 창 규칙 (CLAUDE.md): tools/app.mjs 가 JJ_NO_FOCUS=1, 빈 데이터 폴더, 인터넷 막기로 띄운다. 입력은 CDP 로만.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXAMPLE_CAT } from '../../src/shared/pet3d/examples.ts';
import { launch, retry, root, sleep } from './app.mjs';

const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'fairy-site-pets'));
const only = new Set(process.argv.slice(2));
const want = (n) => only.size === 0 || only.has(n);
const PET_SCALE = 2;
const DPR = 2;
mkdirSync(OUT, { recursive: true });

const { data, main, page, finish } = await launch();
const NEUTRAL = '{hidden:false,grabbed:false,thinking:false,talkingUntil:0,systemBusy:false,excitedUntil:0,userIdleMs:0,focusTimer:false,sulkLevel:0,pout:0,hungry:false}';

let failed = false;
try {
  await retry(() => main('typeof __jj === "object" && !!__jj.pet.win'));
  await sleep(2000);
  // the app notices real typing on this computer and puts a keyboard in front of the fairy: pretend hands are off
  await main(`__jj.together.debugFeed(false); __jj.pet.debugScale(${PET_SCALE}); 1`);
  await sleep(800);
  const pet = await page('pet');
  await pet.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  // Always awake and calm while shooting; window.__site holds the inputs a picture wants on top.
  // A frozen clock (window.__t) lets the walk and dance be shot one exact step at a time.
  await pet.ev(`(() => {
    window.__site = {};
    const real = performance.now.bind(performance);
    window.__t = null;
    performance.now = () => (window.__t == null ? real() : window.__t);
    window.__siteTimer = setInterval(() => window.__pet && __pet.setInputs({ ...${NEUTRAL}, ...window.__site }), 50);
    return 1;
  })()`);

  async function shoot(file, wait = 1500) {
    await pet.ev(`document.getElementById('bubble')?.click(); 1`);
    const { w, p } = await main('({ w: __jj.pet.win.getBounds(), p: __jj.pet.bounds() })');
    await pet.send('Emulation.setDeviceMetricsOverride', { width: w.width, height: w.height, deviceScaleFactor: DPR, mobile: false });
    await sleep(wait);
    const r = await pet.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: p.x - w.x, y: p.y - w.y, width: p.width, height: p.height, scale: 1 },
    });
    writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
    console.log('shot', file);
  }
  async function asKind(kind, style = 'figure', threeD = true) {
    await main(`__jj.library.toDefault(${JSON.stringify(kind)}); __jj.settings.set({ pet3d: ${threeD}, petStyle: '${style}' }); 1`);
    await sleep(2500);
  }

  if (want('kinds')) {
    for (const kind of ['kong', 'cat', 'chick', 'dog', 'bunny']) {
      await asKind(kind);
      await shoot(`kind-${kind}.png`);
    }
    for (const id of ['milk', 'choco']) {
      await main(`__jj.library.fromStarter(${JSON.stringify(id)}); 1`);
      await sleep(2500);
      await shoot(`kind-${id}.png`);
    }
  }

  if (want('styles')) {
    for (const style of ['figure', 'game', 'real', 'fluffy']) {
      await asKind('kong', style);
      if (style === 'fluffy') { await sleep(3000); await pet.ev('__pet.debugSettle3d(); 1'); }
      await shoot(`style-${style}.png`);
    }
    await asKind('kong', 'figure', false);
    await shoot('style-flat.png');
    // A photo fairy turned into a 3D figure: Milk's picture with the example blueprint the app shows in its prompt
    // (long-haired white cat, src/shared/pet3d/examples.ts). Same as docs/assets/screens/pet-styles.png.
    copyFileSync(join(root, 'resources', 'pets', 'milk.png'), join(data, 'pets', 'pet-site.png'));
    writeFileSync(join(data, 'pets', 'model-site.json'), JSON.stringify(EXAMPLE_CAT));
    await main(`__jj.settings.set({ petImage: 'pet-site.png', petModel: 'model-site.json', petDepth: null, pet3d: true, petStyle: 'figure' }); 1`);
    await sleep(3000);
    await shoot('style-photo3d.png');
  }

  if (want('moods')) {
    await asKind('kong');
    await main(`__jj.pet.win.webContents.send('pet:react', 'love'); 1`);
    await shoot('mood-love.png', 700);
    await sleep(2500);
    await pet.ev(`window.__site = { excitedUntil: performance.now() + 60000 }; 1`);
    await shoot('mood-happy.png', 900);
    await pet.ev(`window.__site = {}; 1`);
    await sleep(1200);
    await pet.ev(`__pet.debugTrick('dance', 0.12); 1`);
    await shoot('mood-dance.png', 250);
    await sleep(2500);
    await pet.ev(`__pet.debugActivity({ type: 'yawn', ms: 2600 }, 0.5); 1`);
    await shoot('mood-yawn.png', 150);
    await pet.ev(`__pet.debugActivity(undefined); window.__site = { userIdleMs: 3600000 }; 1`);
    await shoot('mood-sleep.png', 2500);
    await pet.ev(`window.__site = { thinking: true }; 1`);
    await shoot('mood-think.png', 1500);
    await pet.ev(`window.__site = {}; 1`);
    await sleep(1500);
  }

  if (want('sprite')) {
    await asKind('kong');
    const { w } = await main('({ w: __jj.pet.win.getBounds() })');
    await pet.send('Emulation.setDeviceMetricsOverride', { width: w.width, height: w.height, deviceScaleFactor: DPR, mobile: false });
    await sleep(1500);
    const step = async (file, js) => {
      await pet.ev(js);
      await sleep(120);
      await shoot(file, 60);
    };
    // idle: breathing, a frame every 600ms
    for (let i = 0; i < 4; i++) await step(`idle-${i}.png`, `window.__t = 100000 + ${i * 600}; __pet.setInputs({}); 1`);
    // walk: a long linear walk, one frame every 80ms of the app's own clock
    const WALK = 8000;
    await pet.ev(`window.__t = 200000; __pet.debugActivity({ type: 'walk', dx: 400, ms: ${WALK}, linear: true }, 0); 1`);
    for (let i = 0; i < 60; i++) await step(`walk-${String(i).padStart(2, '0')}.png`, `window.__t = 200000 + ${i * 80}; __pet.setInputs({}); 1`);
    await pet.ev(`__pet.debugActivity(undefined); 1`);
    // cheer: the little spin dance
    await pet.ev(`window.__t = 300000; __pet.debugTrick('dance', 0); 1`);
    for (let i = 0; i < 16; i++) await step(`cheer-${String(i).padStart(2, '0')}.png`, `window.__t = 300000 + ${i * 90}; __pet.setInputs({}); 1`);
    await pet.ev(`window.__t = null; 1`);
  }
} catch (err) {
  console.error('failed:', err instanceof Error ? err.message : err);
  failed = true;
}
await finish(failed ? 1 : 0);
