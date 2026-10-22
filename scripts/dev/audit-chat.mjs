import { readFileSync } from 'node:fs';
import { main, page, sleep } from './cdp.mjs';

const thumb = `data:image/svg+xml;base64,${readFileSync(new URL('../../docs/assets/wf-chat.svg', import.meta.url)).toString('base64')}`;
const longUrl = 'https://example.com/' + 'a'.repeat(140) + '?q=' + 'b'.repeat(40);
const md = [
  '좋아, 정리해 볼게.',
  '',
  '- **첫째** 항목은 아주 길게 써서 줄이 바뀌는지 본다. 한국어 문장이 두 줄 세 줄로 넘어갈 때 목록 들여쓰기가 맞는지 확인하는 문장이야.',
  '- 둘째 `inline_code_with_a_very_long_identifier_name_that_should_wrap`',
  '1. 번호 목록',
  '',
  '```ts',
  'const veryLongLine = "' + 'x'.repeat(160) + '";',
  'function short() { return 1 }',
  '```',
  '',
  `링크: ${longUrl}`,
].join('\n');
const now = Date.now();
const state = {
  provider: 'claude',
  pendingId: 'w1',
  sessions: {},
  usage: { claude: { provider: 'claude', checkedAt: now - 7 * 60000, windows: [
    { label: '5시간', usedPercent: 86, resetsAt: Math.floor(now / 1000) + 2 * 3600 },
    { label: '7일', usedPercent: 97, resetsAt: Math.floor(now / 1000) + 3 * 86400 } ] } },
  messages: [
    { id: 'u1', role: 'user', text: '이건 사용자가 쓴 아주 긴 질문이야. '.repeat(6) + longUrl },
    { id: 'p1', role: 'pet', provider: 'claude', status: 'done', text: md },
    { id: 'u2', role: 'user', text: '그림 세 장', images: [{ thumb }, { thumb }, { thumb }] },
    { id: 'p2', role: 'pet', provider: 'codex', status: 'error', text: '', error: { kind: 'rate-limit', message: 'Codex 사용 한도에 걸렸어. 7:48 PM 이후에 다시 물어봐 줘.', retryAt: '7:48 PM' } },
    { id: 'u3', role: 'user', text: '멈춰 봐' },
    { id: 'p3', role: 'pet', provider: 'claude', status: 'error', text: '앞부분만 오다가', error: { kind: 'cancelled', message: '질문을 멈췄어.' } },
    { id: 'n1', role: 'notice', text: '대화가 길어졌어. 이어 갈수록 답이 느려지고 한도도 빨리 써. 새 대화로 시작하면 가벼워져.' },
    { id: 'u4', role: 'user', text: '마지막 질문' },
    { id: 'w1', role: 'pet', provider: 'claude', status: 'waiting', text: '' },
  ],
};

// SURFACE=home 이면 큰 창 안에 품은 채팅(이슈 #165)에서 돈다: 큰 창을 열고 채팅 구역으로. 큰 창은 760 보다 좁아지지 않아 채팅 폭은 552 이상이다
const HOME = process.env.SURFACE === 'home';
const size = (w, h) =>
  main(HOME ? `__jj.home.window.setSize(${Math.max(w + 208, 760)}, ${Math.max(h + 52, 520)}); 1` : `__jj.chat.window.setSize(${w}, ${h}); 1`);
if (HOME) {
  await main(`__jj.settings.set({ panelView: 'window' }); __jj.home.open('today'); 1`);
  await sleep(2500);
}
await main(`__jj.chat.open(__jj.pet.bounds()); 1`);
await sleep(2500);
await main(`__jj.chat.debugSetState(() => (${JSON.stringify(state)})); 1`);
const chat = await page('chat');
await sleep(800);
for (const [w, h] of [[400, 640], [320, 520]]) {
  await size(w, h);
  await sleep(500);
  await chat.ev(`document.querySelector('.messages').scrollTop = 0`);
  await chat.dark(false); await sleep(200); await chat.shot(`chat-${w}-top-light`);
  await chat.dark(true); await sleep(200); await chat.shot(`chat-${w}-top-dark`);
  await chat.ev(`document.querySelectorAll('.msg.user')[1].scrollIntoView({ block: 'center' })`);
  await sleep(200); await chat.shot(`chat-${w}-mid-dark`);
  await chat.ev(`document.querySelector('.messages').scrollTop = 1e6`);
  await sleep(200); await chat.shot(`chat-${w}-bottom-dark`);
  await chat.dark(false); await sleep(200); await chat.shot(`chat-${w}-bottom-light`);
  // 가로 넘침 점검: 어떤 요소든 창보다 넓으면 기록
  const over = await chat.ev(`[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('pre')).map(e => e.tagName + '.' + e.className).slice(0, 8).join(', ')`);
  console.log(`${w}px 가로로 넘친 요소:`, over || '없음');
}
await size(400, 640);
// 빈 화면, AI 고르기, 관리 화면
await main(`__jj.chat.debugSetState((s) => ({ ...s, pendingId: undefined, messages: [] })); 1`);
await sleep(400); await chat.shot('chat-empty-light');
await chat.ev(`document.querySelector('.picker-button').click()`); await sleep(300); await chat.shot('chat-picker-light');
await chat.dark(true); await sleep(200); await chat.shot('chat-picker-dark'); await chat.dark(false);
await chat.ev(`[...document.querySelectorAll('.picker-menu button')].at(-1).click()`); await sleep(300);
await chat.ev(`window.jjakkungChat.addProvider({ label: '아주 긴 이름의 사용자 AI 도구 이름 테스트', bin: 'ollama', args: 'run llama3.2-vision:90b-instruct-q4_K_M --system "짧게 답해" --temperature 0.2 {prompt}' })`);
await chat.ev(`document.querySelector('.sheet-head button').click()`); await sleep(1500);
await chat.shot('chat-manager-light');
await chat.dark(true); await sleep(200); await chat.shot('chat-manager-dark'); await chat.dark(false);
await chat.ev(`document.querySelector('.sheet').scrollTop = 1e6`); await sleep(200); await chat.shot('chat-manager-form');
// 넣은 AI 빼기
await chat.ev(`[...document.querySelectorAll('.ai-list li')].find(l => l.innerText.includes('아주 긴 이름'))?.querySelector('button')?.click()`); await sleep(500);
await chat.ev(`[...document.querySelectorAll('.sheet-head button')].at(-1).click()`); await sleep(300);
// 없는 AI 고르면 배너
await chat.ev(`document.querySelector('.picker-button').click()`); await sleep(200);
await chat.ev(`[...document.querySelectorAll('.picker-menu button')].find(b => b.innerText.startsWith('Gemini')).click()`); await sleep(500);
await chat.shot('chat-banner-light');
await chat.ev(`document.querySelector('.picker-button').click()`); await sleep(200);
await chat.ev(`[...document.querySelectorAll('.picker-menu button')].find(b => b.innerText.startsWith('Claude')).click()`); await sleep(300);
console.log('남은 직접 추가 AI:', await chat.ev(`window.jjakkungChat.providers().then(l => l.filter(p => p.custom).length)`));
process.exit(0);
