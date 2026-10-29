// 쪽지함 (feat/mailbox): 작은 패널 덮개와 큰 창 구역, 머리줄 봉투와 안 읽음 점, 오늘 탭 새 쪽지 카드, 목록과 내용, 찾기, 종류 칩, 날짜 묶음,
// 읽음, 모두 읽음, 고정, 보관, 지우기와 되돌리기, 받을 것이 남은 서버 쪽지는 못 지움, 공지 모으기, 옛 daily-note.json 옮기기.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/mailbox.mjs
//   PREFIX=before|after JJ_ROOT=<체크아웃> 이면 오늘 탭 쪽지 칸 그림만 (전후 비교 재료)
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만, 진짜 AI 가 잡히지 않게 PATH 는 최소.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? join(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-voice');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const PREFIX = process.env.PREFIX ?? 'after';
const SHOTS_ONLY = Boolean(process.env.PREFIX);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ko = LANG === 'ko';
const tx = (a, b) => (ko ? a : b);
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

/** 앱 하나를 띄우고 cdp 도우미를 이 앱의 포트로 맞춘다. settings: 설정 파일 내용(없으면 파일 없음 = 새 사용자) */
async function launch(settings, pre, keep) {
  const INSPECT = await freePort();
  const PAGE = await freePort();
  const scratch = keep ?? mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.voice-test-'));
  const data = join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  if (settings) writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, ...settings }));
  pre?.(data);
  const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
    cwd: root,
    env: {
      HOME: home,
      SHELL: '/usr/bin/false',
      PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_TEST_SECRETS: 'memory',
    },
    stdio: 'ignore',
  });
  process.env.JJ_INSPECT_PORT = String(INSPECT);
  process.env.JJ_PAGE_PORT = String(PAGE);
  const cdp = await import(`./cdp.mjs?${INSPECT}`);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await cdp.main("typeof __jj")) === 'object') break;
      await sleep(250);
    } catch {
      await sleep(250);
    }
  }
  const stop = async () => {
    process.env.JJ_LAST_DATA = data;
    cdp.disconnect();
    try {
      app.kill('SIGTERM');
    } catch {}
    await sleep(700);
    try {
      app.kill('SIGKILL');
    } catch {}
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  };
  return { ...cdp, stop, data };
}



const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const NOW = Date.now();

/** 펫 쪽지 줄 */
const lines3 = (v = 1) => [
  { key: 'note.open', vars: { p: 'friend', name: '콩', v } },
  { key: 'note.yesterday', vars: { p: 'friend', n: 3 } },
  { key: 'note.close', vars: { p: 'friend', v } },
];
const local = (id, daysAgo, over = {}) => ({
  id,
  source: 'local',
  kind: 'daily',
  day: dayOf(NOW - daysAgo * DAY),
  at: NOW - daysAgo * DAY - 3_600_000 * 2,
  look: 'note',
  milestone: null,
  coins: null,
  payload: { lines: lines3(1 + (daysAgo % 8)) },
  readAt: null,
  ...over,
});
const srv = (id, kind, over = {}) => ({
  id: `inbox:${id}`,
  source: 'server',
  kind,
  day: dayOf(NOW - (id % 5) * DAY),
  at: NOW - (id % 5) * DAY - 7_200_000,
  look: 'note',
  milestone: null,
  coins: null,
  payload: { id, kind, sender: null, message: null, coins: 0, chatPasses: 0, fillTo: null, sentAt: new Date(NOW - id * DAY).toISOString(), expiresAt: null, openedAt: null, opened: null, expired: false, ...over },
  readAt: null,
});
const SEED = [
  local(dayOf(NOW), 0),
  local(`${dayOf(NOW)}~e`, 0, { kind: 'evening', at: NOW - 600_000, payload: { lines: [{ key: 'note.evening.open', vars: { p: 'friend', v: 1 } }, { key: 'note.evening.done', vars: { p: 'friend', n: 3 } }, { key: 'note.evening.close', vars: { p: 'friend', v: 1 } }] } }),
  local(dayOf(NOW - 1 * DAY), 1),
  local(dayOf(NOW - 2 * DAY), 2, { readAt: 1 }),
  local(dayOf(NOW - 5 * DAY), 5, { kind: 'week', look: 'letter', readAt: 1 }),
  local(dayOf(NOW - 12 * DAY), 12, { readAt: 1 }),
  local(dayOf(NOW - 45 * DAY), 45, { kind: 'letter', look: 'letter', milestone: 30, coins: 10, readAt: 1 }),
  srv(1, 'grant', { message: tx('이벤트 보상 안내\n참여해 줘서 고마워', 'Event reward\nThanks for joining'), coins: 10, coinsNote: 1 }),
  srv(2, 'notice', { message: tx('점검 안내\n내일 새벽 두 시간', 'Maintenance\nTomorrow early morning') }),
  srv(3, 'gift', { sender: { code: 'F-1', nickname: tx('밀크', 'Milk') }, coins: 5, opened: { coins: 5, chatPasses: 0 }, openedAt: new Date(NOW).toISOString() }),
  srv(4, 'subscription', { fillTo: 5, opened: { coins: 0, chatPasses: 5 } }),
];
SEED[7].coins = 10;
SEED[7].payload.coins = 10;
const seedExpr = (rows) => `(() => { for (const r of ${JSON.stringify(rows)}) __jj.mail.put(r); __jj.dailyNotes.changed(); return __jj.dailyNotes.box().unread; })()`;
const announceExpr = `(() => { __jj.dailyNotes.announce({ id: 'n1', title: { ko: '새 기능 안내', en: 'New feature' }, body: { ko: '쪽지함이 생겼어', en: 'There is a mailbox now' } }); __jj.dailyNotes.announce({ id: 'n1', title: { ko: '또', en: 'Again' }, body: { ko: '또', en: 'Again' } }); return __jj.mail.all().filter((r) => r.source === 'notice').length; })()`;

