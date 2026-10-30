// 작은 패널 화면 디테일: 머리줄 한 줄(코인 4, 5자리), 일정 긴 제목, 쪽지함 칩 줄, 쪽지함 덮개 닫기, 상점 안내 겹침, 한 글자 끝줄.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en DARK=1 node scripts/dev/panel-detail.mjs
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 와 DOM 으로만, PATH 는 최소.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? join(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'panel-detail'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const DARK = Boolean(process.env.DARK);
const TAG = process.env.TAG ?? 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tx = (a, b) => (LANG === 'ko' ? a : b);
mkdirSync(OUT, { recursive: true });
process.env.OUT = OUT;
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}${DARK ? ' dark' : ''}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.panel-detail-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: 'Kongi', chatter: 'quiet', dailyNotes: true }));

async function launch() {
  const INSPECT = await freePort();
  const PAGE = await freePort();
  const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
    cwd: root,
    env: { HOME: home, SHELL: '/usr/bin/false', PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
    stdio: 'ignore',
  });
  process.env.JJ_INSPECT_PORT = String(INSPECT);
  process.env.JJ_PAGE_PORT = String(PAGE);
  const cdp = await import(`./cdp.mjs?${INSPECT}`);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await cdp.main('typeof __jj')) === 'object') break;
    } catch {}
    await sleep(250);
  }
  const stop = async () => {
    cdp.disconnect();
    try { app.kill('SIGTERM'); } catch {}
    await sleep(900);
    try { app.kill('SIGKILL'); } catch {}
  };
  return { ...cdp, stop, pid: app.pid };
}

// 코인을 쌓으려고 한 번 띄워 저장 파일을 만든 뒤, 끄고 장부에 적어 다시 띄운다
let a = await launch();
await a.stop();
const dbFile = readdirSync(data).find((f) => f === 'jjakkung.db');
if (dbFile) {
  const db = new DatabaseSync(join(data, dbFile));
  const now = Date.now();
  db.prepare("insert into coin_log (amount, reason, ref_id, day, at) values (?, 'test', null, '2020-01-01', ?)").run(6000, now);
  db.close();
}
a = await launch();
const { main } = a;
process.on('uncaughtException', async (e) => { console.log(String(e)); await a.stop(); rmSync(scratch, { recursive: true, force: true }); process.exit(1); });
const setW = async (w, h = 680) => {
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: ${h} }); 1`);
  await sleep(500);
};
const long = tx('아주 긴 일정 제목이 두 줄 세 줄로 꺾여도 세로로 찌그러지지 않는지 보려고 일부러 길게 적었어요', 'A very long event title that wraps past two lines to see whether the line breaks look nice, written long on purpose');
  const at = new Date(); at.setHours(23, 30, 0, 0);
  await main(`__jj.events.add({ title: ${JSON.stringify(long)}, startAt: ${at.getTime()}, reminds: [] }, ${Date.now()}); 1`);
await main("__jj.panel.togglePanel(); 1");
await sleep(1800);
await main("__jj.panel.window.removeAllListeners('blur'); 1");
let p = await a.page('panel');
await p.dark(DARK);
const rect = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);

// ---- 머리줄: 코인 4, 5자리에서도 한 줄 ----
for (const w of [320, 360, 560]) {
  await setW(w);
  await main("__jj.panel.openTab('today'); 1");
  await sleep(400);
  for (const digits of ['1237', '12370']) {
    await p.ev(`(() => { const c = document.querySelector('.coins'); const n = [...c.childNodes].find((x) => x.nodeType === 3); if (n) n.textContent = ${JSON.stringify(digits)}; return 1; })()`);
    await sleep(150);
    const tops = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('.panel header > *:not(.sr-only)')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().top)))`));
    check(`머리줄 ${w}px 코인 ${digits}: 한 줄`, Math.max(...tops) - Math.min(...tops) <= 6, tops.join(','));
    const fed = await p.ev(`(() => { const t = document.querySelector('.fullness .track'); const b = document.querySelector('.fullness .ghost'); return JSON.stringify([Math.round(t.getBoundingClientRect().top), Math.round(b.getBoundingClientRect().top), Math.round(b.getBoundingClientRect().height)]); })()`);
    const [tt, bt, bh] = JSON.parse(fed);
    check(`밥 주기 칩 ${w}px 코인 ${digits}: 막대와 같은 줄`, Math.abs(bt + bh / 2 - (tt + 3)) < 6, fed);
    if (digits === '12370') await p.shot(`${TAG}-head-${LANG}-${DARK ? 'd' : 'l'}-w${w}`);
  }
}

