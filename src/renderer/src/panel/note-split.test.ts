// 메모 목록과 편집기를 나란히 볼 때(이슈 #163) 편집기가 "갈아 끼워지는" 순간에 글이 남는지 숫자로 잰다.
// 갈아 끼우기: 고치다 다른 메모를 누름, 곧바로 돌아옴, 창 닫기, 다른 곳이 먼저 고친 상태에서 닫기/갈아 끼우기.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoteKeep, type NoteKept, parseNoteKept } from '../../../shared/note-keep.ts';
import { mergeNoteText, staleNoteWrite } from '../../../shared/note-store.ts';
import {
  draftKeepOf,
  hasUnconfirmed,
  NoteSaver,
  openFromKept,
  SaveGate,
  type SaverApi,
} from './note-save.ts';

/** 메인(panel.ts noteUpdate)과 같은 판정을 하는 메모 여럿짜리 가짜 저장소. delay 는 느린 디스크 */
function fakeStore(initial: Record<number, string>, delay = 0) {
  let clock = 100;
  const notes = new Map(
    Object.entries(initial).map(([id, body]) => [Number(id), { body, updatedAt: clock }]),
  );
  const apiOf = (id: number): SaverApi => ({
    async update(patch, base) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const note = notes.get(id);
      if (!note) return { ok: false };
      if (staleNoteWrite(note, base?.at, patch.body, base?.body))
        return { ok: false, stale: true, error: 'stale' };
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
      const n = notes.get(id);
      return n ? { ...n } : undefined;
    },
  });
  const hooks = { saved() {}, failed() {}, blocked() {} };
  const saverOf = (id: number) => {
    const n = notes.get(id);
    assert.ok(n);
    return new NoteSaver(n.body, n.updatedAt, apiOf(id), hooks);
  };
  const elsewhere = (id: number, body: string) => {
    const n = notes.get(id);
    assert.ok(n);
    n.body = body;
    n.updatedAt = ++clock;
  };
  const bodies = () => Object.fromEntries([...notes].map(([id, n]) => [id, n.body]));
  return { apiOf, saverOf, elsewhere, bodies, hooks };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const NOW = 1_800_000_000_000;

test('고치다 다른 메모를 누르면: 앞 메모의 남은 글이 저장되고 다른 메모는 그대로다', async () => {
  const m = fakeStore({ 1: '장보기', 2: '회의록' }, 10);
  const gate = new SaveGate();
  const a = m.saverOf(1);
  a.save({ body: '장보기 우유 달걀' });
  // 다른 메모를 눌렀다: 앞 편집기가 닫히며 마지막 저장을 맡긴다
  gate.hold(1, a.flush());
  const b = m.saverOf(2);
  b.save({ body: '회의록 안건' });
  await gate.settle(1);
  await b.flush();
  assert.deepEqual(m.bodies(), { 1: '장보기 우유 달걀', 2: '회의록 안건' });
});

test('고치다 다른 메모를 눌렀다 곧바로 돌아와도 방금 쓴 글이 보이고 덮이지 않는다 (SaveGate)', async () => {
  const m = fakeStore({ 1: 'v0' }, 20);
  const gate = new SaveGate();
  const a = m.saverOf(1);
  a.save({ body: 'v0 +방금' });
  gate.hold(1, a.flush());
  // 돌아와 연 새 편집기: 맡긴 저장이 끝난 뒤에 읽는다
  await gate.settle(1);
  const again = await m.apiOf(1).get();
  assert.equal(again?.body, 'v0 +방금');
  assert.ok(again);
  const a2 = new NoteSaver(again.body, again.updatedAt, m.apiOf(1), m.hooks);
  a2.save({ body: 'v0 +방금 +더' });
  assert.equal(await a2.flush(), true);
  assert.equal(m.bodies()[1], 'v0 +방금 +더');
});

test('대조: 맡긴 저장을 기다리지 않고 읽으면 옛 글이 보인다 (SaveGate 가 막는 일)', async () => {
  const m = fakeStore({ 1: 'v0' }, 20);
  const a = m.saverOf(1);
  a.save({ body: 'v0 +방금' });
  const last = a.flush();
  const early = await m.apiOf(1).get();
  assert.equal(early?.body, 'v0');
  await last;
});

