// 큰 창 친구 구역 (home/FriendsPage.tsx): 사이드바에 늘 보임, 못 쓰는 까닭 다섯, 불러오는 중, 0명 초대 안내, 여러 명 목록,
// 상태가 바뀌면 바로 갱신, 설정 열기 단추, 폭 760/1440 x 밝음/어두움 그림과 가로 넘침.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/friends-list.mjs
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ko = LANG === 'ko';
const tx = (a, b) => (ko ? a : b);
mkdirSync(OUT, { recursive: true });
process.env.OUT = OUT;
// 포트는 9900~9949 안에서 비어 있는 것 (앞서 고른 것과 겹치지 않게 적어 둔다)
const taken = new Set();
const freePort = async () => {
  for (let port = 9900; port < 9950; port++) {
    if (taken.has(port)) continue;
    const ok = await new Promise((r) => {
      const s = createServer();
      s.once('error', () => r(false));
      s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) {
      taken.add(port);
      return port;
    }
  }
  throw new Error('9900~9949 에 빈 포트가 없다');
};

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




const waitUntil = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};

/** 친구 상태 흉내 (FriendsState). 서버와 로그인 없이 구역 모양만 본다 */
const NOW = Date.now();
const iso = (days) => new Date(NOW - days * 86_400_000).toISOString();
const person = (n, nick) => ({ code: `F-${String(n).padStart(4, '0')}-ABCD`, nickname: nick });
const friendOf = (n, nick, over = {}) => ({ ...person(n, nick), since: iso(n * 9), iShare: false, theyShare: false, busyAt: null, iVisit: false, theyVisit: false, canTitle: false, iTitle: false, theyTitle: false, ...over });
const baseList = (over = {}) => ({ me: person(1, tx('나', 'Me')), friends: [], incoming: [], outgoing: [], blocked: [], limits: { friends: 30, giftCoinsPerDay: 100, giftPassesPerDay: 1, requestDays: 7, busyDays: 14 }, today: { coins: 0, passes: 0 }, ...over });
const stateOf = (over = {}) => ({ available: true, off: null, list: baseList(), problem: null, gifts: false, passGifts: false, calendar: true, visit: true, visitCustom: false, balance: 100, passes: 0, prefill: null, ...over });
const offState = (off) => stateOf({ available: false, off, list: null, calendar: false, visit: false });
const MANY = stateOf({
  list: baseList({
    incoming: [{ id: 1, ...person(20, tx('모카', 'Mocha')), sentAt: iso(1), expiresAt: iso(-6) }],
    friends: [
      friendOf(2, tx('콩이', 'Bean'), { theyShare: true, iShare: true, iVisit: true }),
      friendOf(3, tx('아주 아주 긴 이름을 가진 친구 펫 주인 님', 'A friend with a really very long display name here')),
      friendOf(4, null, { theyShare: true }),
      friendOf(5, tx('하나', 'Hana')),
      friendOf(6, tx('두리', 'Duri'), { iVisit: true }),
      friendOf(7, tx('세찬', 'Sechan')),
    ],
    outgoing: [{ id: 2, ...person(21, tx('보낸이', 'Sent')), sentAt: iso(1), expiresAt: iso(-5) }],
  }),
});

const a = await launch({ chatter: 'quiet', panelView: 'window' });
await a.main(`__jj.panel.openTab('friends'); 1`);
await sleep(2200);
const h = await a.page('home');
const setSize = async (w, hh) => {
  await a.main(`__jj.home?.window?.setSize?.(${w}, ${hh}); 1`);
  await sleep(500);
};
const nav = () => h.ev(`[...document.querySelectorAll('.home-nav button .name')].map((e) => e.textContent).join('|')`);
const fp = () => h.ev(`document.querySelector('.fp')?.dataset.state ?? null`);
const text = () => h.ev(`document.querySelector('.fp')?.innerText ?? ''`);
const push = async (st) => {
  await a.main(`__jj.server.debugFriendsView(${JSON.stringify(st)})`);
  await sleep(450);
};
const over = () => h.ev(`[...document.querySelectorAll('.fp, .fp *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).length`);
const shots = async (name) => {
  for (const [w, label] of [[760, 'narrow'], [1440, 'wide']]) {
    await setSize(w, 780);
    for (const dark of [false, true]) {
      await h.dark(dark);
      await sleep(200);
      await h.shot(`friends-${name}-${LANG}-${label}-${dark ? 'dark' : 'light'}`);
      check(`${name} ${label} ${dark ? '어두움' : '밝음'}: 가로 넘침 없음`, (await over()) === 0, String(await over()));
    }
    await h.dark(false);
  }
  await setSize(1100, 780);
};

await setSize(1100, 780);
check('사이드바 끝에 친구 (늘 보임)', (await nav()).endsWith(tx('쪽지함|친구', 'Mailbox|Friends')), await nav());
check('친구 구역이 지금 구역이다', (await h.ev(`document.getElementById('ptab-friends')?.getAttribute('aria-current')`)) === 'page');
check('구역 제목줄', (await h.ev(`document.querySelector('.home-bar h2').textContent`)) === tx('친구', 'Friends'));
check('친구 풀이에 단축키 8번', (await h.ev(`document.querySelector('#ptab-friends kbd')?.textContent`)).includes('8'));