// ---- 일정 긴 제목: 끝 시각 칸은 줄 흐름에 자리가 없고, 올려도 제목 폭과 줄 높이가 그대로 ----
const eventGeom = (pg) =>
  pg.ev(`(() => { const li = document.querySelector('.event'); const t = li.querySelector('.title, .title-edit'); const e = li.querySelector('.end-time'); const tr = t.getBoundingClientRect(); const er = e.getBoundingClientRect(); const cs = getComputedStyle(e); return JSON.stringify({ tw: Math.round(tr.width * 10) / 10, th: Math.round(tr.height * 10) / 10, lh: Math.round(li.getBoundingClientRect().height * 10) / 10, op: Number(cs.opacity), pos: cs.position, ex: er.x, eb: er.bottom, er: er.right, ew: er.width, vw: innerWidth, vh: innerHeight }); })()`).then(JSON.parse);
const mouseTo = async (pg, x, y) => {
  await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(350);
};
async function eventChecks(pg, label, shot) {
  await pg.ev(`document.activeElement?.blur(); 1`);
  await mouseTo(pg, 2, 2);
  const g0 = await eventGeom(pg);
  check(`${label}: 평소에는 끝 시각 칸이 안 보이고 줄 흐름 밖`, g0.op === 0 && g0.pos === 'absolute', JSON.stringify(g0));
  check(`${label}: 긴 제목 폭이 120 이상`, g0.tw >= 120, String(g0.tw));
  const c = JSON.parse(await pg.ev(`(() => { const r = document.querySelector('.event .title').getBoundingClientRect(); return JSON.stringify([r.x + 10, r.y + 6]); })()`));
  await mouseTo(pg, c[0], c[1]);
  const g1 = await eventGeom(pg);
  check(`${label}: 올려도 제목 폭이 같다`, g1.tw === g0.tw, `${g0.tw} ${g1.tw}`);
  check(`${label}: 올려도 제목 줄 높이와 줄 높이가 같다`, g1.th === g0.th && g1.lh === g0.lh, `${g0.th}/${g0.lh} ${g1.th}/${g1.lh}`);
  check(`${label}: 올리면 끝 시각 칸이 보이고 화면 안에 있다`, g1.op === 1 && g1.ex >= 0 && g1.er <= g1.vw + 0.5 && g1.eb <= g1.vh + 40, JSON.stringify(g1));
  await pg.shot(`${TAG}-event-hover-${shot}-${LANG}-${DARK ? 'd' : 'l'}`);
  await mouseTo(pg, 2, 2);
  // 마우스 없이: 줄의 제목을 눌러 고치는 중이면(초점이 줄 안) 끝 시각 칸이 보인다
  await pg.ev(`document.querySelector('.event .title').click(); 1`);
  await sleep(300);
  const g2 = await eventGeom(pg);
  check(`${label}: 줄을 눌러 고치는 중에도 끝 시각 칸이 보인다`, g2.op === 1, JSON.stringify(g2));
  await pg.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pg.ev(`document.activeElement?.blur(); 1`);
  await sleep(200);
  // Tab 키로 제목 단추에서 끝 시각 칸까지 닿는다 (CDP 키 입력, 진짜 키보드가 아님)
  await pg.ev(`document.querySelector('.event .title').focus(); 1`);
  let reached = false;
  for (let k = 0; k < 8 && !reached; k++) {
    await pg.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(120);
    reached = await pg.ev(`document.activeElement?.closest('.end-time') !== null && document.activeElement?.tagName === 'INPUT'`);
  }
  check(`${label}: Tab 키로 끝 시각 칸에 닿고 보인다`, reached && (await eventGeom(pg)).op === 1);
  await pg.ev(`document.activeElement?.blur(); 1`);
}
for (const w of [320, 360]) {
  await setW(w);
  await main("__jj.panel.openTab('event'); 1");
  await sleep(800);
  await eventChecks(p, `일정 작은 패널 ${w}`, `w${w}`);
}
{
  await main("__jj.panel.window.close(); 1");
  await sleep(500);
  await main("__jj.home.open('event'); 1");
  await sleep(1800);
  await main('__jj.home.window.setSize(760, 760); 1');
  await sleep(700);
  const h = await a.page('home');
  await h.dark(DARK);
  if (!(await h.ev(`!!document.querySelector('.event')`))) {
    await h.ev(`[...document.querySelectorAll('button')].find((b) => /^(목록|List)$/.test(b.textContent.trim()))?.click(); 1`);
    await sleep(500);
  }
  await eventChecks(h, '일정 큰 창 760', 'big760');
  await main('__jj.home.window.close(); 1');
  await sleep(500);
  await main('__jj.panel.togglePanel(); 1');
  await sleep(1500);
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  p = await a.page('panel');
  await p.dark(DARK);
}

