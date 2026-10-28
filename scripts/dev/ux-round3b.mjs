// 앱 사용자 경험과 접근성 3차 B: 상점 한 번 더 확인, 모자란 코인 안내, 단추 이름표, 달력 탭 정지 하나(화살표 이동),
// 시트 닫을 때 포커스 복귀, 누르는 영역, 대비, 메모 저장됨, 움직임 줄이기(걷기 즉시).
// npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/ux-round3b.mjs
// 앱은 JJ_NO_FOCUS=1 (보이지 않고 입력을 뺏지 않는다). 입력은 CDP 로만 넣는다. 밝음과 어두움 둘 다 찍는다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';

const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const ko = lang === 'ko';
const scratch = mkdtempSync(join(tmpdir(), 'fairy-ux3b-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
process.env.OUT ??= join(scratch, 'out');
for (const d of [data, home, process.env.OUT]) mkdirSync(d, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, lang, osNotify: false, wander: true, pet3d: false, saverTold: true, chatter: 'quiet' }),
);
// 시험 포트는 9800~9999 중 비어 있는 것
async function port() {
  for (let i = 0; i < 50; i++) {
    const p = 9800 + Math.floor(Math.random() * 200);
    const s = createServer();
    const free = await new Promise((r) => {
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (free) return String(p);
  }
  throw new Error('빈 포트 없음');
}
process.env.JJ_INSPECT_PORT = await port();
process.env.JJ_PAGE_PORT = await port();
const fakeBin = join(scratch, 'bin');
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, 'claude'), `#!${process.execPath}\nprocess.exit(1)\n`, { mode: 0o755 });
const app = spawn(electron, [`--inspect=${process.env.JJ_INSPECT_PORT}`, '.', `--remote-debugging-port=${process.env.JJ_PAGE_PORT}`], {
  cwd: resolve(import.meta.dirname, '../..'),
  env: { ...process.env, HOME: home, PATH: `${fakeBin}:/usr/bin:/bin:${dirname(process.execPath)}`, SHELL: '/usr/bin/false', JJ_NO_FOCUS: '1', JJ_SHOW: '', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
app.stdout.on('data', (b) => { logs += b; });
app.stderr.on('data', (b) => { logs += b; });
const { main, page, sleep, disconnect } = await import('./cdp.mjs');
async function until(fn, label, n = 100) {
  for (let i = 0; i < n; i++) {
    try { if (await fn()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
const results = [];
function check(label, ok, detail = '') {
  results.push(ok);
  console.log(ok ? 'PASS' : 'FAIL', label, detail ? `(${detail})` : '');
}
const T = ko
  ? { sure: '한 번 더', need: '코인', full20: '지금은 20만 차', fullNow: '배불러서 지금은 못 줘', saved: '저장됨', corner: '왼쪽 아래 구석', giveCake: '케이크 주기, 코인 30개' }
  : { sure: 'Tap again', need: 'more coins', full20: 'Only 20 more fits now', fullNow: 'Too full to eat right now', saved: 'Saved', corner: 'bottom left corner', giveCake: 'Give Cake, 30 coins' };

// 대비 계산(밝기). 투명도(opacity)까지 곱해 겉으로 보이는 색으로 잰다
const CONTRAST = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); const p = m[1].split(/[ ,\\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mix = (top, bot, a) => ({ r: top.r * a + bot.r * (1 - a), g: top.g * a + bot.g * (1 - a), b: top.b * a + bot.b * (1 - a) });
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  window.__contrast = (el) => {
    const cs = getComputedStyle(el);
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const bg = bgOf(el); const fg = parse(cs.color);
    const eff = mix(fg, bg, fg.a * op);
    const [a, b] = [lum(eff), lum(bg)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  };
  return 1;
})()`;

let code = 0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  const open = async (tab) => {
    await main(`__jj.panel.openTab(${JSON.stringify(tab)}); 1`);
    const p = await page('panel');
    await until(() => p.ev('!!document.querySelector("#ptab-panel, main, .panel")'), '패널');
    await sleep(500);
    return p;
  };
  const key = (p, k, mods = 0) =>
    p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: { Escape: 27, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Tab: 9, Home: 36, End: 35 }[k], modifiers: mods })
      .then(() => p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: { Escape: 27, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Tab: 9, Home: 36, End: 35 }[k] }));

  // ---------- 상점 ----------
  let p = await open('shop');
  await p.ev(CONTRAST);
  await until(() => p.ev('!!document.querySelector(".shop .goods")'), '상점');
  const rows = async () => JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('.shop .goods li, .shop .row-line')].map((li) => ({ name: li.querySelector('.g-name, span')?.textContent ?? '', btn: li.querySelector('button.ghost')?.getAttribute('aria-label') ?? null, disabled: li.querySelector('button.ghost')?.disabled ?? null, need: li.querySelector('small.need')?.textContent ?? null })))`));
  // 코인 0: 이유가 글로 보이고, 값 숫자는 흐리지 않는다
  let r = await rows();
  console.log(JSON.stringify(r.slice(0, 3)));
  check('코인 0: 못 사는 줄마다 "코인 N개 더 필요" 글', r.slice(0, 4).every((x) => x.need && x.need.includes(ko ? '더 필요' : 'more coins')), r.map((x) => x.need).join(' | '));
  check('주기, 사기 단추 이름표에 항목과 값', r[1].btn?.includes(ko ? '간식 주기, 코인 12개' : 'Give Snack, 12 coins') === true, r[1].btn ?? '');
  const priceContrast = await p.ev('__contrast(document.querySelector(".shop .goods .price"))');
  const needContrast = await p.ev('__contrast(document.querySelector(".shop small.need"))');
  const disabledContrast = await p.ev('__contrast(document.querySelector(".shop .goods button.ghost:disabled"))');
  check('가격 숫자 대비 4.5 이상', priceContrast >= 4.5, String(priceContrast));
  check('"코인 N개 더 필요" 글 대비 4.5 이상', needContrast >= 4.5, String(needContrast));
  check('못 누르는 단추 글 대비 3 이상(실제 4.5 이상)', disabledContrast >= 4.5, String(disabledContrast));
  await p.shot(`shop-poor-${lang}-light`);
  await p.dark(true);
  await sleep(200);
  const darkNeed = await p.ev('[__contrast(document.querySelector(".shop small.need")), __contrast(document.querySelector(".shop .goods button.ghost:disabled")), __contrast(document.querySelector(".shop .goods .price"))]');
  check('어두운 화면 모자람 글, 못 누르는 단추, 가격 대비 4.5 이상', darkNeed.every((v) => v >= 4.5), JSON.stringify(darkNeed));
  await p.shot(`shop-poor-${lang}-dark`);
  await p.dark(false);

  // 코인 250: 집 짓기(200)는 한 번 더 눌러야 산다
  await main('__jj.store.reward(250, "test", Date.now()); __jj.panel.refresh(); 1');
  await until(async () => (await rows())[0].need === null || (await rows())[0].disabled === false, '코인 반영');
  await sleep(300);
  const houseBtn = `document.querySelectorAll('.shop section')[2].querySelector('.row-line button.ghost')`;
  check('집 짓기 단추 이름표에 값', (await p.ev(`${houseBtn}?.getAttribute('aria-label')`))?.includes('200') === true, await p.ev(`${houseBtn}?.getAttribute('aria-label')`));
  await p.ev(`${houseBtn}.focus(); ${houseBtn}.click(); 1`);
  await sleep(300);
  check('한 번 누르면 사지 않고 "한 번 더" 로 바뀜', (await p.ev(`${houseBtn}?.textContent`)) === T.sure && (await main('__jj.shop.state().houseLevel')) === 0, await p.ev(`${houseBtn}?.textContent`));
  const note = await p.ev(`document.querySelector('.shop small.ask')?.textContent ?? ''`);
  check('되돌릴 수 없다는 글이 보임', ko ? note.includes('되돌릴 수 없어') : note.includes("can't be undone"), note);
  await p.shot(`shop-confirm-${lang}-light`);
  await key(p, 'Escape');
  await sleep(300);
  check('Esc 로 확인이 풀림', (await p.ev(`${houseBtn}?.textContent`)) !== T.sure);
  await p.ev(`${houseBtn}.focus(); ${houseBtn}.click(); 1`);
  await sleep(200);
  await p.ev(`document.activeElement.blur(); 1`);
  await sleep(300);
  check('다른 곳으로 포커스가 가면 확인이 풀리고 안 삼', (await p.ev(`${houseBtn}?.textContent`)) !== T.sure && (await main('__jj.shop.state().houseLevel')) === 0);
  await p.ev(`${houseBtn}.focus(); ${houseBtn}.click(); 1`);
  await sleep(200);
  await p.ev(`${houseBtn}.click(); 1`);
  await until(async () => (await main('__jj.shop.state().houseLevel')) === 1, '집 지어짐');
  await sleep(300);
  const msg = await p.ev(`document.querySelector('.shop-msg')?.textContent ?? ''`);
  check('집을 지은 뒤 어디에 놓였는지 한 줄', msg.includes(T.corner), msg);
  await p.shot(`shop-built-${lang}-light`);
  // 올리기(500)는 코인 50 이라 못 삼: 이유가 글로 보임
  const up = await p.ev(`[...document.querySelectorAll('.shop .row-line')].map((x) => x.querySelector('small.need')?.textContent ?? '').join('|')`);
  check('올리기 500 은 코인 모자람 글이 보임', up.includes('4') || up.includes('45'), up);
  // 배부름: 케이크(100)는 지금은 일부만 찬다
  const hintRows = await p.ev(`JSON.stringify([...document.querySelectorAll('.shop .goods li')].slice(0, 3).map((li) => li.querySelector('small.need')?.textContent ?? ''))`);
  console.log('먹이 안내', hintRows);
  await main('__jj.store.reward(100, "test", Date.now()); __jj.panel.refresh(); 1');
  await sleep(500);
  const hint2 = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('.shop .goods li')].slice(0, 3).map((li) => li.querySelector('small.need')?.textContent ?? ''))`));
  check('배부름 높으면 "지금은 N만 차"', hint2[2].includes(ko ? '만 차' : 'more fits') || hint2[1].includes(ko ? '만 차' : 'more fits'), JSON.stringify(hint2));
  await main('for (let i = 0; i < 6; i++) __jj.store.feed(Date.now(), { cost: 0, gain: 20 }); __jj.panel.refresh(); 1');
  await sleep(700);
  const hint3 = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('.shop .goods li')].slice(0, 3).map((li) => [li.querySelector('small.need')?.textContent ?? '', li.querySelector('button.ghost').disabled]))`));
  check('배가 꽉 차면 안내와 함께 단추를 막음', hint3.every((x) => x[0] === T.fullNow && x[1]), JSON.stringify(hint3));
  await p.shot(`shop-full-${lang}-light`);

  // ---------- 오늘 탭: 달력 탭 정지, 터치 영역, 대비, 시작 이름 ----------
  p = await open('today');
  await p.ev(CONTRAST);
  await p.ev(`document.querySelector('details.focus-month').open = true; 1`);
  await sleep(500);
  const cells = JSON.parse(await p.ev(`JSON.stringify({ all: document.querySelectorAll('.fm-cell').length, stops: [...document.querySelectorAll('.fm-cell')].filter((c) => !c.disabled && c.tabIndex >= 0).length, zero: [...document.querySelectorAll('.fm-cell')].filter((c) => c.tabIndex === 0).map((c) => c.dataset.day) })`));
  check('집중 달력 탭 정지 1개', cells.stops === 1, `${cells.all}칸 중 정지 ${cells.stops} (전 28)`);
  // 진짜 Tab 키로 재 본다 (CDP 입력): 달력 위 단추에서 Tab 을 눌러 달력 안에 몇 번 멈추는지
  await p.ev(`document.querySelector('details.focus-month summary').focus(); 1`);
  let inGrid = 0;
  for (let i = 0; i < 40; i++) {
    await key(p, 'Tab');
    await sleep(30);
    if (await p.ev(`document.activeElement?.classList.contains('fm-cell')`)) inGrid++;
    if (await p.ev(`!document.querySelector('details.focus-month').contains(document.activeElement)`)) break;
  }
  check('Tab 으로 달력을 지나갈 때 멈춘 칸 수 1', inGrid === 1, `${inGrid}번 (전 28)`);
  await p.ev(`document.querySelector('.fm-cell[tabindex="0"]').focus(); 1`);
  const day0 = await p.ev('document.activeElement.dataset.day');
  await key(p, 'ArrowLeft');
  await sleep(100);
  const day1 = await p.ev('document.activeElement.dataset.day');
  await key(p, 'ArrowUp');
  await sleep(100);
  const day2 = await p.ev('document.activeElement.dataset.day');
  check('화살표로 날짜 이동(왼쪽 하루, 위 한 주)', day1 < day0 && day2 < day1, `${day0} ${day1} ${day2}`);
  await p.shot(`today-month-${lang}-light`);

  // 시작 이름
  const starts = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('.focus-card .primary, .next-go')].map((b) => [b.textContent.trim(), b.getAttribute('aria-label')]))`));
  console.log('시작 단추', JSON.stringify(starts));
  check('집중 시작 단추 이름 구분', new Set(starts.map((s) => s[1] ?? s[0])).size === starts.length, JSON.stringify(starts));

  // 누르는 영역: .link 와 답 단추의 겉보기 영역(::after 12px 더) 24 이상
  console.log('after', await p.ev(`(() => { const b = document.querySelector('button.link'); const a = getComputedStyle(b, '::after'); return JSON.stringify([getComputedStyle(b).position, a.content, a.position, a.top, a.height, a.pointerEvents]); })()`));
  const small = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('button.link')].filter((b) => b.offsetParent).map((b) => { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const af = getComputedStyle(b, '::after'); const eff = r.height + parseFloat(af.top === 'auto' ? '0' : af.top) * -2; const probe = document.elementFromPoint(r.left + r.width / 2, r.top - 5); window.__probe = probe?.tagName + '.' + probe?.className; return { p: window.__probe, t: b.textContent.trim().slice(0, 12), h: Math.round(r.height), effH: Math.round(r.height + 12), hit: probe === b }; }))`));
  console.log('링크 단추', JSON.stringify(small));
  check('오늘 탭 링크 단추 누르는 영역 24px 이상(둘레 6px)', small.length > 0 && small.every((x) => x.effH >= 24 && x.hit !== false), JSON.stringify(small.map((x) => `${x.t}:${x.effH}`)));

  // 대비: 여정 칸 번호
  const jd = await p.ev(`(() => { const l = [...document.querySelectorAll('.journey-dot.jd-later')]; return l.length ? Math.min(...l.map((x) => __contrast(x))) : null; })()`);
  console.log('여정 대비', jd);
  if (jd !== null) check('여정 칸 번호 대비 4.5 이상', jd >= 4.5, String(jd));

  // 아침 계획 시트: Esc 로 닫으면 연 단추로 포커스가 돌아온다
  const edit = `document.querySelector('.plan-card .link')`;
  if (await p.ev(`!!${edit}`)) {
    await p.ev(`${edit}.focus(); ${edit}.click(); 1`);
    await until(() => p.ev(`!!document.querySelector('.plan-sheet')`), '계획 시트');
    await key(p, 'Escape');
    await sleep(500);
    check('아침 계획 시트 Esc 뒤 포커스가 연 단추로', await p.ev(`document.activeElement === ${edit}`), await p.ev('document.activeElement?.className'));
  } else console.log('계획 카드 없음(시험 데이터에 없음), 건너뜀');
  await p.shot(`today-${lang}-light`);

  // ---------- 메모: 저장됨 ----------
  const nid = await main('__jj.notes.add ? 1 : 0').catch(() => 0);
  p = await open('note');
  await sleep(400);
  if (await p.ev(`!!document.querySelector('.note-editor')`) === false) {
    await p.ev(`document.querySelector('.note-new, button.primary')?.click(); 1`);
    await sleep(500);
  }
  if (await p.ev(`!!document.querySelector('.note-editor textarea')`)) {
    await p.ev(`document.querySelector('.note-editor textarea').focus(); 1`);
    await p.send('Input.insertText', { text: 'ux3b memo' });
    await sleep(1200);
    const saved = await p.ev(`document.querySelector('.note-saved')?.textContent ?? ''`);
    check('메모 자동 저장 뒤 "저장됨"', saved === T.saved, saved);
    await p.shot(`note-saved-${lang}-light`);
    await p.send('Input.insertText', { text: ' more' });
    await sleep(100);
    check('고치는 동안은 표시가 꺼짐', (await p.ev(`document.querySelector('.note-saved')?.textContent ?? ''`)) === '');
  } else console.log('메모 편집기를 못 열어 건너뜀');

  // ---------- 움직임 줄이기: 걷기 즉시 ----------
  await main('__jj.debugReducedMotion(true); 1');
  const b0 = JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));
  const t0 = Date.now();
  const ok = await main(`__jj.pet.walkTo(${b0.x + 120}).then((v) => v)`);
  const b1 = JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));
  check('동작 줄이기: 걷지 않고 바로 도착', ok === true && Date.now() - t0 < 700 && b1.x !== b0.x, `${b0.x} -> ${b1.x}, ${Date.now() - t0}ms`);
  // ---------- 채팅: 누르는 영역, 보내기 대비, 꼬리표 설명, 다시 묻기 이름 ----------
  await main(`__jj.chat.setHost?.(undefined); __jj.chat.open(__jj.pet.bounds()); 1`);
  const c = await page('chat');
  await until(() => c.ev(`!!document.querySelector('.composer')`), '채팅');
  await c.ev(CONTRAST);
  await main(`__jj.chat.debugSetState((s) => ({ ...s, messages: [
    { id: 'u1', role: 'user', text: 'q' },
    { id: 'a1', role: 'pet', text: 'hello there', provider: 'claude', status: 'done' },
    { id: 'u2', role: 'user', text: '오늘 뭐부터' },
    { id: 'a2', role: 'pet', text: '마감이 가까운 것부터', byRules: true, status: 'done' },
    { id: 'u3', role: 'user', text: 'again' },
    { id: 'a3', role: 'pet', text: '', provider: 'fairy-ticket', status: 'error', error: { kind: 'no-tickets', message: '채팅 이용권을 다 썼어.' } },
  ] })); 1`);
  await sleep(600);
  const chatSmall = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('.answer-actions button')].map((b) => { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const probe = document.elementFromPoint(r.left + r.width / 2, r.top - 5); return { t: b.textContent.trim(), effH: Math.round(r.height + 12), hit: probe === b }; }))`));
  check('채팅 복사, 메모로, 할 일로 누르는 영역 24px 이상', chatSmall.length >= 3 && chatSmall.every((x) => x.effH >= 24 && x.hit), JSON.stringify(chatSmall));
  const tag = await c.ev(`(() => { const t = [...document.querySelectorAll('.tag')].find((x) => x.getAttribute('title')); return t ? [t.getAttribute('title'), t.getAttribute('aria-label')] : null; })()`);
  check('"AI 없이" 꼬리표에 설명(title, aria)', !!tag && !!tag[0] && tag[0] === tag[1], JSON.stringify(tag));
  const retry = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('.retry button')].map((b) => b.textContent.trim()))`));
  console.log('다시 묻기 단추', JSON.stringify(retry));
  check('다시 묻기 단추 이름이 AI 별로 구분', retry.length >= 1 && new Set(retry).size === retry.length && retry[0] !== (ko ? '다시 묻기' : 'Ask again'), JSON.stringify(retry));
  await c.shot(`chat-${lang}-light`);
  await main(`__jj.chat.debugSetState((s) => ({ ...s, messages: [], ticket: undefined })); 1`);
  await sleep(300);
  await c.ev(`(() => { const ta = document.querySelector('.composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ''); ta.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await sleep(300);
  const sendC = await c.ev(`(() => { const b = document.querySelector('.composer .primary'); return b ? [b.disabled, __contrast(b)] : null; })()`);
  check('채팅 보내기(비활성) 대비 3 이상', !!sendC && sendC[0] === true && sendC[1] >= 4.5, JSON.stringify(sendC));
  await c.dark(true);
  await sleep(200);
  const sendD = await c.ev(`__contrast(document.querySelector('.composer .primary'))`);
  check('채팅 보내기(비활성) 어두운 화면 대비', sendD >= 3, String(sendD));
  await c.shot(`chat-${lang}-dark`);
  await c.dark(false);
  await main('__jj.chat.window?.close?.(); 1').catch(() => 0);

  // 한가할 때 행동 고르기: 동작 줄이기면 화면을 가로질러 걷는 행동(walk)이 한 번도 안 나온다
  const pet = await page('pet');
  await pet.ev(`window.__acts = []; window.jjakkung.onActivity((a) => window.__acts.push(a.type)); 1`);
  const ask = async (n) => {
    await pet.ev('window.__acts = []; 1');
    for (let i = 0; i < n; i++) {
      await pet.ev('window.jjakkung.activityRequest(); 1');
      await sleep(100);
    }
    return JSON.parse(await pet.ev('JSON.stringify(window.__acts)'));
  };
  const calmActs = await ask(80);
  check('동작 줄이기: 한가한 행동에 걷기가 없다', calmActs.length > 0 && !calmActs.includes('walk'), `${calmActs.length}번 행동 ${[...new Set(calmActs)].join(',')}`);
  await main('__jj.debugReducedMotion(false); 1');
  const freeActs = await ask(120);
  console.log(`끈 뒤 행동 ${freeActs.length}번: ${[...new Set(freeActs)].join(',')} (walk ${freeActs.filter((x) => x === 'walk').length})`);
} catch (err) {
  console.error('실패', err);
  code = 1;
} finally {
  disconnect();
  app.kill();
  await sleep(500);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
const fails = results.filter((x) => !x).length;
console.log(`${lang}: ${results.length - fails}/${results.length} 통과`);
if (fails || code) {
  console.log(logs.split('\n').slice(-20).join('\n'));
  process.exit(1);
}
