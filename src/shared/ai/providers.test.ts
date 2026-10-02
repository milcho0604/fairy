import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addQuestion, applyEvent, historyFor, initialChat } from '../chat-state.ts';
import { cursorArgs, cursorParser } from './cursor.ts';
import { notInstalled } from './errors.ts';
import { BUILTIN_PROVIDERS, customProvider, fillArgs, splitArgs } from './providers.ts';
import { stripAnsi, textPrompt } from './text.ts';

test('기본 제공 AI: 확인한 것은 claude, codex 뿐이고 id 가 겹치지 않는다', () => {
  const ids = BUILTIN_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    BUILTIN_PROVIDERS.filter((p) => p.verified).map((p) => p.id),
    ['claude', 'codex'],
  );
});

test('직접 추가: 인자를 나누고 {prompt} 가 없으면 끝에 붙인다', () => {
  const spec = customProvider({ label: 'Llama', bin: 'ollama', args: 'run llama3.2' }, 'custom-1');
  assert.ok(typeof spec !== 'string');
  if (typeof spec === 'string') return;
  assert.deepEqual(spec.args, ['run', 'llama3.2', '{prompt}']);
  assert.equal(spec.adapter, 'text');
  assert.equal(spec.images, false);
  assert.deepEqual(fillArgs(spec.args ?? [], '안녕 "친구"'), ['run', 'llama3.2', '안녕 "친구"']);
});

test('직접 추가: 잘못된 값은 이유를 돌려준다', () => {
  assert.equal(typeof customProvider({ label: '', bin: 'x', args: '' }, 'c'), 'string');
  assert.equal(typeof customProvider({ label: 'A', bin: 'ollama run', args: '' }, 'c'), 'string');
});

test('인자는 따옴표로 묶은 것을 하나로 본다', () => {
  assert.deepEqual(splitArgs(`-m "gpt 4" --system '짧게' {prompt}`), [
    '-m',
    'gpt 4',
    '--system',
    '짧게',
    '{prompt}',
  ]);
  assert.deepEqual(splitArgs('  '), []);
});

test('설치 안 됨 안내에 이름과 방법이 들어간다', () => {
  const e = notInstalled({ label: 'Gemini', installHint: 'Gemini CLI 를 설치해 줘.' });
  assert.equal(e.kind, 'not-installed');
  assert.equal(e.message, 'Gemini를 이 컴퓨터에서 못 찾았어. Gemini CLI 를 설치해 줘.');
});

test('cursor 명령: 읽기 전용 질문 모드, 첫 질문에만 성격 지시', () => {
  const first = cursorArgs({ text: 'q', persona: 'P' });
  assert.ok(first.includes('--mode') && first[first.indexOf('--mode') + 1] === 'ask');
  assert.equal(first.at(-1), 'P\n\nq');
  const next = cursorArgs({ text: 'q2', persona: 'P', sessionId: 's1' });
  assert.deepEqual(next.slice(-3), ['--resume', 's1', 'q2']);
});

test('cursor 출력: 전체 글로 오든 조각으로 오든 새 글만 보낸다 (형식 확인 전이라 둘 다)', () => {
  const asWhole = cursorParser();
  const msg = (text: string) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const whole = [msg('안'), msg('안녕'), msg('안녕!')].flatMap(asWhole);
  assert.deepEqual(
    whole.map((e) => (e.type === 'delta' ? e.text : '')),
    ['안', '녕', '!'],
  );
  const asPieces = cursorParser();
  const pieces = [msg('안'), msg('녕'), msg('!')].flatMap(asPieces);
  assert.deepEqual(
    pieces.map((e) => (e.type === 'delta' ? e.text : '')),
    ['안', '녕', '!'],
  );
  assert.deepEqual(asPieces(JSON.stringify({ type: 'result', subtype: 'success', result: '안녕!' })), [
    { type: 'done', text: '안녕!' },
  ]);
  assert.deepEqual(asPieces(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'c1' })), [
    { type: 'session', id: 'c1' },
  ]);
});

test('이어가기 없는 AI: 같은 AI 와 끝난 대화만 최근 4개 붙인다', () => {
  let s = initialChat('custom-1');
  for (let i = 1; i <= 6; i++) {
    s = addQuestion(s, { user: `u${i}`, pet: `p${i}` }, `질문${i}`, []);
    s = applyEvent(s, `p${i}`, { type: 'done', text: `답${i}` }, 'n');
  }
  s = addQuestion({ ...s, provider: 'claude' }, { user: 'u7', pet: 'p7' }, '다른 AI', []);
  const history = historyFor(s, 'custom-1');
  assert.equal(history.length, 6);
  const prompt = textPrompt('성격', history, '새 질문');
  assert.ok(prompt.startsWith('성격'));
  assert.ok(!prompt.includes('질문2') && prompt.includes('질문3') && prompt.includes('답6'));
  assert.ok(prompt.endsWith('사용자 질문: 새 질문'));
  assert.ok(!prompt.includes('다른 AI'));
});

test('터미널 색 코드를 지운다', () => {
  assert.equal(stripAnsi('\u001b[32m안녕\u001b[0m \u001b[2K'), '안녕 ');
});