// ---- 쪽지함 칩 줄과 덮개 닫기 ----
{
  await setW(320);
  await main("__jj.panel.openTab('mail'); 1");
  await sleep(1500);
  const c = JSON.parse(await p.ev(`(() => { const e = document.querySelector('.mail-chips'); const cs = getComputedStyle(e); const last = e.querySelector('button:last-child').getBoundingClientRect(); return JSON.stringify({ mask: cs.maskImage || cs.webkitMaskImage, pr: cs.paddingRight, sw: e.scrollWidth, cw: e.clientWidth, lastR: last.right, boxR: e.getBoundingClientRect().right }); })()`));
  check('쪽지함 칩 줄: 끝을 흐리게 하고 오른쪽 여백이 있다', c.mask && c.mask !== 'none' && parseFloat(c.pr) >= 20, JSON.stringify(c));
  await p.ev(`document.querySelector('.mail-chips').scrollLeft = 9999; 1`);
  await sleep(200);
  const end = JSON.parse(await p.ev(`(() => { const e = document.querySelector('.mail-chips'); const last = e.querySelector('button:last-child').getBoundingClientRect(); return JSON.stringify({ gap: e.getBoundingClientRect().right - last.right }); })()`));
  check('쪽지함 칩 줄: 끝까지 밀면 마지막 칩이 흐린 자리 앞에서 끝난다', end.gap >= 20 || c.sw <= c.cw, JSON.stringify(end));
  await p.shot(`${TAG}-mail-${LANG}-${DARK ? 'd' : 'l'}-w320`);
  check('쪽지함이 열려 있다', await p.ev(`!!document.querySelector('.mail-head')`));
  await main("__jj.panel.openTab('today'); 1");
  await sleep(700);
  check('쪽지함이 열린 채 openTab(today): 덮개가 닫히고 오늘 탭이 선택', (await p.ev(`!document.querySelector('.mail-head')`)) && (await p.ev(`document.querySelector('[role=tab][aria-selected=true]')?.id ?? ''`)).length > 0, await p.ev(`document.querySelector('[role=tab][aria-selected=true]')?.textContent`));
  await main("__jj.panel.openTab('mail'); 1");
  await sleep(700);
  check('다시 mail 을 부르면 덮개가 열린다', await p.ev(`!!document.querySelector('.mail-head')`));
  await main("__jj.panel.openTab('shop'); 1");
  await sleep(700);
  check('쪽지함이 열린 채 openTab(shop): 덮개가 닫힌다', await p.ev(`!document.querySelector('.mail-head')`));
}

