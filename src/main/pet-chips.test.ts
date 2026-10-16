import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STALE_AFTER_RESTORE } from '../shared/backup-import.ts';
import { IDLE } from '../shared/focus.ts';
import { setLang } from '../shared/i18n/index.ts';
import { DoingSet } from '../shared/pet-status.ts';
import { createPetChips } from './pet-chips.ts';

setLang('ko');

function chipsWith(openRef: { open: { id: number; title: string }[] }, doing: DoingSet) {
  return createPetChips({
    say: async () => undefined,
    store: { list: () => ({ open: openRef.open, doneToday: [] }), balance: () => 0 } as never,
    events: { between: () => [], timedOverlapping: () => [] } as never,
    stats: { diaryFacts: () => [] } as never,
    doing,
    focus: () => IDLE,
    doingOn: () => true,
  });
}

test('백업을 복원하면 진행 중 표시 파일(옛 저장 파일의 할 일 번호)을 지운다', () => {
  // 복원은 jjakkung.db 만 바꾸는데, doing.json 의 번호는 복원한 저장 파일에서 전혀 다른 할 일을 가리킨다
  assert.ok(STALE_AFTER_RESTORE.includes('doing.json'));
  // 지운 뒤 다시 켜면 표시가 비어 남의 할 일이 진행 중으로 뜨지 않는다
  const after = new DoingSet(undefined, () => {});
  const restored = { open: [{ id: 1, title: '장보기' }] };
  assert.equal(chipsWith(restored, after).statusNow(), null);
});

test('지운 할 일을 되돌리기로 살리면 진행 중 표시도 돌아온다', () => {
  const doing = new DoingSet([], () => {});
  const ref = { open: [{ id: 7, title: '보고서' }] };
  const chips = chipsWith(ref, doing);
  doing.set(7, true);
  assert.equal(chips.statusNow(), '▶ 진행 중: 보고서');
  ref.open = []; // 지움 (패널 갱신이나 10초 타이머가 말풍선 글을 다시 만든다)
  assert.equal(chips.statusNow(), null);
  ref.open = [{ id: 7, title: '보고서' }]; // 되돌리기
  assert.equal(chips.statusNow(), '▶ 진행 중: 보고서');
});
