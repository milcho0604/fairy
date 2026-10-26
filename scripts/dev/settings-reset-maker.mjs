// #149: 설정 기본값 복원 범위와 페어리 만들기 안내. 앱은 임시 데이터/HOME, JJ_NO_FOCUS, CDP로만 조작.
// npm run build && OUT=/tmp/fairy-reset LANG_UNDER_TEST=ko node scripts/dev/settings-reset-maker.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';

const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const scratch = mkdtempSync(join(tmpdir(), 'fairy-reset-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
process.env.OUT ??= '/tmp/fairy-reset';
for (const d of [data, home, process.env.OUT]) mkdirSync(d, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({
  onboarded: true, lang, osNotify: false, wander: false, chatter: 'quiet', petName: 'Mochi',
  icsUrl: 'https://example.test/calendar.ics',
}));
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return String(p);
}
process.env.JJ_INSPECT_PORT = await port();
process.env.JJ_PAGE_PORT = await port();
const app = spawn(electron, [`--inspect=${process.env.JJ_INSPECT_PORT}`, '.', `--remote-debugging-port=${process.env.JJ_PAGE_PORT}`], {
  cwd: resolve(import.meta.dirname, '../..'),
  env: { ...process.env, HOME: home, PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, SHELL: '/usr/bin/false', JJ_NO_FOCUS: '1', JJ_SHOW: '', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
app.stdout.on('data', (b) => { logs += b; });
app.stderr.on('data', (b) => { logs += b; });
const { main, page, sleep, disconnect } = await import('./cdp.mjs');
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { try { if (await fn()) return; } catch {} await sleep(100); }
  throw new Error(`timeout: ${label}`);
}
let code = 0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  await main('__jj.settingsWindow.open("data"); 1');
  const settings = await page('settings');
  await until(() => settings.ev('!!document.querySelector("[data-tab=data]")'), 'settings');
  const reset = settings.ev(`(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(lang === 'ko' ? '설정 기본값으로' : 'Restore defaults')}))?.click())()`);
  await reset;
  await sleep(100);
  await settings.ev(`([...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(lang === 'ko' ? '한 번 더' : 'Click once more')}))?.click())`);
  await until(async () => (await main('__jj.settings.get().chatter')) === 'normal', 'reset settings');
  const state = await main('({chatter:__jj.settings.get().chatter,wander:__jj.settings.get().wander,name:__jj.settings.get().petName,ics:__jj.settings.get().icsUrl,lang:__jj.settings.get().lang})');
  assert.deepEqual(state, { chatter: 'normal', wander: true, name: 'Mochi', ics: 'https://example.test/calendar.ics', lang: 'auto' });
  await settings.shot(`${lang}-settings-reset-confirmed`);
  console.log('PASS settings reset defaults and preserves fairy identity/calendar link');

  // 초기화는 기본 언어(auto)로 돌아가므로, 만들기 안내를 검사하기 전에 원하는 언어를 다시 고른다.
  await main(`__jj.settings.set({lang:${JSON.stringify(lang)}}); 1`);
  await until(async () => (await main('__jj.settings.get().lang')) === lang, 'maker language');
  await settings.ev('window.jjakkungSettings.openMaker()');
  const maker = await page('maker');
  await until(() => maker.ev('!!document.querySelector(".maker")'), 'maker');
  await until(() => maker.ev('!!document.querySelector(".how button")'), 'maker methods');
  const details = await maker.ev(`(() => ({title:document.querySelector('header strong').textContent, tabs:[...document.querySelectorAll('.how button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled})), hint:document.querySelector('.how .hint')?.textContent.trim()}))()`);
  assert.ok(details.tabs.length === 3, JSON.stringify(details));
  assert.ok(details.tabs.some((t) => t.disabled) === (details.hint !== undefined), JSON.stringify(details));
  assert.equal(details.title, lang === 'ko' ? '사진으로 페어리 만들기' : 'Make a fairy from a photo', JSON.stringify(details));
  assert.equal(details.tabs[0].text, lang === 'ko' ? '사진 그대로' : 'Photo as is', JSON.stringify(details));
  if (details.hint)
    assert.match(details.hint, lang === 'ko' ? /Claude, Codex, Cursor, Gemini/ : /connect Claude, Codex, Cursor or Gemini/i);
  await maker.shot(`${lang}-maker-method-help`);
  console.log('PASS maker title/methods and unavailable AI explanation', JSON.stringify(details));
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  disconnect();
  const gone = new Promise((r) => app.once('exit', r));
  app.kill('SIGTERM');
  await Promise.race([gone, sleep(4000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
  writeFileSync(join(process.env.OUT, `${lang}-app.log`), logs);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