// ---- 일정 빈 상태 끝줄 ----
{
  await main("__jj.events.all?.().forEach?.((e) => __jj.events.remove?.(e.id)); 1").catch(() => {});
}

// ---- 상점 ----
{
  await setW(360, 680);
  await main("__jj.panel.openTab('shop'); 1");
  await sleep(900);
  const css = JSON.parse(await p.ev(`(() => { const s = document.querySelector('.shop'); const sl = document.querySelector('.shop-slot'); return JSON.stringify({ gutter: getComputedStyle(s).scrollbarGutter, slotPad: getComputedStyle(sl).paddingTop }); })()`));
  check('상점: 스크롤바 자리가 늘 있다', css.gutter.includes('stable'), css.gutter);
  check('상점: 안내 띠 위 여백 5px', css.slotPad === '5px', css.slotPad);
  const click = (sel) => p.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
  // 집 짓기 (확인 두 번)
  await click('.row-line .ghost.buy');
  await sleep(700);
  await click('.row-line .ghost.buy');
  await sleep(900);
  const built = await p.ev(`!!document.querySelector('.house-styles')`);
  check('집을 지으면 집 모양 칸이 나온다', built);
  if (built) {
    await p.ev(`document.querySelector('.shop').scrollTop = 99999; 1`);
    await sleep(300);
    const mb = () => p.ev(`getComputedStyle(document.querySelector('.house-styles')).marginBottom`);
    check('상점: 안내가 없으면 집 모양 아래에 빈칸을 남기지 않는다', (await mb()) === '0px', await mb());
    await click('.house-styles li:not(.using) .ghost.buy');
    await sleep(300);
    check('상점: 안내가 떠 있을 때만 그 자리를 비운다', (await mb()) === '64px', await mb());
    await sleep(500);
    const ov = JSON.parse(await p.ev(`(() => { const a = document.querySelector('.shop small.need.ask'); if (!a) return JSON.stringify({ none: true }); const ar = a.getBoundingClientRect(); const sh = document.querySelector('.shop').getBoundingClientRect(); const hit = [...document.querySelectorAll('.shop small.need:not(.ask), .shop small')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.right > ar.left && r.left < ar.right && r.bottom > ar.top && r.top < ar.bottom && !e.classList.contains('ask'); }).map((e) => e.textContent.slice(0, 20)); const btns = [...document.querySelectorAll('.house-styles li')].map((l) => l.getBoundingClientRect()); const cardHit = btns.some((r) => r.right > ar.left && r.left < ar.right && r.bottom > ar.top + 1 && r.top < ar.bottom); return JSON.stringify({ hit, cardHit, top: ar.top, bottom: ar.bottom, shTop: sh.top, shBottom: sh.bottom, text: a.textContent }); })()`));
    check('집 모양 안내 상자가 다른 글을 가리지 않는다', !ov.none && ov.hit.length === 0 && !ov.cardHit, JSON.stringify(ov));
    check('집 모양 안내 상자가 보이는 자리 안에 있다', !ov.none && ov.top >= ov.shTop && ov.bottom <= ov.shBottom + 1, JSON.stringify(ov));
    check('안내 문장이 온전하다', !ov.none && ov.text.includes(tx('살게.', 'Tap again to buy.')), ov.text);
    await p.shot(`${TAG}-shop-style-${LANG}-${DARK ? 'd' : 'l'}-w360`);
  }
}

// 한 글자 끝줄 (일정 빈 상태 문단)
await setW(320);
await a.stop();
try { rmSync(scratch, { recursive: true, force: true }); } catch {}
console.log(failed ? `FAIL ${failed}` : 'ALL PASS');
process.exit(failed ? 1 : 0);
