import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeNoteText, staleNoteWrite } from '../../../shared/note-store.ts';
import { type NoteResult, NoteSaver, type SaverApi } from './note-save.ts';

/** 메인(panel.ts noteUpdate)과 같은 판정을 하는 가짜 저장소. delay 는 느린 디스크 */
function fakeMain(body: string, updatedAt: number, delay = 0) {
  const note = { body, updatedAt };
  let clock = updatedAt;
  const calls: { patch: { body?: string }; base?: { body: string; at: number } }[] = [];
  const api: SaverApi = {
    async update(patch, base) {
      calls.push({ patch, ...(base ? { base } : {}) });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (staleNoteWrite(note, base?.at, patch.body, base?.body))
        return { ok: false, stale: true, error: '먼저 고쳤어' };
      if (patch.body !== undefined) {
        note.body = base ? mergeNoteText(base.body, patch.body, note.body) : patch.body;
        note.updatedAt = ++clock;
      }
      return {
        ok: true,
        updatedAt: note.updatedAt,
        ...(note.body !== patch.body ? { body: note.body } : {}),
      };
    },
    async get() {
      return { ...note };
    },
  };
  const elsewhere = (b: string) => {
    note.body = b;
    note.updatedAt = ++clock;
  };
  return { note, calls, api, elsewhere };
}

const hooks = () => {
  const log: string[] = [];
  return {
    log,
    h: {
      saved: () => void log.push('saved'),
      failed: (_r: NoteResult, conflict: boolean) => void log.push(conflict ? 'conflict' : 'failed'),
      blocked: () => void log.push('blocked'),
    },
  };
};

test('겹친 저장: 혼자 고쳐도 거절되지 않고 마지막 글이 저장된다 (첫 저장이 끝난 뒤 그 시각을 바탕으로 둘째가 간다)', async () => {
  const m = fakeMain('line one', 100, 30);
  const { h, log } = hooks();
  const s = new NoteSaver('line one', 100, m.api, h);
  s.save({ body: 'line one X' });
  const a = s.flush();
  await new Promise((r) => setTimeout(r, 5));
  // 첫 저장이 가는 중에 더 쓰고 바로 또 보낸다 (탭 이동, Esc)
  s.save({ body: 'line one X Y' });
  const b = s.flush();
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(m.note.body, 'line one X Y');
  assert.deepEqual(log, ['saved', 'saved']);
  assert.equal(m.calls.length, 2);
  // 둘째는 첫 저장의 결과(시각 101, 본문 'line one X')를 바탕으로 보냈다
  assert.deepEqual(m.calls[1]?.base, { body: 'line one X', at: 101 });
});

test('겹친 저장: 보낼 것이 없는 flush 는 보내지 않는다', async () => {
  const m = fakeMain('a', 1);
  const s = new NoteSaver('a', 1, m.api, hooks().h);
  s.save({ body: 'ab' });
  await Promise.all([s.flush(), s.flush(), s.flush()]);
  assert.equal(m.calls.length, 1);
});

test('다른 곳이 먼저 고쳐 거절되면 멈추고, 고르기 전에는 다음 글자가 와도 덮지 않는다', async () => {
  const m = fakeMain('처음 글', 100);
  const { h, log } = hooks();
  const s = new NoteSaver('처음 글', 100, m.api, h);
  m.elsewhere('다른 곳이 바꾼 글');
  s.save({ body: '내 글' });
  assert.equal(await s.flush(), false);
  assert.deepEqual(log, ['conflict']);
  assert.equal(s.conflict?.body, '다른 곳이 바꾼 글');
  // 글자를 더 쳐도 (자동 저장, 뒤로 가기) 보내지 않는다
  s.save({ body: '내 글!' });
  assert.equal(await s.flush(), false);
  assert.equal(await s.flush(), false);
  assert.equal(m.calls.length, 1);
  assert.equal(m.note.body, '다른 곳이 바꾼 글');
  assert.deepEqual(s.pending, { body: '내 글!' }, '내 글은 보관돼 있다');
  assert.deepEqual(log.slice(1), ['blocked', 'blocked']);
});

test('거절 뒤 "내 글로 덮기"를 고르면 그때 저장된다', async () => {
  const m = fakeMain('처음 글', 100);
  const s = new NoteSaver('처음 글', 100, m.api, hooks().h);
  m.elsewhere('다른 곳이 바꾼 글');
  s.save({ body: '내 글' });
  await s.flush();
  s.overwrite();
  assert.equal(s.conflict, undefined);
  assert.equal(await s.flush(), true);
  assert.equal(m.note.body, '내 글');
});

test('저장이 던지면 실패로 두고 글은 들고 있는다 (충돌 아님)', async () => {
  const { h, log } = hooks();
  const s = new NoteSaver(
    'a',
    1,
    { update: () => Promise.reject(new Error('x')), get: async () => undefined },
    h,
  );
  s.save({ body: 'ab' });
  assert.equal(await s.flush(), false);
  assert.deepEqual(log, ['failed']);
  assert.deepEqual(s.pending, { body: 'ab' });
  assert.equal(s.conflict, undefined);
});
