import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { addQuestion, applyEvent, initialChat, resetChat } from '../chat-state.ts';
import { parseClaudeLine } from './claude.ts';
import { codexUsage, lastCodexLimits, resetText, usageLevel } from './usage.ts';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('claude 실제 rate_limit_event (2026-10-02): 5시간 48%, 7일 61%', () => {
  const [e] = parseClaudeLine(read('claude-rate-limit.json'));
  assert.equal(e?.type, 'usage');
  if (e?.type !== 'usage') return;
  assert.equal(e.usage.provider, 'claude');
  assert.deepEqual(
    e.usage.windows.map((w) => [w.label, w.usedPercent, w.resetsAt]),
    [
      ['5시간', 48, 1790900400],
      ['7일', 61, 1791262800],
    ],
  );
});

test('codex 실제 대화 기록 끝부분: 5시간 27%, 7일 58%, plus', () => {
  const usage = codexUsage(lastCodexLimits(`앞 줄\n${read('codex-rollout-tail.jsonl')}`), 1);
  assert.deepEqual(
    usage?.windows.map((w) => [w.label, w.usedPercent]),
    [
      ['5시간', 27],
      ['7일', 58],
    ],
  );
  assert.equal(usage?.plan, 'plus');
});

test('기록에 사용량이 없거나 깨졌으면 모름', () => {
  assert.equal(lastCodexLimits('{"type":"x"}\n깨진 줄 "rate_limits"'), undefined);
  assert.equal(codexUsage(undefined, 1), undefined);
  assert.deepEqual(parseClaudeLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} })), []);
});

test('초기화까지 남은 때', () => {
  const now = Date.UTC(2026, 9, 2, 0, 0);
  assert.equal(resetText(now / 1000 + 30 * 60, now), '30분 뒤 초기화');
  assert.equal(resetText(now / 1000 + 3 * 3600, now), '3시간 뒤 초기화');
  assert.match(resetText(now / 1000 + 3 * 86400, now), /^[일월화수목금토] \d\d:\d\d 초기화$/);
  assert.equal(resetText(now / 1000 - 5, now), '곧 초기화');
  assert.equal(resetText(undefined, now), '');
});

test('80% 부터 주의, 95% 부터 거의 다 씀', () => {
  assert.deepEqual([usageLevel(79), usageLevel(80), usageLevel(95)], ['ok', 'warn', 'full']);
});

test('사용량은 대화 상태에 남고, 답이 끝난 뒤 와도, 새 대화를 열어도 남는다', () => {
  const usage = { provider: 'codex' as const, windows: [{ label: '5시간', usedPercent: 10 }], checkedAt: 1 };
  let s = addQuestion(initialChat('codex'), { user: 'u', pet: 'p' }, 'q', []);
  s = applyEvent(s, 'p', { type: 'done', text: 'a' }, 'n');
  s = applyEvent(s, 'p', { type: 'usage', usage }, 'n');
  assert.equal(s.usage.codex, usage);
  assert.equal(resetChat(s).usage.codex, usage);
});
