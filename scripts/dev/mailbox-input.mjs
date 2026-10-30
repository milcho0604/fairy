// 작은 패널 쪽지함 입력 (0.6.10 사용자 버그: 찾기 칸 타자, 칩과 쪽지 줄 눌림이 잘 안 됨).
// 원인: 패널 머리, 탭 줄, 아래 단추 줄은 -webkit-app-region: drag (창 옮기기 자리). 이 자리는 쌓임(z-index)과 무관하게 위에 덮인 요소의
// 마우스 입력을 창 끌기로 가져간다. 쪽지함 덮개가 그 위를 덮으니 덮개 위쪽(머리, 찾기, 칩)이 눌리지 않는다.
// 덮개와 안의 요소는 no-drag 여야 한다. CDP 입력은 이 창 끌기 처리를 지나지 않으니(렌더러에 바로 들어감) 크롬이 끌기 자리를 정하는 규칙
// (문서 순서대로 drag 는 더하고 no-drag 는 뺀다, z-index 무시)을 그대로 계산해 쪽지함 안 누를 자리마다 끌기 자리인지 잰다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/mailbox-input.mjs
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만, 진짜 AI 가 잡히지 않게 PATH 는 최소.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? join(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'mailbox-input'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.mailbox-input-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: 'Kongi', chatter: 'quiet', dailyNotes: true }));
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
const stop = async () => {
  cdp.disconnect();
  try { app.kill('SIGTERM'); } catch {}
  await sleep(900);
  try { app.kill('SIGKILL'); } catch {}
  rmSync(scratch, { recursive: true, force: true });
};
process.on('uncaughtException', async (e) => { console.log(String(e)); await stop(); process.exit(1); });

for (let i = 0; i < 120; i++) {
  try { if ((await cdp.main('typeof __jj')) === 'object') break; } catch {}
  await sleep(250);
}

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const noonOf = (ms) => { const d = new Date(ms); d.setHours(12, 0, 0, 0); return d.getTime(); };
const NOW = Date.now();
const lines3 = (v) => [{ key: 'note.open', vars: { p: 'friend', name: '콩', v } }, { key: 'note.yesterday', vars: { p: 'friend', n: 3 } }, { key: 'note.close', vars: { p: 'friend', v } }];
const local = (id, daysAgo, over = {}) => ({ id, source: 'local', kind: 'daily', day: dayOf(NOW - daysAgo * DAY), at: noonOf(NOW - daysAgo * DAY), look: 'note', milestone: null, coins: null, payload: { lines: lines3(1 + (daysAgo % 8)) }, readAt: null, ...over });
const srv = (id, kind, over = {}) => ({ id: `inbox:${id}`, source: 'server', kind, day: dayOf(NOW - (id % 5) * DAY), at: noonOf(NOW - (id % 5) * DAY), look: 'note', milestone: null, coins: null, payload: { id, kind, sender: null, message: `${kind} ${id}\n본문`, coins: 0, chatPasses: 0, fillTo: null, sentAt: new Date(NOW - id * DAY).toISOString(), expiresAt: null, openedAt: null, opened: null, expired: false, ...over }, readAt: null });
const rows = [];
for (let i = 0; i < 9; i++) rows.push(local(`l${i}`, i, { kind: 'letter', look: 'letter', milestone: 7 + i }));
for (let i = 0; i < 6; i++) rows.push(local(`d${i}`, 10 + i));
for (let i = 1; i <= 4; i++) rows.push(srv(i, 'notice'), srv(10 + i, 'grant', { coins: 5 }), srv(20 + i, 'gift'));
await cdp.main(`(() => { for (const r of ${JSON.stringify(rows)}) __jj.mail.put(r); __jj.dailyNotes.changed(); return 1; })()`);

await cdp.main("__jj.panel.openTab('mail'); 1");
await sleep(1800);
await cdp.main("__jj.panel.window?.removeAllListeners?.('blur'); 1");
const p = await cdp.page('panel');
await sleep(500);
const size = await p.ev('({ w: innerWidth, h: innerHeight })');
console.log('panel', JSON.stringify(size));

// 누를 자리 모음: 덮개 안의 눌리는 것(닫기, 모두 읽음, 찾기, 칩, 쪽지 줄, 더 보기)
const targets = await p.ev(`(() => {
  const sheet = document.querySelector('.mail-sheet');
  if (!sheet) return null;
  const sel = '.mail-close, .mail-readall, .mail-search, .mail-chips button, .mail-row, .mail-more';
  return [...sheet.querySelectorAll(sel)].map((el, i) => {
    el.dataset.t = String(i);
    const r = el.getBoundingClientRect();
    return { i, cls: el.className.split(' ').filter((c) => c.startsWith('mail-')).join('.') || el.className, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), vis: r.width > 0 && r.height > 0 };
  });
})()`);
check('쪽지함 덮개가 열려 있다', Boolean(targets) && targets.length > 10, `${targets?.length}개`);

