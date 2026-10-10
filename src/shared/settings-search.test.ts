import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupRows, searchSettings } from './settings-search.ts';

const sections = [
  { title: '펫', rows: ['이름 메뉴에는 콩이처럼 보여', '크기 100%', '효과음 작은 소리를 내'] },
  { title: '단축키', rows: ['숨기기, 다시 보이기 Cmd Option Shift H', '대화 창 열기'] },
  { title: 'AI', rows: ['성격과 말투', 'Claude 모델'] },
];

test('빈 말이면 모두 보인다', () => {
  for (const q of ['', '   ']) {
    const r = searchSettings(sections, q);
    assert.ok(r.every((s) => s.show && s.rows.every(Boolean)));
  }
});

test('줄에서 찾으면 그 줄만, 칸 제목에서 찾으면 칸 전부', () => {
  const r = searchSettings(sections, '효과음');
  assert.deepEqual(
    r.map((s) => s.show),
    [true, false, false],
  );
  assert.deepEqual(r[0]?.rows, [false, false, true]);
  const k = searchSettings(sections, '단축키');
  assert.deepEqual(k[1], { show: true, rows: [true, true] });
});

test('대소문자 무시, 낱말마다 따로 (칸 제목과 줄을 합쳐 본다)', () => {
  assert.deepEqual(searchSettings(sections, 'claude')[2]?.rows, [false, true]);
  const r = searchSettings(sections, '펫 크기');
  assert.deepEqual(r[0]?.rows, [false, true, false]);
  assert.equal(r[1]?.show, false);
});

test('조합 중인 마지막 글자도 맞는다 ("효과" + "ㅇ")', () => {
  assert.equal(searchSettings(sections, '효과ㅇ', true)[0]?.show, true);
  assert.equal(searchSettings(sections, '효과ㅇ', false)[0]?.show, false);
});

test('없는 말이면 다 숨긴다', () => {
  assert.ok(searchSettings(sections, '없는설정').every((s) => !s.show));
});

test('풀이 글은 앞 줄에, 풀이 뒤 단추 줄은 그 풀이에 붙는다', () => {
  assert.deepEqual(groupRows(['other', 'small', 'other']), [0, 0, 1]);
  assert.deepEqual(groupRows(['small', 'action', 'small', 'action']), [0, 0, 0, 0]);
  assert.deepEqual(groupRows(['other', 'action']), [0, 1]);
  assert.deepEqual(groupRows([]), []);
});