// 진짜 상태: 시험 판에는 서버 주소가 없다 -> 까닭 noServer
check('진짜 상태: 서버 없는 판은 까닭을 보인다', await waitUntil(async () => (await fp()) === 'off'));
check('까닭 글이 noServer', (await h.ev(`document.querySelector('.fp-off')?.dataset.reason`)) === 'noServer');
await h.shot(`friends-real-off-${LANG}`);

// 까닭마다 다른 글, 설정 열기 단추
const seen = new Set();
for (const off of ['noServer', 'age', 'serverOff', 'signedOut', 'featureOff']) {
  await push(offState(off));
  const reason = await h.ev(`document.querySelector('.fp-off')?.dataset.reason`);
  const body = await h.ev(`document.querySelector('.fp-off p')?.textContent ?? ''`);
  seen.add(body);
  check(`못 쓰는 까닭 ${off}: 글과 설정 열기 단추`, reason === off && body.length > 10 && (await h.ev(`!!document.querySelector('.fp-off button')`)) === true, body);
  check(`못 쓰는 까닭 ${off}: 빈 목록이 아니다`, (await h.ev(`document.querySelectorAll('.fp-list li').length`)) === 0);
  if (off !== 'noServer') check(`${off} 글에 설정 경로`, off === 'featureOff' || body.includes(tx('설정 > 데이터와 계정', 'Settings > Data and account')), body);
}
check('까닭 다섯은 글이 모두 다르다', seen.size === 5);
await push(offState('signedOut'));
await shots('off');

// 설정 열기 단추는 실제로 설정 창을 연다
await a.main(`__jj.settingsWindow.window?.close(); 1`);
await sleep(500);
await h.ev(`document.querySelector('.fp-off button').click()`);
check('설정 열기 단추가 설정 창을 연다 (큰 창은 그대로)', await waitUntil(async () => a.main(`!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()`)));
await a.main(`__jj.settingsWindow.window?.close(); 1`);
await sleep(400);

// 불러오는 중 (쓸 수 있는데 목록이 아직 없다)
await push(stateOf({ list: null }));
check('쓸 수 있고 목록 전: 불러오는 중', (await fp()) === 'loading');
await push(stateOf({ list: null, problem: 'offline' }));
check('받기에 실패: 실패 글', (await fp()) === 'problem');

// 친구 0명: 초대 안내
await push(stateOf());
check('0명: 초대 안내', (await fp()) === 'empty' && (await text()).includes(tx('아직 친구가 없어', 'No friends yet')));
check('0명: 내 코드와 복사 단추 둘', (await text()).includes('F-0001-ABCD') && (await h.ev(`document.querySelectorAll('.fp-me button').length`)) === 2);
check('0명: 설정 관리 단추', (await h.ev(`!!document.querySelector('.fp-manage button')`)) === true);
await shots('empty');

// 여러 명
await push(MANY);
check('여러 명: 목록 화면', (await fp()) === 'list');
check('줄 여덟 (받은 신청 1, 친구 6, 보낸 신청 1)', (await h.ev(`document.querySelectorAll('.fp-list li').length`)) === 8);
const t1 = await text();
check('받은 신청과 보낸 신청 묶음', t1.includes(tx('받은 신청 1건', 'Requests for you (1)')) && t1.includes(tx('보낸 신청 1건', 'Sent requests (1)')), t1.slice(0, 200));
check('친구 수와 상한', t1.includes(tx('친구 6명 (최대 30명)', '6 friends (up to 30)')), t1.slice(0, 200));
check('일정 공유와 놀러 가기 표시', t1.includes(tx('나에게 바쁜 시간을 보여 줘', 'Shows you their busy times')) && t1.includes(tx('펫 놀러 가기 켬', 'Pet visits on')));
check('닉네임이 없으면 코드', t1.includes('F-0004-ABCD'));
await shots('many');

// 상태가 바뀌면 바로 갱신 (친구 하나 줄고 0명으로)
await push(stateOf({ list: baseList({ friends: [friendOf(2, tx('콩이', 'Bean'))] }) }));
check('상태가 바뀌면 바로 갱신: 한 명', (await h.ev(`document.querySelectorAll('.fp-list li').length`)) === 1);
await push(stateOf());
check('다시 0명이면 초대 안내', (await fp()) === 'empty');

// 친구 구역을 떠났다 돌아와도 같다 + 다른 구역 단축키
await h.ev(`document.getElementById('ptab-records').click()`);
await sleep(300);
check('다른 구역으로 가면 친구 본문이 없다', (await fp()) === null);
await h.ev(`document.getElementById('ptab-friends').click()`);
await sleep(300);
check('친구 구역으로 돌아오면 다시 그린다', (await fp()) === 'empty');

// 진짜 상태로 되돌린다
await a.main(`__jj.server.debugFriendsView(null); 1`);
await a.stop();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