// 1) 맨 위 요소: 누른 자리의 가장 위 요소가 그 요소(또는 안쪽)인가
const topBad = await p.ev(`(() => {
  const bad = [];
  for (const t of ${JSON.stringify(targets)}) {
    const el = document.querySelector('[data-t="' + t.i + '"]');
    const r = el.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0 || r.right > innerWidth || r.left < 0) continue;
    const top = document.elementFromPoint(t.x, t.y);
    if (!top || !(el === top || el.contains(top))) bad.push(t.cls + '@' + t.x + ',' + t.y + ' -> ' + (top?.className || top?.tagName));
  }
  return bad;
})()`);
check('누른 자리 맨 위 요소가 쪽지함 요소다 (elementFromPoint)', topBad.length === 0, topBad.join(' | '));

// 2) 창 끌기 자리: 크롬 규칙(문서 순서대로 drag 더하고 no-drag 빼기, z-index 무시)으로 눌리는 요소 가운데가 끌기 자리인가
const dragBad = await p.ev(`(() => {
  const regions = [];
  for (const el of document.querySelectorAll('*')) {
    const v = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim();
    if (v !== 'drag' && v !== 'no-drag') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    regions.push({ drag: v === 'drag', l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  const dragAt = (x, y) => {
    let d = false;
    for (const g of regions) if (x >= g.l && x < g.r && y >= g.t && y < g.b) d = g.drag;
    return d;
  };
  const bad = [];
  for (const t of ${JSON.stringify(targets)}) {
    const el = document.querySelector('[data-t="' + t.i + '"]');
    const r = el.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0 || r.right > innerWidth || r.left < 0) continue;
    // 요소 안 세 자리(왼쪽, 가운데, 오른쪽)
    for (const fx of [0.15, 0.5, 0.85]) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height / 2;
      if (dragAt(x, y)) { bad.push(t.cls + '@' + Math.round(x) + ',' + Math.round(y)); break; }
    }
  }
  return bad;
})()`);
check('눌리는 요소가 창 끌기 자리에 놓이지 않는다 (크롬 끌기 자리 규칙)', dragBad.length === 0, `${dragBad.length}개 끌기에 먹힘: ${dragBad.slice(0, 8).join(' ')}`);

// 3) CDP 진짜 입력 경로: 찾기 칸 누르고 타자, 칩 누름, 쪽지 줄 누름
const click = async (x, y) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(150);
};
const find = (cls) => targets.find((t) => t.cls === cls);
const s = find('mail-search');
await click(s.x, s.y);
await p.send('Input.insertText', { text: 'ab' });
await sleep(200);
const val = await p.ev(`document.querySelector('.mail-search').value`);
check('찾기 칸에 글자가 들어간다 (CDP 누름 + insertText)', val === 'ab', `값 ${JSON.stringify(val)}`);
await p.ev(`(() => { const e = document.querySelector('.mail-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
const chips = targets.filter((t) => t.cls === 'mail-chips' || false);
const chipEls = await p.ev(`[...document.querySelectorAll('.mail-chips button')].map((b, i) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), t: b.textContent }; })`);
await click(chipEls[1].x, chipEls[1].y);
const pressed = await p.ev(`document.querySelectorAll('.mail-chips button[aria-pressed="true"]')[0]?.textContent`);
check('칩이 눌린다 (두 번째 칩)', pressed === chipEls[1].t, pressed);
await click(chipEls[0].x, chipEls[0].y);
const row = await p.ev(`(() => { const b = document.querySelector('.mail-row'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await click(row.x, row.y);
const detail = await p.ev(`!document.querySelector('.mail-detail-pane').hidden`);
check('쪽지 줄이 눌려 내용 화면이 열린다', detail);

// 4) 입력칸이 다시 그려져도 포커스를 안 잃는다 (매 초 새로 고침 흉내: 쪽지 목록 바뀜)
await p.ev(`document.querySelector('.mail-back')?.click()`);
await sleep(200);
await click(s.x, s.y);
const keyBefore = await p.ev(`(document.querySelector('.mail-search').dataset.k = 'same', 1)`);
await cdp.main(`(() => { __jj.mail.put(${JSON.stringify(local('lx', 3))}); __jj.dailyNotes.changed(); return 1; })()`);
await sleep(600);
await p.send('Input.insertText', { text: 'z' });
const after = await p.ev(`({ same: document.querySelector('.mail-search').dataset.k === 'same', focus: document.activeElement === document.querySelector('.mail-search'), v: document.querySelector('.mail-search').value })`);
check('목록이 바뀌어도 찾기 칸은 그대로고 포커스가 남는다', after.same && after.focus && after.v === 'z', JSON.stringify(after));

await p.shot(`mailbox-input-${LANG}`);
await stop();
console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
process.exit(failed ? 1 : 0);