test('SaveGate: 맡긴 것이 없으면 바로, 같은 메모에 여러 번 맡기면 모두 끝난 뒤, 다른 메모는 기다리지 않는다', async () => {
  const gate = new SaveGate();
  const t0 = Date.now();
  await gate.settle(7);
  assert.ok(Date.now() - t0 < 20);
  let done1 = false;
  let done2 = false;
  gate.hold(
    1,
    tick(30).then(() => {
      done1 = true;
    }),
  );
  gate.hold(
    1,
    tick(60).then(() => {
      done2 = true;
    }),
  );
  gate.hold(2, Promise.reject(new Error('저장 실패')));
  await gate.settle(2);
  assert.equal(done1, false, '다른 메모를 기다리느라 늦지 않는다');
  await gate.settle(1);
  assert.deepEqual([done1, done2], [true, true]);
  // 끝난 것은 치워진다
  const t1 = Date.now();
  await gate.settle(1);
  assert.ok(Date.now() - t1 < 20);
});

test('다른 곳이 먼저 고친 메모를 두고 다른 메모로 갔다 와도 거절 상태와 내 글이 그 메모에 붙어 있다', async () => {
  const m = fakeStore({ 1: '처음 글', 2: '다른 메모' });
  const keep = createNoteKeep();
  const a = m.saverOf(1);
  m.elsewhere(1, '다른 곳이 바꾼 글');
  a.save({ body: '내 글' });
  assert.equal(await a.flush(), false);
  assert.equal(a.failed, true);
  assert.equal(a.conflict?.body, '다른 곳이 바꾼 글');
  // 다른 메모(B)를 눌렀다: A 편집기가 닫히며 보관 글을 맡긴다
  const k = draftKeepOf(a, { title: '', body: '내 글' });
  assert.ok(k);
  keep.set(1, { field: 'body', start: 0, end: 0, scroll: 0, at: NOW, ...k }, NOW);
  // B 를 열고 고치고 닫아도 A 의 보관 글은 그대로다
  const b = m.saverOf(2);
  b.save({ body: '다른 메모 고침' });
  assert.equal(await b.flush(), true);
  keep.set(2, { field: 'body', start: 0, end: 0, scroll: 0, at: NOW }, NOW);
  keep.set(2, null, NOW);
  const back = keep.get(1, NOW) as NoteKept;
  assert.equal(back.draft?.body, '내 글');
  assert.equal(back.conflict?.body, '다른 곳이 바꾼 글');
  // A 로 돌아왔다: 거절 상태 그대로 열리고 자동 저장하지 않는다
  const stored = await m.apiOf(1).get();
  assert.ok(stored);
  const resumed = openFromKept(back, { title: '', ...stored });
  assert.equal(resumed?.draft.body, '내 글');
  assert.ok(resumed?.conflict);
  assert.equal(resumed.conflict.body, '다른 곳이 바꾼 글');
  const again = m.saverOf(1);
  again.restore({ body: '내 글' }, resumed.conflict);
  assert.equal(await again.flush(), false);
  assert.equal(m.bodies()[1], '다른 곳이 바꾼 글', '고르기 전에는 어느 쪽도 덮지 않는다');
  // 내 글로 덮기를 고르면 그때 저장된다
  again.overwrite();
  assert.equal(await again.flush(), true);
  assert.equal(m.bodies()[1], '내 글');
  assert.equal(m.bodies()[2], '다른 메모 고침');
});

test('창을 닫는 순간 아직 보내지 않은 글: 확인 못 한 글이 있다고 보고 보관 글에 바탕까지 맡긴다', async () => {
  const m = fakeStore({ 1: '처음 글' });
  const a = m.saverOf(1);
  assert.equal(hasUnconfirmed(a), false);
  assert.equal(draftKeepOf(a, { title: '', body: '처음 글' }), undefined, '고친 것이 없으면 맡길 글도 없다');
  a.save({ body: '처음 글 + 닫기 직전' });
  assert.equal(hasUnconfirmed(a), true);
  const k = draftKeepOf(a, { title: '', body: '처음 글 + 닫기 직전' });
  assert.deepEqual(k?.base, { body: '처음 글', at: 100 });
  assert.equal(k?.conflict, undefined);
  // 보내는 중에도 답을 못 받았으니 확인 못 한 글이다
  const sending = a.flush();
  assert.equal(hasUnconfirmed(a), true, '보내기 직전');
  await Promise.resolve();
  assert.equal(a.sending, true);
  assert.equal(hasUnconfirmed(a), true);
  await sending;
  assert.equal(hasUnconfirmed(a), false);
});

