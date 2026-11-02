// 창 옮기기 자리(-webkit-app-region: drag) 위에 놓인 눌리는 요소가 0 인지: 패널(머리, 탭 줄, 단추 줄, 쪽지함 덮개), 빠른 입력, 큰 창, 설정, 채팅(AI 고르기 목록),
// 펫 만들기, 첫 안내 창, 그리고 창마다 공통 덮개 이름(role, -veil, -dim, -backdrop, -sheet, -menu, .sheet, .lightbox)을 끌기 자리 위에 덮어 본다.
// CDP 입력은 운영체제의 창 끌기 처리를 지나지 않으므로, 크롬이 끌기 자리를 정하는 규칙(문서 순서대로 drag 는 더하고 no-drag 는 빼기, z-index 무시)을
// 그대로 계산한다. 첫 클릭 받기(acceptFirstMouse)와 포커스는 창 옵션이라 여기서 못 본다(window-options.test.ts).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/drag-overlays.mjs
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 와 DOM 으로만, PATH 는 최소.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? join(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'drag-overlays'));
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
let total = 0;
const check = (name, ok, extra = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.drag-overlays-'));
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

/** 화면 안에서 끌기 자리에 먹히는 눌리는 요소 목록 (크롬 규칙). 투명하거나 가려진 것은 elementFromPoint 로 거른다 */
const SCAN = `(() => {
  const regions = [];
  for (const el of document.querySelectorAll('*')) {
    const v = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim();
    if (v !== 'drag' && v !== 'no-drag') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    regions.push({ drag: v === 'drag', l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  const dragAt = (x, y) => { let d = false; for (const g of regions) if (x >= g.l && x < g.r && y >= g.t && y < g.b) d = g.drag; return d; };
  const bad = [];
  let n = 0;
  const sel = 'button, input, select, textarea, a[href], [role="button"], [role="menuitem"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(sel)) {
    if (el.disabled || getComputedStyle(el).visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
    n++;
    for (const fx of [0.15, 0.5, 0.85]) {
      const x = r.left + r.width * fx;
      if (x < 0 || x >= innerWidth) continue;
      if (dragAt(x, cy)) { bad.push((el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase()); break; }
    }
  }
  return { n, bad };
})()`;
const scan = async (p, name) => {
  const r = await p.ev(SCAN);
  check(`${name}: 끌기 자리에 먹히는 눌리는 요소 0`, r.bad.length === 0 && r.n > 0, `눌리는 요소 ${r.n}개, 먹힘 ${r.bad.length}: ${[...new Set(r.bad)].slice(0, 10).join(' ')}`);
};

/** 공통 덮개 이름마다 창 전체를 덮는 가짜 덮개를 얹고(안에 단추와 입력칸을 머리줄 높이에), 끌기 자리에 먹히는지 본다 */
const KINDS = [
  { role: 'dialog' }, { role: 'alertdialog' }, { role: 'menu' }, { role: 'listbox' }, { cls: 'x-veil' }, { cls: 'x-dim' }, { cls: 'x-backdrop' },
  { cls: 'x-sheet' }, { cls: 'x-menu' }, { cls: 'sheet' }, { cls: 'lightbox' }, { aria: 'modal' },
];
async function synthetic(p, name, host = 'document.body') {
  const bad = [];
  for (const k of KINDS) {
    const r = await p.ev(`(() => {
      const host = ${host};
      const el = document.createElement('div');
      ${k.role ? `el.setAttribute('role', ${JSON.stringify(k.role)});` : ''}
      ${k.cls ? `el.className = ${JSON.stringify(k.cls)};` : ''}
      ${k.aria ? "el.setAttribute('aria-modal', 'true');" : ''}
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.2)';
      el.id = 'synthetic-cover';
      const b = document.createElement('button'); b.textContent = 'a'; b.style.cssText = 'position:absolute;left:12px;top:6px;width:80px;height:24px;z-index:1';
      const i = document.createElement('input'); i.style.cssText = 'position:absolute;left:100px;top:6px;width:80px;height:24px;z-index:1';
      const bm = document.createElement('button'); bm.textContent = 'b'; bm.style.cssText = 'position:absolute;left:12px;bottom:6px;width:80px;height:24px;z-index:1';
      el.append(b, i, bm); host.append(el);
      const out = ${SCAN};
      const mine = out.bad.length;
      el.remove();
      return mine;
    })()`);
    if (r !== 0) bad.push(k.role ?? k.cls ?? 'aria-modal');
  }
  check(`${name}: 공통 덮개 이름 ${KINDS.length}가지를 얹어도 끌기에 먹히지 않는다`, bad.length === 0, bad.join(' '));
}

// ---- 패널 (작은 창) ----
await cdp.main("__jj.panel.openTab('today'); 1");
await sleep(1800);
await cdp.main("__jj.panel.window?.removeAllListeners?.('blur'); 1");
let p = await cdp.page('panel');
for (const tab of ['today', 'todo', 'note', 'event', 'shop']) {
  await cdp.main(`__jj.panel.openTab('${tab}'); 1`);
  await sleep(500);
  await scan(p, `패널 ${tab} 탭 (머리 단추 핀, 봉투, 확대, 찾기, 코인, 탭 줄, 아래 단추 줄)`);
}
await synthetic(p, '패널', "document.querySelector('.surface')");
await p.ev(`document.querySelector('.mail-btn')?.click()`);
await sleep(600);
await scan(p, '패널 쪽지함 덮개');
await p.ev(`document.querySelector('.mail-close')?.click()`);
await sleep(300);
await cdp.main("__jj.panel.togglePanel(); 1");
await sleep(500);

// ---- 빠른 입력 ----
try {
  await cdp.main('__jj.panel.openQuick(); 1');
  await sleep(1200);
  const q = await cdp.page('quick');
  await scan(q, '빠른 입력');
} catch (e) { check('빠른 입력 창을 열었다', false, String(e)); }

// ---- 큰 창 ----
await cdp.main("__jj.home.open('todo'); 1");
await sleep(2000);
const h = await cdp.page('home');
await scan(h, '큰 창');
await synthetic(h, '큰 창');

// ---- 설정 ----
await cdp.main('__jj.settingsWindow.open(); 1');
await sleep(2000);
const st = await cdp.page('settings');
await scan(st, '설정');
await synthetic(st, '설정');

// ---- 채팅 (AI 고르기 목록 포함) ----
// 큰 창이 열려 있으면 채팅이 그 안(#embed, 끌기 없음)으로 들어가므로 큰 창을 닫고 따로 여는 채팅을 본다
await cdp.main('__jj.home.window?.close?.(); 1');
await sleep(800);
await cdp.main('__jj.chat.open(__jj.pet.bounds()); 1');
await sleep(2200);
const ch = await cdp.page('chat');
check('채팅은 따로 연 창이다 (embed 아님)', (await ch.ev('document.body.className')).includes('embed') === false);
await scan(ch, '채팅');
await ch.ev(`document.querySelector('.picker-button')?.click()`);
await sleep(500);
const menu = await ch.ev(`Boolean(document.querySelector('.picker-menu'))`);
check('채팅 AI 고르기 목록이 열렸다', menu);
if (menu) await scan(ch, '채팅 AI 고르기 목록 (열린 채)');
await synthetic(ch, '채팅');

// ---- 펫 만들기, 첫 안내 ----
await cdp.main('__jj.maker.open(); 1');
await sleep(2000);
await synthetic(await cdp.page('maker'), '펫 만들기');
await cdp.main('__jj.onboarding.open(); 1');
await sleep(2000);
await synthetic(await cdp.page('onboarding'), '첫 안내');

await stop();
console.log(failed ? `FAILED ${failed}/${total}` : `ALL PASS ${total}`);
process.exit(failed ? 1 : 0);
