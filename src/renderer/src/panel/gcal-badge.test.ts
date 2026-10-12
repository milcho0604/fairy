import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../../../shared/i18n/index.ts';
import { gcalBadge } from './gcal-badge.ts';

test('구글 표식: 상태마다 글과 툴팁 (ko)', () => {
  setLang('ko');
  assert.equal(gcalBadge('local', undefined, null), null);
  assert.deepEqual(
    [gcalBadge('local', 'sent', null)?.kind, gcalBadge('local', 'sent', null)?.label],
    ['sent', '구글'],
  );
  assert.equal(gcalBadge('local', 'failed', null)?.label, '못 보냄');
  assert.equal(gcalBadge('local', 'local', null)?.label, '페어리만');
  // 가져온 일정은 연결과 상관없이 가져옴 (구글 표식보다 앞선다)
  assert.equal(gcalBadge('ics', undefined, null)?.kind, 'imported');
  assert.equal(gcalBadge('ics', 'sent', null)?.kind, 'imported');
  // 보내는 중의 툴팁은 멈춘 까닭을 따른다
  const tip = (p: Parameters<typeof gcalBadge>[2]) => gcalBadge('local', 'pending', p)?.tip;
  assert.match(tip(null) ?? '', /차례/);
  assert.match(tip('offline') ?? '', /인터넷/);
  assert.match(tip('expired') ?? '', /설정/);
  assert.match(tip('calendar') ?? '', /설정/);
});

test('구글 표식: en 글이 다 있고 ko 와 다르다', () => {
  setLang('ko');
  const ko = (['sent', 'pending', 'failed', 'local'] as const).map((m) => gcalBadge('local', m, null));
  setLang('en');
  const en = (['sent', 'pending', 'failed', 'local'] as const).map((m) => gcalBadge('local', m, null));
  assert.deepEqual(
    en.map((b) => b?.label),
    ['Google', 'Sending', 'Not sent', 'Fairy only'],
  );
  for (const [i, b] of en.entries()) {
    assert.ok(b?.tip && b.tip !== ko[i]?.tip);
  }
  assert.equal(gcalBadge('ics', undefined, null)?.label, 'Imported');
  assert.match(gcalBadge('local', 'pending', 'offline')?.tip ?? '', /online/);
  setLang('ko');
});
