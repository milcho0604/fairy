// 말 빈도 "가끔 한마디"와 말 안 하는 시간 (설정 > 비서). 새 사용자 기본, 옛 사용자 유지, 단추 누르기, 시간 칸, 넘침, 말풍선 변형.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/voice-core.mjs
//   PREFIX=before|after JJ_ROOT=<체크아웃> 이면 설정 비서 탭 그림만 (전후 비교 재료)
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
async function launch(settings) {
  const INSPECT = await freePort();
  const PAGE = await freePort();
  const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.voice-test-'));
  const data = join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  if (settings) writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, ...settings }));
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
    cdp.disconnect();
    try {
      app.kill('SIGTERM');
    } catch {}
    await sleep(700);
    try {
      app.kill('SIGKILL');
    } catch {}
    rmSync(scratch, { recursive: true, force: true });
  };
  return { ...cdp, stop };
}

const clickText = (label, sel = 'button') =>
  `(() => { const b = [...document.querySelectorAll('${sel}')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;
const labels = {
  quiet: tx('조용히', 'Quiet'),
  normal: tx('보통', 'Normal'),
  sometimes: tx('가끔 한마디', 'Now and then'),
  chatty: tx('수다쟁이', 'Chatty'),
};

async function openAssist(a) {
  await a.main('__jj.settingsWindow.open(); 1');
  await sleep(2200);
  const st = await a.page('settings');
  await st.ev(`document.getElementById('tab-assist').click()`);
  await sleep(500);
  return st;
}
/** 말풍선 빈도 단추 줄 (설정 > 비서의 첫 묶음) */
const BUBBLES = `[...document.querySelectorAll('fieldset.segmented')].find((f) => [...f.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(labels.chatty)}))`;
const pressed = (st) =>
  st.ev(`[...(${BUBBLES}).querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()).join('|')`);

// ---- 전후 비교 재료만 ----
if (SHOTS_ONLY) {
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'normal' });
  const st = await openAssist(a);
  await a.main('__jj.settingsWindow.window.setSize(480, 640); 1');
  await sleep(500);
  for (const dark of [false, true]) {
    await st.dark(dark);
    await sleep(200);
    await st.shot(`voice-${PREFIX}-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await a.stop();
  process.exit(0);
}

// ---- 새 사용자: 설정 파일이 없으면 가끔 한마디 (말은 운영체제를 따르니 값만 본다) ----
{
  const a = await launch(undefined);
  check('새 사용자 기본은 가끔 한마디', (await a.main('__jj.settings.get().chatter')) === 'sometimes');
  await a.stop();
}

// ---- 설정 화면 (가끔 한마디를 고른 사람) ----
{
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'sometimes' });
  const st = await openAssist(a);
  check('단추 넷, 가끔 한마디가 눌린 상태', (await pressed(st)) === labels.sometimes, await pressed(st));
  const names = await st.ev(`[...(${BUBBLES}).querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')`);
  check('단추 순서: 조용히, 보통, 가끔 한마디, 수다쟁이', names === [labels.quiet, labels.normal, labels.sometimes, labels.chatty].join('|'), names);
  for (const level of ['quiet', 'normal', 'chatty', 'sometimes']) {
    await st.ev(`(() => { const b = [...(${BUBBLES}).querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(labels[level])}); b.click(); return true; })()`);
    await sleep(350);
    check(`${level} 누르면 설정이 바뀐다`, (await a.main('__jj.settings.get().chatter')) === level);
  }
  const hint = await st.ev(`(${BUBBLES}).nextElementSibling?.textContent ?? ''`);
  check('가끔 한마디 설명이 보인다', hint.length > 10 && !/\{/.test(hint), hint);

  // 말 안 하는 시간
  check('처음엔 시간 칸이 없다', (await st.ev(`document.querySelectorAll('.quiet-times').length`)) === 0);
  // Toggle 은 aria-label 이 줄 이름인 스위치
  await st.ev(`document.querySelector('[role=switch][aria-label=${JSON.stringify(tx('시간을 정해 쉬기', 'Rest at set times'))}]')?.click()`);
  await sleep(500);
  check('켜면 시작, 끝 시간 칸이 나온다', (await st.ev(`document.querySelectorAll('.quiet-times input[type=time]').length`)) === 2);
  check('설정에 켜짐이 저장된다', (await a.main('__jj.settings.get().quietHours.on')) === true);
  await st.ev(`(() => { const [from, to] = document.querySelectorAll('.quiet-times input[type=time]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(from, '22:00'); from.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  await st.ev(`(() => { const [, to] = document.querySelectorAll('.quiet-times input[type=time]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(to, '08:30'); to.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  check('시간이 저장된다 (22:00 ~ 08:30)', (await a.main('JSON.stringify(__jj.settings.get().quietHours)')) === JSON.stringify({ on: true, from: 1320, to: 510, weekend: false }), await a.main('JSON.stringify(__jj.settings.get().quietHours)'));
  await st.ev(`document.querySelector('[role=switch][aria-label=${JSON.stringify(tx('주말에는 하루 종일 쉬기', 'Stay quiet all day on weekends'))}]')?.click()`);
  await sleep(400);
  check('주말 쉬기가 저장된다', (await a.main('__jj.settings.get().quietHours.weekend')) === true);

  // 말풍선 변형 (메인의 voiced)
  const line = (key, vars = '{name:"콩이"}') => a.main(`__jj.lines.line(${JSON.stringify(key)}, ${vars})`);
  const rest16 = await line('pet.rest.16');
  const fed8 = await line('pet.fed.8');
  const any60 = await line('idle.any.60');
  check('새 변형 문구가 말풍선 글로 나온다', [rest16, fed8, any60].every((s) => typeof s === 'string' && s.length > 5 && !/\{|undefined/.test(s)), [rest16, fed8, any60].join(' / '));
  check('언어에 맞는 글', ko ? /[가-힣]/.test(any60) : !/[가-힣]/.test(any60));

  // 넘침: 설정 창 폭 줄이기
  for (const [w, h] of [[480, 700], [360, 700], [320, 700]]) {
    await a.main(`__jj.settingsWindow.window.setSize(${w}, ${h}); 1`);
    await sleep(500);
    const over = await st.ev(`[...document.querySelectorAll('.segmented button, .quiet-times *, .segmented')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || e.scrollWidth > e.clientWidth + 1); }).map((e) => e.tagName + '.' + e.className).slice(0, 4).join(',')`);
    const w2 = await st.ev('innerWidth');
    check(`폭 ${w2} 에서 가로 넘침 없음`, over === '', over);
    for (const dark of [false, true]) {
      await st.dark(dark);
      await sleep(150);
      await st.shot(`voice-core-${LANG}-${w}-${dark ? 'dark' : 'light'}`);
    }
    await st.dark(false);
  }
  await a.stop();
}

// ---- 옛 사용자: 설정 파일에 수다 빈도가 없으면 보통, 있으면 그대로 ----
for (const [name, saved, want] of [
  ['수다 빈도 없는 옛 설정은 보통', { petName: '밤' }, 'normal'],
  ['수다쟁이였던 사람은 수다쟁이', { petName: '밤', chatter: 'chatty' }, 'chatty'],
  ['조용히였던 사람은 조용히', { petName: '밤', chatter: 'quiet' }, 'quiet'],
]) {
  const a = await launch(saved);
  check(name, (await a.main('__jj.settings.get().chatter')) === want, await a.main('__jj.settings.get().chatter'));
  await a.stop();
}

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