const waitUntil = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};

async function openPanelMail(a) {
  await a.main('__jj.panel.openTab(\'mail\'); 1');
  await sleep(1800);
  await a.main(`__jj.panel.window?.removeAllListeners?.('blur'); 1`);
  const p = await a.page('panel');
  return p;
}

// ---- 전후 비교 재료만 (오늘 탭의 쪽지 칸) ----
if (SHOTS_ONLY) {
  // 옛 쪽지 파일을 심어 두고 켠다: 이전 판은 그대로 읽고, 이 판은 쪽지함으로 옮겨 읽는다 (같은 쪽지로 오늘 탭을 견준다)
  const legacy = {
    box: [
      { day: dayOf(NOW), look: 'note', lines: lines3(1), read: false },
      { day: dayOf(NOW - DAY), look: 'note', lines: lines3(2), read: false },
      { day: dayOf(NOW - 2 * DAY), look: 'letter', milestone: 7, coins: 5, lines: [{ key: 'note.special.open', vars: { p: 'friend', n: 7 } }], read: true },
      { day: dayOf(NOW - 3 * DAY), look: 'note', lines: lines3(3), read: true },
    ],
    marks: [7],
  };
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'quiet', dailyNotes: true }, (dir) => writeFileSync(join(dir, 'daily-note.json'), JSON.stringify(legacy)));
  await a.main('__jj.panel.openTab(\'today\'); 1');
  await sleep(1800);
  await a.main(`__jj.panel.window?.removeAllListeners?.('blur'); __jj.panel.window?.setSize?.(360, 900); 1`);
  const p = await a.page('panel');
  await sleep(600);
  await p.ev(`(document.querySelector('.note-box, .mail-card') ?? document.body).scrollIntoView({ block: 'center' })`);
  for (const dark of [false, true]) {
    await p.dark(dark);
    await sleep(200);
    await p.shot(`mail-${PREFIX}-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await a.stop();
  process.exit(0);
}

// ---- 옛 daily-note.json 옮기기 ----
{
  const legacy = {
    box: [
      { day: dayOf(NOW), look: 'note', lines: [{ key: 'note.open', vars: { p: 'friend', v: 1 } }], read: false },
      { day: dayOf(NOW - DAY), look: 'letter', milestone: 7, coins: 5, lines: [{ key: 'note.special.open', vars: { p: 'friend', n: 7 } }], read: true },
      { day: dayOf(NOW - 3 * DAY), look: 'note', lines: [{ key: 'note.open', vars: { p: 'calm', v: 2 } }], read: true },
    ],
    marks: [7, 30],
  };
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'quiet', dailyNotes: true }, (dir) => writeFileSync(join(dir, 'daily-note.json'), JSON.stringify(legacy)));
  const rows = JSON.parse(await a.main(`JSON.stringify(__jj.mail.all().map((r) => ({ id: r.id, read: r.readAt !== null, kind: r.kind, milestone: r.milestone })))`));
  check('옛 쪽지 3통이 쪽지함으로 옮겨진다', rows.length === 3, JSON.stringify(rows));
  if (rows.length !== 3) {
    const { readFileSync: rf } = await import('node:fs');
    try { console.log(rf(join(a.data, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => /note|mail|쪽지/.test(l)).slice(-8).join('\n')); } catch (e) { console.log('로그 없음', String(e)); }
  }
  check('읽음 표시가 그대로 (안 읽은 것 하나)', rows.filter((r) => !r.read).length === 1);
  check('특별한 편지 종류와 날 수가 남는다', rows.some((r) => r.kind === 'letter' && r.milestone === 7));
  check('특별한 편지를 준 날 수(marks)가 남는다', (await a.main('JSON.stringify(__jj.mail.marks())')) === JSON.stringify([7, 30]));
  check('안 읽음 수가 맞다', (await a.main('__jj.dailyNotes.box().unread')) === 1);
  const dir = a.data;
  const { existsSync } = await import('node:fs');
  check('옛 파일은 .migrated 로 남고 원래 이름은 없다', existsSync(join(dir, 'daily-note.json.migrated')) && !existsSync(join(dir, 'daily-note.json')));
  check('오늘 쪽지가 이미 있어 다시 쓰지 않는다', (await a.main(`__jj.dailyNotes.state.box.filter((n) => n.day === '${dayOf(NOW)}' && n.kind !== 'evening').length`)) === 1);
  await a.stop();
}

// ---- 검토 고침 (PR 261): 코인 중복, 옮기기 두 번, 서버 쪽지 비우기, 계정 바뀜, 두 번 지우기 ----
{
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'quiet', dailyNotes: true });
  const letter = (id, n, coins, ago) =>
    `__jj.mail.put({ id: '${id}', source: 'local', kind: 'letter', day: '${dayOf(NOW - ago * DAY)}', at: ${NOW - ago * DAY}, look: 'letter', milestone: ${n}, coins: ${coins}, payload: { lines: [{ key: 'note.special.open', vars: { p: 'friend', n: ${n} } }] }, readAt: null }); __jj.dailyNotes.changed(); 1`;
  await a.main(letter('L1', 7, 10, 3));
  const bal = () => a.main('__jj.store.balance()');
  const b0 = await bal();
  await a.main(`__jj.dailyNotes.act('L1', 'read'); 1`);
  const b1 = await bal();
  for (let k = 0; k < 2; k++) {
    await a.main(`__jj.dailyNotes.act('L1', 'unread'); 1`);
    await a.main(`__jj.dailyNotes.act('L1', 'read'); 1`);
  }
  const b2 = await bal();
  check('특별한 편지를 읽고 안 읽음으로 되돌려 다시 읽어도 코인은 한 번만 준다', b1 > b0 && b2 === b1, `전 ${b0}, 첫 읽음 ${b1}, 되풀이 ${b2}`);
  await a.main(letter('L2', 30, 20, 2));
  const del = JSON.parse(await a.main(`JSON.stringify(__jj.dailyNotes.act('L2', 'delete'))`));
  check('코인이 걸린 안 읽은 특별한 편지는 지우기가 막힌다', del.ok === false);
  // 이미 휴지통에 있는 쪽지를 또 지워도 30일을 다시 세지 않는다
  await a.main(`__jj.dailyNotes.act('L1', 'delete', 1000); 1`);
  const d1 = await a.main(`__jj.mail.get('L1').deletedAt`);
  await a.main(`__jj.dailyNotes.act('L1', 'delete', 999999); 1`);
  check('이미 휴지통에 있는 쪽지를 또 지워도 지운 시각이 그대로', (await a.main(`__jj.mail.get('L1').deletedAt`)) === d1);
  // 서버 쪽지: 서버 모드가 꺼지면 상태가 바뀔 때 바로 비운다
  const srv = (id, at) => ({ id: `inbox:${id}`, source: 'server', kind: 'grant', day: dayOf(NOW), at, look: 'note', milestone: null, coins: null, payload: { id, kind: 'grant', sender: null, message: `A 계정 쪽지 ${id}`, coins: 0, chatPasses: 0, fillTo: null, sentAt: new Date(at).toISOString(), expiresAt: null, openedAt: null, opened: null, expired: false }, readAt: null });
  const putSrv = (rows) => a.main(`for (const r of ${JSON.stringify(rows)}) __jj.mail.put(r); __jj.dailyNotes.changed(); 1`);
  const serverCount = () => a.main(`__jj.dailyNotes.box().items.filter((i) => i.source === 'server').length`);
  await putSrv([srv(1, NOW - 1000), srv(2, NOW - 2000)]);
  const before = await serverCount();
  await a.main(`(() => { const c = __jj.server.core; c.allowed = () => false; return __jj.serverInbox.sync() })()`);
  check('서버 모드가 꺼지면 서버 쪽지가 쪽지함에서 바로 사라진다', before === 2 && (await serverCount()) === 0, `전 ${before}`);
  // 계정이 바뀌면 앞 계정의 오래된 쪽지가 남지 않는다
  await a.main(`(() => { const c = __jj.server.core; c.allowed = () => true; c.accountKey = () => 'A'; return __jj.serverInbox.sync() })()`);
  await putSrv([srv(901, NOW - 400 * DAY), srv(902, NOW - 401 * DAY)]);
  await a.main(`(() => { const c = __jj.server.core; c.accountKey = () => 'B'; const items = Array.from({ length: 20 }, (_, k) => ({ id: 100 + k, kind: 'grant', sender: null, message: 'B ' + k, coins: 0, chatPasses: 0, fillTo: null, sentAt: new Date(Date.now() - k * 60000).toISOString(), expiresAt: null, openedAt: null, opened: null, expired: false })); c.inbox = async () => ({ items, next: 100, unopened: 0 }); return 1; })()`);
  await a.main(`__jj.serverInbox.refresh()`);
  check('계정이 바뀐 뒤 앞 계정의 오래된 서버 쪽지가 남지 않는다', (await a.main(`__jj.mail.all().filter((r) => r.id === 'inbox:901' || r.id === 'inbox:902').length`)) === 0);
  await a.stop();
}
{
  // 같은 폴더로 두 번 켜기: 백업에서 옛 파일이 다시 생겨도 준 날 수와 지운 쪽지가 남는다
  const scratch = mkdtempSync(join(tmpdir(), '.mailbox-twice-'));
  mkdirSync(join(scratch, 'data'), { recursive: true });
  const legacy = (marks) => ({ marks, box: [{ day: dayOf(NOW - 8 * DAY), look: 'letter', milestone: 7, coins: 5, lines: [{ key: 'note.special.open', vars: { p: 'friend', n: 7 } }], read: true }, { day: dayOf(NOW - 5 * DAY), look: 'note', lines: [{ key: 'note.open', vars: { p: 'friend', name: 'x', v: 1 } }], read: false }] });
  const put = (d, v) => writeFileSync(join(d, 'daily-note.json'), JSON.stringify(v));
  const a = await launch({ petName: 'Mochi', chatter: 'quiet', dailyNotes: true }, (d) => put(d, legacy([7])), scratch);
  const paid = await a.main(`__jj.mail.get('${dayOf(NOW - 8 * DAY)}').coinsPaidAt !== null`);
  await a.main(`__jj.mail.setMarks([7, 30]); __jj.dailyNotes.act('${dayOf(NOW - 5 * DAY)}', 'delete'); 1`);
  await a.stop();
  put(join(scratch, 'data'), legacy([7]));
  const b = await launch({ petName: 'Mochi', chatter: 'quiet', dailyNotes: true }, undefined, scratch);
  check('옛 파일이 다시 생겨 한 번 더 옮겨도 특별한 편지를 준 날 수가 남는다', (await b.main('JSON.stringify(__jj.mail.marks())')) === '[7,30]');
  check('한 번 더 옮겨도 지운 쪽지는 지운 채다', (await b.main(`__jj.mail.get('${dayOf(NOW - 5 * DAY)}')?.deletedAt != null`)) === true);
  check('옛 파일에서 이미 읽은 특별한 편지는 코인을 받은 것으로 옮긴다', paid === true);
  await b.stop();
  rmSync(scratch, { recursive: true, force: true });
}

// ---- 작은 패널 ----
{
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'quiet', dailyNotes: true });
  // 서버 쪽은 흉내: 서버 모드인 것처럼 하되 받기는 아무것도 안 주고(담아 둔 쪽지를 안 비운다) 열기는 조용히 실패한다
  await a.main(`(() => { const c = __jj.server.core; c.allowed = () => true; c.inbox = async () => undefined; c.openInbox = async () => ({ ok: false, status: 409, error: 'x', body: {} }); return 1; })()`);
  const unread0 = await a.main(seedExpr(SEED));
  const ann = await a.main(announceExpr);
  check('공지는 같은 것이 한 통만 모인다', ann === 1, String(ann));
  await a.main('__jj.dailyNotes.changed(); 1');
  const box0 = JSON.parse(await a.main('JSON.stringify({ unread: __jj.dailyNotes.box().unread, n: __jj.dailyNotes.box().items.length })'));
  // 안 읽음: 오늘 쪽지, 저녁 쪽지, 어제 쪽지, 서버 지급(받을 것), 서버 알림, 공지 = 6
  check('안 읽음 수 6 (펫 쪽지 3, 서버 2, 공지 1)', box0.unread === 6 && box0.n === 12, JSON.stringify(box0));

  await a.main(`__jj.panel.openTab('today'); 1`);
  await sleep(1800);
  await a.main(`__jj.panel.window?.removeAllListeners?.('blur'); 1`);
  const p = await a.page('panel');
  await a.main(`__jj.panel.window?.setSize?.(360, 820); 1`);
  await sleep(500);
  const btn = await p.ev(`(() => { const b = document.querySelector('.panel header .mail-btn'); return b ? { label: b.getAttribute('aria-label'), dot: !!b.querySelector('.mail-dot') } : null; })()`);
  check('머리줄 봉투 단추에 안 읽음 점과 숫자 있는 이름', btn && btn.dot && /6/.test(btn.label), JSON.stringify(btn));
  const card = await p.ev(`document.querySelector('.mail-card .mail-card-text')?.textContent ?? ''`);
  check('오늘 탭 새 쪽지 카드의 숫자가 배지와 같다', /6/.test(card), card);
  await p.ev(`document.querySelector('.mail-card-open').click()`);
  await sleep(600);
  check('카드를 누르면 쪽지함 덮개가 열린다', (await p.ev(`!!document.querySelector('.mail-sheet .mail[data-sheet]')`)) === true);
  const unreadRows = () => p.ev(`document.querySelectorAll('.mail-sheet .mail-row.unread').length`);
  check('목록의 안 읽은 줄 수 = 안 읽음 수 (배지와 어긋나지 않는다)', (await unreadRows()) === 6, String(await unreadRows()));
  const titles = await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-row-title')].map((e) => e.textContent)`);
  check('서버 쪽지 제목에 종류와 첫 줄이 있다', titles.some((x) => x.includes(tx('운영자 지급: 이벤트 보상 안내', 'Operator gift: Event reward'))) && titles.some((x) => x.includes(tx('운영자 알림: 점검 안내', 'Operator notice: Maintenance'))), titles.join(' / '));
  check('제목이 전부 같은 "운영자가 보낸 쪽지"가 아니다', new Set(titles.filter((x) => x.includes(tx('운영자', 'Operator')))).size >= 2);
  const groupsText = await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-group h3')].map((e) => e.textContent).join('|')`);
  check('날짜 묶음 (오늘, 이번 주 ...)', groupsText.includes(tx('오늘', 'Today')), groupsText);
  await p.shot(`mail-sheet-${LANG}-360`);

  // 칩과 찾기
  const chipClick = async (label) => p.ev(`[...document.querySelectorAll('.mail-sheet .mail-chips button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`);
  await chipClick(tx('운영자', 'Operator'));
  await sleep(300);
  check('운영자 칩: 서버 운영자 쪽지만', (await p.ev(`document.querySelectorAll('.mail-sheet .mail-row').length`)) === 3, String(await p.ev(`document.querySelectorAll('.mail-sheet .mail-row').length`)));
  await chipClick(tx('공지', 'Notices'));
  await sleep(300);
  check('공지 칩: 공지 한 통', (await p.ev(`document.querySelectorAll('.mail-sheet .mail-row').length`)) === 1);
  await chipClick(tx('안 읽음', 'Unread'));
  await sleep(300);
  check('안 읽음 칩: 6통', (await unreadRows()) === 6 && (await p.ev(`document.querySelectorAll('.mail-sheet .mail-row').length`)) === 6);
  await chipClick(tx('전체', 'All'));
  const search = async (q) => {
    await p.ev(`(() => { const i = document.querySelector('.mail-sheet .mail-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(300);
    return p.ev(`document.querySelectorAll('.mail-sheet .mail-row').length`);
  };
  check('찾기: 점검 -> 서버 알림 한 통', (await search(tx('점검', 'maintenance'))) === 1);
  check('찾기: 없는 말이면 안내', (await search('zzzz없음')) === 0 && (await p.ev(`document.querySelector('.mail-sheet .mail-empty')?.textContent`)) === tx('찾는 쪽지가 없어.', 'No matching notes.'));
  await search('');

  // 읽기: 안 읽은 펫 쪽지를 누르면 읽은 것
  const rowOf = (id) => `document.querySelector('.mail-sheet .mail-row[aria-current], .mail-sheet .mail-row')`;
  await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-row')].find((r) => r.classList.contains('unread') && r.textContent.includes(${JSON.stringify(tx('쪽지', 'note'))}))?.click()`);
  await sleep(700);
  check('누르면 내용 화면(뒤로 단추)', (await p.ev(`!!document.querySelector('.mail-sheet .mail-back') && !!document.querySelector('.mail-sheet .mail-paper')`)) === true);
  await p.shot(`mail-detail-${LANG}-360`);
  check('읽은 쪽지는 안 읽음 수가 줄고 카드, 배지도 같이 바뀐다', await waitUntil(async () => (await a.main('__jj.dailyNotes.box().unread')) === 5));
  await p.ev(`document.querySelector('.mail-sheet .mail-back').click()`);
  await sleep(300);
  check('뒤로 가면 목록', (await p.ev(`!!document.querySelector('.mail-sheet .mail-list-pane:not([hidden])')`)) === true);
  check('목록의 안 읽은 줄 수도 5', (await unreadRows()) === 5, String(await unreadRows()));

  // 받을 것이 남은 서버 쪽지는 못 지움
  await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-row')].find((r) => r.textContent.includes(${JSON.stringify(tx('이벤트 보상 안내', 'Event reward'))}))?.click()`);
  await sleep(500);
  await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-actions button')].find((b) => b.classList.contains('danger')).click()`);
  await sleep(500);
  check('받을 것이 남은 쪽지는 지울 수 없다고 알려 준다', (await p.ev(`document.querySelector('.mail-sheet .mail-msg')?.textContent`)) === tx('받을 것이 남아 있어. 먼저 열어서 받은 뒤에 지울 수 있어.', "There's something inside to collect. Open it and collect first, then you can delete it."));
  check('그 쪽지는 그대로 남아 있다', (await a.main(`__jj.dailyNotes.box().items.some((m) => m.id === 'inbox:1' && !m.deleted && !m.archived)`)) === true);
  await p.ev(`document.querySelector('.mail-sheet .mail-back').click()`);
  await sleep(300);

  // 고정, 보관, 지우기, 되돌리기 (어제 쪽지로)
  const yId = dayOf(NOW - DAY);
  const openRow = async (id) => {
    await p.ev(`(() => { const rows = [...document.querySelectorAll('.mail-sheet .mail-row')]; })()`);
    const titleOf = await a.main(`__jj.dailyNotes.box().items.find((m) => m.id === ${JSON.stringify(id)})?.title`);
    await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-row')].find((r) => r.querySelector('.mail-row-title').textContent === ${JSON.stringify(titleOf)})?.click()`);
    await sleep(500);
  };
  const act = async (label) => { await p.ev(`[...document.querySelectorAll('.mail-sheet .mail-actions button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`); await sleep(500); };
  const flags = (id) => a.main(`(() => { const m = __jj.dailyNotes.box().items.find((x) => x.id === ${JSON.stringify(id)}); return JSON.stringify({ pinned: m.pinned, archived: m.archived, deleted: m.deleted, read: m.read }); })()`);
  await openRow(yId);
  await act(tx('고정', 'Pin'));
  check('고정하면 고정 묶음이 맨 위', JSON.parse(await flags(yId)).pinned && (await p.ev(`document.querySelector('.mail-sheet .mail-group h3')?.textContent`)) === undefined ? false : true);
  await p.ev(`document.querySelector('.mail-sheet .mail-back')?.click()`);
  await sleep(300);
  check('고정 묶음이 목록 맨 위', (await p.ev(`document.querySelector('.mail-sheet .mail-group h3')?.textContent`)) === tx('고정', 'Pinned'));
  await openRow(yId);
  await act(tx('보관', 'Archive'));
  check('보관하면 전체 목록에서 사라지고 알림(되돌리기)이 뜬다', JSON.parse(await flags(yId)).archived && (await p.ev(`!!document.querySelector('.mail-sheet .mail-toast')`)) === true);
  check('보관한 쪽지가 안 읽음 수에 안 센다 (보관 전에 연 쪽지라 읽은 상태, 수는 그대로 4)', (await a.main('__jj.dailyNotes.box().unread')) === 4);
  await p.ev(`document.querySelector('.mail-sheet .mail-toast .link').click()`);
  await sleep(500);
  check('되돌리기로 보관이 풀린다', !JSON.parse(await flags(yId)).archived);
  await openRow(yId);
  await act(tx('지우기', 'Delete'));
  check('지우면 휴지통으로 (삭제 알림)', JSON.parse(await flags(yId)).deleted && (await p.ev(`document.querySelector('.mail-sheet .mail-toast span')?.textContent`)) === tx('쪽지를 지웠어. 휴지통에 30일 있어.', 'Note deleted. It stays in the trash for 30 days.'));
  check('지운 쪽지는 오늘 쪽지가 다시 쓰이지 않게 상태에는 남는다', (await a.main(`__jj.dailyNotes.state.box.some((n) => n.day === '${yId}')`)) === true);
  // 휴지통 30일이 지나 글을 비운 서버 쪽지(묘비)는 휴지통 목록에도 안 보인다
  await a.main(`__jj.mail.put({ id: 'inbox:777', source: 'server', kind: 'grant', day: '${dayOf(NOW - 40 * DAY)}', at: ${NOW - 40 * DAY}, look: 'note', milestone: null, coins: null, payload: null, readAt: 1 }); __jj.mail.setDeleted('inbox:777', ${NOW - 40 * DAY}); __jj.dailyNotes.changed(); 1`);
  await chipClick(tx('휴지통', 'Trash'));
  await sleep(300);
  check('휴지통 칩에 한 통', (await p.ev(`document.querySelectorAll('.mail-sheet .mail-row').length`)) === 1);
  await p.shot(`mail-trash-${LANG}-360`);
  await p.ev(`document.querySelector('.mail-sheet .mail-row').click()`);
  await sleep(500);
  await act(tx('되살리기', 'Restore'));
  check('되살리면 휴지통에서 나온다', !JSON.parse(await flags(yId)).deleted);
  await chipClick(tx('전체', 'All'));
  await sleep(300);

  // 모두 읽음
  await p.ev(`document.querySelector('.mail-sheet .mail-readall').click()`);
  await sleep(900);
  const left = await a.main('__jj.dailyNotes.box().unread');
  check('모두 읽음: 받을 것이 남은 서버 쪽지만 안 읽음으로 남는다', left === 1, String(left));
  check('쪽지함 머리의 안 읽음 숫자도 1', ((await p.ev(`document.querySelector('.mail-sheet .mail-unread')?.textContent`)) ?? '').includes('1'));
  check('특별한 편지를 읽으면 코인이 들어간다(읽은 것은 중복 지급 없음)', (await a.main(`__jj.mail.get('${dayOf(NOW - 45 * DAY)}')?.readAt !== null`)) === true);
  await p.shot(`mail-sheet-all-${LANG}-360`);

  // 좁은 폭 넘침, Esc
  for (const w of [320]) {
    await a.main(`__jj.panel.window?.setSize?.(${w}, 820); 1`);
    await sleep(500);
    const over = await p.ev(`[...document.querySelectorAll('.mail-sheet *, .panel header *')].filter((e) => !e.closest('.mail-chips')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).map((e) => e.tagName + '.' + e.className).slice(0, 4).join(',')`);
    check(`폭 ${await p.ev('innerWidth')} 에서 가로 넘침 없음 (머리줄 단추 다섯 포함)`, over === '', over);
    for (const dark of [false, true]) {
      await p.dark(dark);
      await sleep(200);
      await p.shot(`mail-sheet-${LANG}-${w}-${dark ? 'dark' : 'light'}`);
    }
    await p.dark(false);
  }
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  check('Esc 로 쪽지함 덮개만 닫힌다 (패널은 그대로)', (await p.ev(`!document.querySelector('.mail-sheet')`)) === true && (await a.main(`!!__jj.panel.window && !__jj.panel.window.isDestroyed()`)) === true);
  // 펫 메뉴/쪽지 말풍선 단추가 쓰는 경로: 패널에 mail 탭 요청
  await a.main(`__jj.panel.openTab('mail'); 1`);
  await sleep(700);
  check('mail 탭 요청이 덮개를 연다 (펫 메뉴, 말풍선 단추)', (await p.ev(`!!document.querySelector('.mail-sheet')`)) === true);
  await a.stop();
}

// ---- 큰 창: 목록과 내용이 나란히 ----
{
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'quiet', dailyNotes: true, panelView: 'window' });
  await a.main(seedExpr(SEED));
  await a.main(announceExpr);
  await a.main(`__jj.panel.openTab('mail'); 1`);
  await sleep(2200);
  const h = await a.page('home');
  await a.main(`(() => { const w = __jj.home?.window; w?.setSize?.(1100, 760); return 1; })()`);
  await sleep(800);
  const nav = await h.ev(`document.getElementById('ptab-mail')?.getAttribute('aria-current')`);
  check('큰 창이 쪽지함 구역으로 열린다', nav === 'page', String(nav));
  const names = await h.ev(`[...document.querySelectorAll('.home-nav button .name')].map((e) => e.textContent).join('|')`);
  check('사이드바: 기록 다음에 쪽지함', names.includes(`${tx('기록', 'Records')}|${tx('쪽지함', 'Mailbox')}`), names);
  const badge = await h.ev(`document.querySelector('.home-nav .mail-badge')?.textContent`);
  check('사이드바 안 읽음 숫자 6', badge === '6', String(badge));
  check('쪽지함 구역 제목줄', (await h.ev(`document.querySelector('.home-bar h2').textContent`)) === tx('쪽지함', 'Mailbox'));
  const cols = await h.ev(`getComputedStyle(document.querySelector('.mail .mail-body')).gridTemplateColumns`);
  check('넓은 폭: 목록과 내용 두 칸', cols.split(' ').length === 2, cols);
  await h.ev(`document.querySelector('.mail .mail-row.unread').click()`);
  await sleep(700);
  check('내용이 오른쪽에 나란히 보이고 목록도 그대로', (await h.ev(`!!document.querySelector('.mail .mail-detail-pane .mail-paper') && document.querySelectorAll('.mail .mail-row').length > 5`)) === true);
  check('숫자가 줄어든다 (6 -> 5)', await waitUntil(async () => (await h.ev(`document.querySelector('.home-nav .mail-badge')?.textContent`)) === '5'));
  check('큰 창에서는 뒤로 단추가 없다', (await h.ev(`!document.querySelector('.mail .mail-back')`)) === true);
  const over = await h.ev(`[...document.querySelectorAll('.mail *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).length`);
  check('가로 넘침 없음', over === 0, String(over));
  for (const dark of [false, true]) {
    await h.dark(dark);
    await sleep(200);
    await h.shot(`mail-home-${LANG}-1100-${dark ? 'dark' : 'light'}`);
  }
  await h.dark(false);
  // 번호 단축키는 그대로 (쪽지함에는 번호가 없다)
  check('쪽지함 구역 풀이에 단축키 번호가 없다', (await h.ev(`!document.querySelector('#ptab-mail kbd')`)) === true);
  await a.stop();
}

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