test('창을 닫았고 저장이 됐다: 다시 열면 보관 글이 저장된 글과 같아 쓸 것이 없다 (자동으로 지워진다)', async () => {
  const m = fakeStore({ 1: '처음 글' });
  const a = m.saverOf(1);
  a.save({ body: '처음 글 + 닫기 직전' });
  const k = draftKeepOf(a, { title: '', body: '처음 글 + 닫기 직전' });
  await a.flush();
  const stored = await m.apiOf(1).get();
  assert.ok(stored);
  assert.equal(openFromKept(k, { title: '', ...stored }), undefined);
  assert.equal(m.bodies()[1], '처음 글 + 닫기 직전');
});

test('창을 닫는 순간 다른 곳이 먼저 고쳐 저장이 거절돼도 내 글은 보관 글에 남고, 다시 열면 덮지 않고 고르게 한다', async () => {
  const m = fakeStore({ 1: '처음 글' });
  const a = m.saverOf(1);
  a.save({ body: '내가 닫기 직전에 쓴 글' });
  // 닫히는 중: 보관 글을 맡기고, 그 사이 다른 곳이 먼저 통째로 고쳤다
  const k = draftKeepOf(a, { title: '', body: '내가 닫기 직전에 쓴 글' });
  m.elsewhere(1, '다른 곳이 통째로 바꾼 글');
  assert.equal(await a.flush(), false, '창은 이미 닫혀 거절을 볼 사람이 없다');
  assert.equal(m.bodies()[1], '다른 곳이 통째로 바꾼 글');
  // 다시 열기
  const stored = await m.apiOf(1).get();
  assert.ok(stored);
  const resumed = openFromKept(k, { title: '', ...stored });
  assert.equal(resumed?.draft.body, '내가 닫기 직전에 쓴 글');
  assert.equal(resumed?.conflict?.body, '다른 곳이 통째로 바꾼 글', '자동 저장하지 않고 고르게 한다');
});

test('보관 글만 있고 그사이 저장된 글이 바탕 그대로면(디스크 오류 등) 다시 저장한다', async () => {
  const m = fakeStore({ 1: '처음 글' });
  const k = { draft: { title: '', body: '내 글' }, base: { body: '처음 글', at: 100 } };
  const stored = await m.apiOf(1).get();
  assert.ok(stored);
  const r = openFromKept(k, { title: '', ...stored });
  assert.equal(r?.draft.body, '내 글');
  assert.equal(r?.conflict, undefined);
});

test('다른 곳이 먼저 고쳐 멈춘 글을 닫을 때는 그때 저장돼 있던 글(conflict)을 맡기고 바탕은 맡기지 않는다', async () => {
  const m = fakeStore({ 1: '처음 글' });
  const a = m.saverOf(1);
  m.elsewhere(1, '다른 곳 글');
  a.save({ body: '내 글' });
  await a.flush();
  const k = draftKeepOf(a, { title: '', body: '내 글' });
  assert.equal(k?.conflict?.body, '다른 곳 글');
  assert.equal(k?.base, undefined);
});

test('보관 글의 바탕(base)은 모양이 틀리면 버린다', () => {
  const raw = { id: 1, field: 'body', start: 0, end: 0, scroll: 0, at: NOW, draft: { title: '', body: 'x' } };
  assert.deepEqual(parseNoteKept({ ...raw, base: { body: 'b', at: 5 } }, NOW)?.base, { body: 'b', at: 5 });
  assert.equal(parseNoteKept({ ...raw, base: { body: 3, at: 5 } }, NOW)?.base, undefined);
  assert.equal(parseNoteKept({ ...raw, base: { body: 'b', at: -1 } }, NOW)?.base, undefined);
  // 글이 없는 보관 자리에는 바탕을 두지 않는다
  const { draft: _d, ...noDraft } = raw;
  assert.equal(parseNoteKept({ ...noDraft, base: { body: 'b', at: 5 } }, NOW)?.base, undefined);
});
