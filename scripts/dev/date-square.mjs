// 달력 날짜 숫자 칸(.cal-num)이 모든 날짜에서 같은 크기 정사각형이고 숫자가 가운데인지 잰다 (패널 좁은/넓은 폭, 큰 창, ko/en, 밝음/어두움).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en DARK=1 TAG=before|after node scripts/dev/date-square.mjs
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 와 DOM 으로만. 포트는 JJ_PORT_BASE(기본 9800) 부터 두 개.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? join(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'date-square'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const DARK = Boolean(process.env.DARK);
const TAG = process.env.TAG ?? 'after';
const BASE = Number(process.env.JJ_PORT_BASE ?? 9800);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
process.env.OUT = OUT;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}${DARK ? ' dark' : ''}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.date-square-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: 'Kongi', chatter: 'quiet' }));

process.env.JJ_INSPECT_PORT = String(BASE);
process.env.JJ_PAGE_PORT = String(BASE + 1);
const app = spawn(electronPath, [`--inspect=${BASE}`, '.', `--remote-debugging-port=${BASE + 1}`], {
  cwd: root,
  env: { HOME: home, SHELL: '/usr/bin/false', PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
  stdio: 'ignore',
});
const cdp = await import(`./cdp.mjs?${BASE}`);
const { main } = cdp;
const cleanup = async () => {
  cdp.disconnect();
  try { app.kill('SIGTERM'); } catch {}
  await sleep(900);
  try { app.kill('SIGKILL'); } catch {}
  rmSync(scratch, { recursive: true, force: true });
};
process.on('uncaughtException', async (e) => { console.log(String(e)); await cleanup(); process.exit(1); });
for (let i = 0; i < 120; i++) {
  try { if ((await main('typeof __jj')) === 'object') break; } catch {}
  await sleep(250);
}

// 한 자리, 두 자리 날이 섞이도록 이번 달 여러 날에 일정을 넣는다
const nowD = new Date();
for (const d of [1, 5, 9, 10, 15, 22, 28]) {
  const at = new Date(nowD.getFullYear(), nowD.getMonth(), d, 14, 0, 0).getTime();
  await main(`__jj.events.add({ title: 'e${d}', startAt: ${at}, reminds: [] }, ${Date.now()}); 1`);
}
// 칸이 넘치는지 보는 달(2026-08 은 6주): 12일 7개, 1일 3개, 31일 1개
for (const [d, n] of [[12, 7], [1, 3], [31, 1]]) {
  for (let i = 0; i < n; i++) {
    const at = new Date(2026, 7, d, 8 + i, 0, 0).getTime();
    await main(`__jj.events.add({ title: 'overflow ${d}-${i}', startAt: ${at}, reminds: [] }, ${Date.now()}); 1`);
  }
}
await main('__jj.panel.togglePanel(); 1');
await sleep(1800);
await main("__jj.panel.window.removeAllListeners('blur'); 1");
const p = await cdp.page('panel');
await p.dark(DARK);
await p.ev(`localStorage.setItem('jj.panel.eventView', 'calendar'); 1`);

const measure = (pg) => pg.ev(`JSON.stringify([...document.querySelectorAll('.cal-num')].map((e) => { const r = e.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(e); const t = range.getBoundingClientRect(); return { n: e.textContent, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, dx: Math.round(Math.abs(t.x + t.width / 2 - (r.x + r.width / 2)) * 10) / 10, dy: Math.round(Math.abs(t.y + t.height / 2 - (r.y + r.height / 2)) * 10) / 10 }; }))`).then(JSON.parse);
async function checks(pg, label, shot) {
  const m = await measure(pg);
  const sizes = new Set(m.map((x) => `${x.w}x${x.h}`));
  check(`${label}: 날짜 칸 ${m.length}개가 모두 폭=높이`, m.length >= 7 && m.every((x) => Math.abs(x.w - x.h) < 0.6), [...sizes].join(' '));
  check(`${label}: 날짜 칸 크기가 전부 같다`, sizes.size === 1, [...sizes].join(' '));
  check(`${label}: 숫자가 칸 가운데 (가로 1px, 세로 2px 안)`, m.every((x) => x.dx <= 1 && x.dy <= 2), JSON.stringify(m.filter((x) => x.dx > 1 || x.dy > 2).slice(0, 3)));
  if (await pg.ev(`document.querySelector('.cal.month') !== null`)) {
    const c = await pg.ev(`JSON.stringify([...document.querySelectorAll('.cal-cell button')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }))`).then(JSON.parse);
    const cs = new Set(c.map((x) => `${x.w}x${x.h}`));
    check(`${label}: 월 보기 날짜 칸 ${c.length}개가 모두 폭=높이`, c.length >= 28 && c.every((x) => Math.abs(x.w - x.h) < 1), [...cs].slice(0, 3).join(' '));
    check(`${label}: 월 보기 칸 한 변이 120px 을 넘지 않는다`, c.every((x) => x.w <= 120), String(Math.max(...c.map((x) => x.w))));
    // 숫자 칩과 일정 줄이 같은 왼쪽 선 (좁은 칸은 줄 대신 점이라 줄이 있는 칸만)
    const lefts = await pg.ev(`JSON.stringify([...document.querySelectorAll('.cal-cell button')].map((b) => { const n = b.querySelector('.cal-num'); const l = b.querySelector('.cal-line'); if (!l || !l.offsetParent) return null; return Math.round(Math.abs(n.getBoundingClientRect().left - l.getBoundingClientRect().left) * 10) / 10; }).filter((x) => x !== null))`).then(JSON.parse);
    const narrow = await pg.ev(`getComputedStyle(document.querySelector('.cal-lines')).display === 'none'`);
    check(`${label}: 숫자와 일정 줄이 같은 왼쪽 선`, narrow || (lefts.length > 0 && lefts.every((x) => x <= 1)), JSON.stringify(lefts));
  }
  await pg.shot(`${TAG}-${shot}-${LANG}-${DARK ? 'd' : 'l'}`);
}
/** 일정 있는 칸이 넘치지 않고, 줄이 잘렸으면 +N, 점 모드면 점이 보인다. 패널이면 한 달(그리드)이 보이는 칸 안에 들어온다 */
async function overflowScan(pg, label, shot, inPanel) {
  const r = await pg.ev(`JSON.stringify((() => {
    const bad = [];
    let withItems = 0;
    for (const b of document.querySelectorAll('.cal-cell button')) {
      const d = b.closest('td').dataset.day;
      const dot = b.querySelector('.cal-dot');
      const lines = b.querySelector('.cal-lines');
      const dotMode = getComputedStyle(lines).display === 'none';
      const hasItems = !!dot;
      if (!hasItems) continue;
      withItems++;
      const br = b.getBoundingClientRect();
      if (b.scrollHeight > b.clientHeight + 1) bad.push(d + ' 넘침 ' + b.scrollHeight + '/' + b.clientHeight);
      if (dotMode) { if (getComputedStyle(dot).display === 'none') bad.push(d + ' 점 없음'); continue; }
      const all = lines.querySelectorAll('.cal-line, .cal-more');
      for (const e of all) { const er = e.getBoundingClientRect(); if (er.bottom > br.bottom - 1 || er.right > br.right + 0.5) bad.push(d + ' 줄 잘림'); }
      const n = Number(b.getAttribute('aria-label').match(/(\\d+)\\s*(개|item|event)/i)?.[1] ?? 0);
    }
    const g = document.querySelector('.cal-grid');
    const sc = document.querySelector('.cal-scroll');
    const gr = g.getBoundingClientRect();
    const fit = sc ? gr.bottom <= sc.getBoundingClientRect().bottom + 0.5 : true;
    const cell = document.querySelector('.cal-cell button').getBoundingClientRect();
    const bar = document.querySelector('.cal-bar').getBoundingClientRect();
    return { bad, withItems, fit, rows: g.querySelectorAll('tbody tr').length, side: Math.round(cell.width), gl: Math.round(gr.left), gr: Math.round(gr.right), bl: Math.round(bar.left), br: Math.round(bar.right) };
  })())`).then(JSON.parse);
  if (r.withItems < 3) console.log('title', await pg.ev(`document.querySelector('.cal-title')?.textContent`));
  check(`${label}: 일정 칸 ${r.withItems}개가 넘치지 않고 +N 이나 점이 보인다`, r.withItems >= 3 && r.bad.length === 0, r.bad.slice(0, 3).join(', ') + ' 칸 ' + r.side);
  if (inPanel) check(`${label}: 패널에서 한 달(${r.rows}주)이 스크롤 없이 보인다`, r.fit, `칸 ${r.side}`);
  check(`${label}: 제목줄이 달력과 같은 왼쪽 선, 달력 폭 안`, Math.abs(r.bl - r.gl) <= 1 && r.br <= r.gr + 1, `달력 ${r.gl}-${r.gr} 제목줄 ${r.bl}-${r.br}`);
  if (shot) await pg.shot(`${TAG}-${shot}-${LANG}-${DARK ? 'd' : 'l'}`);
}
const toAug = async (pg) => {
  const here = () => pg.ev(`!!document.querySelector('.cal-grid td[data-day="2026-08-12"]:not(.out)')`);
  for (const [k, n] of [[0, 14], [1, 28]]) {
    for (let i = 0; i < n && !(await here()); i++) {
      await pg.ev(`document.querySelectorAll('.cal-bar .cal-nav')[${k}].click(); 1`);
      await sleep(250);
    }
    if (await here()) break;
  }
  await sleep(400);
};
const setW = async (w, h = 700) => {
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: ${h} }); 1`);
  await sleep(600);
};
for (const w of [320, 560, 900]) {
  await setW(w);
  await main("__jj.panel.openTab('event'); 1");
  await sleep(900);
  if (!(await p.ev(`!!document.querySelector('.cal-grid')`))) {
    await p.ev(`[...document.querySelectorAll('button')].find((b) => /^(달력|Calendar)$/.test(b.textContent.trim()))?.click(); 1`);
    await sleep(600);
  }
  await checks(p, `패널 ${w}px 월`, `panel-w${w}-month`);
  await p.ev(`[...document.querySelectorAll('.cal-mode button, .cal-mode label, .cal-mode input')].find((b) => /week|주/i.test(b.textContent + (b.value ?? '')))?.click(); 1`);
  await sleep(500);
  if (await p.ev(`document.querySelector('.cal.week') !== null`)) await checks(p, `패널 ${w}px 주`, `panel-w${w}-week`);
  await p.ev(`[...document.querySelectorAll('.cal-mode button, .cal-mode label, .cal-mode input')].find((b) => /month|월/i.test(b.textContent + (b.value ?? '')))?.click(); 1`);
  await sleep(400);
}
// ---- 넘침 훑기: 패널 폭 300~859, 높이 700 ----
await main("__jj.panel.openTab('event'); 1");
await setW(400);
await toAug(p);
for (const w of [300, 320, 340, 360, 380, 399, 400, 480, 560, 700, 859]) {
  await setW(w);
  await overflowScan(p, `넘침 패널 ${w}px 8월`, [320, 360, 400, 700].includes(w) ? `over-panel-w${w}` : '', true);
}
await main('__jj.panel.window.close(); 1');
await sleep(500);
await main("__jj.home.open('event'); 1");
await sleep(1800);
await main('__jj.home.window.setSize(900, 760); 1');
await sleep(700);
const h = await cdp.page('home');
await h.dark(DARK);
await h.ev(`localStorage.setItem('jj.panel.eventView', 'calendar'); 1`);
if (!(await h.ev(`!!document.querySelector('.cal-grid')`))) {
  await h.ev(`[...document.querySelectorAll('button')].find((b) => /^(달력|Calendar)$/.test(b.textContent.trim()))?.click(); 1`);
  await sleep(700);
}
await checks(h, '큰 창 900', 'home-w900');
await main('__jj.home.window.setSize(1400, 900); 1');
await sleep(800);
await checks(h, '큰 창 1400', 'home-w1400');
await toAug(h);
for (const [w, hh] of [[860, 700], [1100, 800], [1400, 900], [2400, 1000], [3000, 700]]) {
  await main(`__jj.home.window.setSize(${w}, ${hh}); 1`);
  await sleep(800);
  await overflowScan(h, `넘침 큰 창 ${w}x${hh} 8월`, [1100, 2400].includes(w) ? `over-home-${w}` : '', false);
}
await cleanup();
console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
process.exit(failed ? 1 : 0);
