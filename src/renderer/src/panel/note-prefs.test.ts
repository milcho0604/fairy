import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FORMAT_KEY,
  MODE_KEY,
  type PrefStore,
  savedFormat,
  savedMode,
  saveFormat,
  saveMode,
} from './note-prefs.ts';

const fake = (): PrefStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};
const broken: PrefStore = {
  getItem: () => {
    throw new Error('막힌 저장소');
  },
  setItem: () => {
    throw new Error('가득 참');
  },
};

test('새 메모 형식: 고른 적이 없으면 txt, 고른 뒤에는 그 값이 다시 열어도 남는다', () => {
  const s = fake();
  assert.equal(savedFormat(s), 'txt');
  saveFormat('md', s);
  assert.equal(s.data.get(FORMAT_KEY), 'md');
  assert.equal(savedFormat(s), 'md');
  saveFormat('txt', s);
  assert.equal(savedFormat(s), 'txt');
});

test('편집과 미리보기: 고른 적이 없으면 편집, 미리보기를 고르면 남는다', () => {
  const s = fake();
  assert.equal(savedMode(s), 'edit');
  saveMode('preview', s);
  assert.equal(s.data.get(MODE_KEY), 'preview');
  assert.equal(savedMode(s), 'preview');
  saveMode('edit', s);
  assert.equal(savedMode(s), 'edit');
});

test('깨진 값은 기본값으로 읽고, 이상한 값은 적지 않는다', () => {
  const s = fake();
  s.data.set(FORMAT_KEY, 'rtf');
  s.data.set(MODE_KEY, '???');
  assert.equal(savedFormat(s), 'txt');
  assert.equal(savedMode(s), 'edit');
  saveFormat('docx' as never, s);
  assert.equal(s.data.get(FORMAT_KEY), 'txt');
  saveMode('zoom' as never, s);
  assert.equal(s.data.get(MODE_KEY), 'edit');
});

test('저장소를 못 쓰면(막힘, 가득 참, 없음) 던지지 않고 기본값', () => {
  assert.equal(savedFormat(broken), 'txt');
  assert.equal(savedMode(broken), 'edit');
  assert.doesNotThrow(() => saveFormat('md', broken));
  assert.doesNotThrow(() => saveMode('preview', broken));
});
