// 말투 설정 2와 편지 (feat/voice-style): 내 말투 편집기(말끝 여럿, 빈도, 펫 1인칭, 열 가지 때, 미리 듣기), 프리셋 복사, 대사 안 쓰기,
// 저녁 쪽지 설정과 주간 편지, 저녁 쪽지 만들기.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/voice-style.mjs
//   PREFIX=before|after JJ_ROOT=<체크아웃> 이면 페어리 탭의 말투 칸 그림만 (전후 비교 재료)
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


const labels = {
  cat: tx('…냥', '…냥'),
  custom: tx('내 말투', 'My style'),
};
const personaCat = tx('느긋한 고양이', 'Laid-back cat');

async function openPet(a, persona) {
  if (persona) await a.main(`__jj.settings.set({ persona: ${JSON.stringify(persona)} }); 1`);
  await a.main('__jj.settingsWindow.open(); 1');
  await sleep(2200);
  const st = await a.page('settings');
  await st.ev(`document.getElementById('tab-pet').click()`);
  await sleep(500);
  return st;
}

// ---- 전후 비교 재료만 ----
if (SHOTS_ONLY) {
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'normal', persona: 'custom' });
  const st = await openPet(a);
  await a.main('__jj.settingsWindow.window.setSize(480, 900); 1');
  await sleep(500);
  await st.ev(`document.getElementById('pet-speech').scrollIntoView()`);
  await sleep(300);
  for (const dark of [false, true]) {
    await st.dark(dark);
    await sleep(200);
    await st.shot(`style-${PREFIX}-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await a.stop();
  process.exit(0);
}

{
  const a = await launch({ petName: tx('콩', 'Mochi'), chatter: 'normal', persona: 'cat', eveningNotes: false });
  const st = await openPet(a);
  const speech = `document.getElementById('pet-speech')`;
  // 프리셋: 복사 단추
  const copy = tx('이 말투를 내 말투로 복사해서 고치기', 'Copy this style to My style and edit it');
  check('프리셋에는 복사 단추가 있다', (await st.ev(`[...${speech}.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(copy)})`)) === true);
  await st.ev(`[...${speech}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(copy)}).click()`);
  await sleep(700);
  check('복사하면 내 말투가 되고 고양이 말끝이 들어 있다', (await a.main('__jj.settings.get().persona')) === 'custom' && (await a.main('JSON.stringify(__jj.settings.get().speech.endings)')) === JSON.stringify(['냥']), await a.main('JSON.stringify(__jj.settings.get().speech.endings)'));
  check('복사한 말투는 직접 쓴 말을 자주 쓴다', (await a.main('__jj.settings.get().speech.ownRate')) === 'often');

  // 말끝 여럿
  const chip = (txt) => `[...${speech}.querySelectorAll('.speech-chips button')].find((b) => b.textContent.trim() === ${JSON.stringify(txt)})`;
  await st.ev(`(${chip('…뿌')}).click()`);
  await sleep(500);
  check('말끝을 둘 고를 수 있다 (냥, 뿌)', (await a.main('JSON.stringify(__jj.settings.get().speech.endings)')) === JSON.stringify(['냥', '뿌']), await a.main('JSON.stringify(__jj.settings.get().speech.endings)'));
  await st.ev(`(${chip('…용')}).click()`);
  await st.ev(`(${chip('…멍')}).click()`);
  await sleep(500);
  check('말끝은 세 개까지', (await a.main('__jj.settings.get().speech.endings.length')) === 3);
  await st.ev(`(${chip('…멍')}).click()`);
  await st.ev(`(${chip('…용')}).click()`);
  await sleep(400);

  // 빈도 칸
  const rateRows = await st.ev(`[...${speech}.querySelectorAll('fieldset.segmented')].filter((f) => [...f.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(tx('가끔', 'Sometimes'))})).length`);
  check('말끝이 있으면 빈도 칸이 보인다', rateRows >= 1, String(rateRows));
  const sometimes = tx('가끔', 'Sometimes');
  await st.ev(`[...${speech}.querySelectorAll('fieldset.segmented')].find((f) => [...f.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(sometimes)})).querySelectorAll('button')[2].click()`);
  await sleep(500);
  check('말끝 빈도를 가끔으로', (await a.main('__jj.settings.get().speech.endingRate')) === 'sometimes');

  // 펫 1인칭 (한국어만)
  const meBtn = tx('나', null);
  if (ko) {
    await st.ev(`[...${speech}.querySelectorAll('fieldset.segmented button')].find((b) => b.textContent.trim() === '나').click()`);
    await sleep(500);
    check('펫 1인칭 나', (await a.main('__jj.settings.get().speech.self')) === 'me');
    const line = await a.main(`__jj.lines.line('idle.any.17', { name: '콩이' })`);
    check('말풍선이 "나는" 으로 나온다', /^나는 /.test(line), line);
  } else {
    check('영어에서는 1인칭 칸이 없다', (await st.ev(`${speech}.textContent.includes('How the fairy refers to itself')`)) === false);
  }

  // 열 가지 때
  const nTextareas = await st.ev(`${speech}.querySelectorAll('.speech-lines textarea').length`);
  check('직접 쓴 말 때가 열 가지', nTextareas === 10, String(nTextareas));
  await st.ev(`(() => { const ta = ${speech}.querySelectorAll('.speech-lines textarea')[4]; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ${JSON.stringify(tx('점심이다! 밥 먹자', "Lunch time! Let's eat"))}); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(900);
  check('점심 말이 저장된다', (await a.main('__jj.settings.get().speech.lines.lunch[0]')) !== undefined);
  check('직접 쓴 말이 있으면 빈도 칸이 보인다', (await st.ev(`${speech}.textContent.includes(${JSON.stringify(tx('직접 쓴 말 쓰는 빈도', 'How often to use my own lines'))})`)) === true);

  // 미리 듣기
  const before = await st.ev(`[...${speech}.querySelectorAll('.speech-bubble')].map((p) => p.textContent).join('|')`);
  await st.ev(`${speech}.querySelector('.speech-preview-bar select').value = 'rest'; ${speech}.querySelector('.speech-preview-bar select').dispatchEvent(new Event('change', { bubbles: true }))`);
  await sleep(300);
  const rest1 = await st.ev(`[...${speech}.querySelectorAll('.speech-bubble')].map((p) => p.textContent).join('|')`);
  await st.ev(`${speech}.querySelector('.speech-preview-bar button').click()`);
  await sleep(300);
  const rest2 = await st.ev(`[...${speech}.querySelectorAll('.speech-bubble')].map((p) => p.textContent).join('|')`);
  check('상황을 고르면 말이 바뀌고', before !== rest1, rest1.slice(0, 60));
  check('다른 말로 누르면 또 바뀐다', rest1 !== rest2, rest2.slice(0, 60));
  check('휴식 미리 듣기가 네 줄', rest1.split('|').length === 4);
  await st.ev(`${speech}.querySelector('.speech-preview-bar select').value = 'note'; ${speech}.querySelector('.speech-preview-bar select').dispatchEvent(new Event('change', { bubbles: true }))`);
  await sleep(300);
  const note = await st.ev(`${speech}.querySelector('.speech-bubble').textContent`);
  check('쪽지 미리 듣기가 나온다', note.length > 20 && !/\{|undefined/.test(note), note.slice(0, 50));

  // 저녁 쪽지 설정
  const evLabel = tx('저녁 쪽지', 'Evening notes');
  await st.ev(`document.getElementById('pet-notifications').scrollIntoView()`);
  const evOn = () => st.ev(`document.querySelector('[role=switch][aria-label=${JSON.stringify(evLabel)}]')?.getAttribute('aria-checked')`);
  check('저녁 쪽지는 기본 꺼짐', (await evOn()) === 'false', await evOn());
  await st.ev(`document.querySelector('[role=switch][aria-label=${JSON.stringify(evLabel)}]').click()`);
  await sleep(500);
  check('저녁 쪽지를 켜면 저장된다', (await a.main('__jj.settings.get().eveningNotes')) === true);

  // 편지: 주간 편지와 저녁 쪽지 만들기
  const wk = await a.main(`(async () => { await __jj.dailyNotes.debugWeek(); return JSON.stringify(__jj.dailyNotes.state.box[0]); })()`);
  const wkNote = JSON.parse(wk);
  check('주간 편지가 쓰인다 (봉투, 코인 없음)', wkNote.kind === 'week' && wkNote.look === 'letter' && !wkNote.coins, wk.slice(0, 80));
  const ev = await a.main(`(async () => { await __jj.dailyNotes.debugEvening(); return JSON.stringify(__jj.dailyNotes.state.box.map((n) => [n.day, n.kind ?? 'daily'])); })()`);
  check('저녁 쪽지가 같은 날 따로 쌓인다', ev.includes('"evening"') && ev.includes('"week"'), ev);

  // 대사 안 쓰기
  await st.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('대사 고치기', 'Edit lines'))}).click()`);
  await sleep(900);
  const rowSel = `document.querySelector('.lines-row[data-key="idle.any.17"]')`;
  await st.ev(`document.querySelector('.lines-sheet input[type=search], .lines-sheet input')?.focus()`);
  // 묶음을 펼쳐 그 줄을 찾는다
  await st.ev(`[...document.querySelectorAll('.lines-group')].forEach((d) => (d.open = true))`);
  await sleep(500);
  const muteLabel = tx('안 쓰기', 'Stop using');
  const hasRow = await st.ev(`!!${rowSel}`);
  check('대사 줄에 안 쓰기 단추가 있다', hasRow && (await st.ev(`${rowSel}.querySelector('.lines-mute')?.textContent.trim()`)) === muteLabel);
  await st.ev(`${rowSel}.querySelector('.lines-mute').click()`);
  await sleep(700);
  check('안 쓰기를 누르면 저장된다', (await a.main(`JSON.stringify(__jj.lines.muted())`)).includes('idle.any.17'));
  check('줄이 흐려지고 다시 쓰기로 바뀐다', (await st.ev(`${rowSel}.classList.contains('muted') && ${rowSel}.querySelector('.lines-mute').textContent.trim()`)) === tx('다시 쓰기', 'Use again'));
  const countTxt = await st.ev(`document.querySelector('.lines-count')?.textContent ?? ''`);
  check('안 쓰는 말 개수가 보인다', /1/.test(countTxt) && (countTxt.includes('안 쓰는') || countTxt.includes('muted')), countTxt);
  for (const dark of [false, true]) {
    await st.dark(dark);
    await sleep(150);
    await st.shot(`style-lines-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await st.dark(false);
  await st.ev(`${rowSel}.querySelector('.lines-mute').click()`);
  await sleep(500);
  check('다시 쓰기로 되돌리면 목록이 비워진다', !(await a.main(`JSON.stringify(__jj.lines.muted())`)).includes('idle.any.17'));
  // 시트 닫기
  await st.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('닫기', 'Close'))})?.click()`);
  await sleep(400);

  // 넘침과 그림
  await st.ev(`document.getElementById('pet-speech').scrollIntoView()`);
  for (const [w, h] of [[480, 900], [360, 900]]) {
    await a.main(`__jj.settingsWindow.window.setSize(${w}, ${h}); 1`);
    await sleep(500);
    const over = await st.ev(`[...document.querySelectorAll('#pet-speech *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).map((e) => e.tagName + '.' + e.className).slice(0, 4).join(',')`);
    check(`폭 ${await st.ev('innerWidth')} 말투 칸 가로 넘침 없음`, over === '', over);
    await st.ev(`document.querySelector('#pet-speech .speech-editor').scrollIntoView()`);
    for (const dark of [false, true]) {
      await st.dark(dark);
      await sleep(150);
      await st.shot(`style-${LANG}-${w}-${dark ? 'dark' : 'light'}`);
    }
    await st.dark(false);
  }
  await a.stop();
}

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
