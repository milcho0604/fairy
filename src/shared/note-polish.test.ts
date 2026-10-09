import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanPolished,
  createPolishJobs,
  POLISH_FENCE,
  POLISH_KEEP_MS,
  type PolishReply,
  polishRequest,
  splicePolished,
} from './note-polish.ts';
import { NOTE_BODY_MAX } from './note-store.ts';

test('원문을 경계 줄 사이에 넣어 보낸다', () => {
  assert.equal(polishRequest('다듬어 줘', '안녕'), `다듬어 줘\n${POLISH_FENCE}\n안녕\n${POLISH_FENCE}`);
});

test('답에서 머리말, 경계 줄, 코드 칸 감싸기를 걷는다', () => {
  assert.equal(cleanPolished('다듬은 글:\n좋은 글이야.', '원문'), '좋은 글이야.');
  assert.equal(cleanPolished("Here's the polished version:\nNice.", 'x'), 'Nice.');
  assert.equal(cleanPolished(`${POLISH_FENCE}\n가나다\n${POLISH_FENCE}`, '원문'), '가나다');
  assert.equal(cleanPolished('```markdown\n# 제목\n- 하나\n```', '# 제목'), '# 제목\n- 하나');
  // 원문이 코드 칸이면 그대로
  assert.equal(cleanPolished('```js\nx()\n```', '```js\nx( )\n```'), '```js\nx()\n```');
  assert.equal(cleanPolished('  \n ', '원문'), undefined);
  assert.equal(cleanPolished(undefined, '원문'), undefined);
});

test('마크다운 본문은 건드리지 않는다', () => {
  const md = '# 회의\n\n- 결정: 금요일 배포\n- 담당: 민수';
  assert.equal(cleanPolished(md, md), md);
});

test('고른 부분만 바꾸거나 전체를 바꾼다', () => {
  assert.equal(splicePolished('앞 가운데 뒤', 2, 5, '중간'), '앞 중간 뒤');
  assert.equal(splicePolished('전체 글', 0, 0, '새 글'), '새 글');
  assert.equal(splicePolished('전체 글', 3, 3, '새 글'), '새 글');
});

test('원문 첫 줄, 끝 줄에 있던 머리말과 구분선은 남긴다', () => {
  const src = '결과:\n금요일에 배포한다';
  assert.equal(cleanPolished('결과:\n금요일에 배포해요.', src), '결과:\n금요일에 배포해요.');
  const en = "Here's what we decided:\n- ship on friday";
  assert.equal(cleanPolished(en, en), en);
  const ruled = '-----\n회의 메모\n-----';
  assert.equal(cleanPolished(ruled, ruled), ruled);
  // 원문 첫 줄과 다른 머리말은 걷는다
  assert.equal(cleanPolished('다듬은 글:\n결과:\n배포', '결과:\n배포'), '결과:\n배포');
  // 원문 끝에만 구분선이 있으면 앞에 따라 쓴 경계 줄은 걷고 끝 줄은 남긴다
  assert.equal(cleanPolished(`${POLISH_FENCE}\n메모\n-----`, '메모\n-----'), '메모\n-----');
});

test('메모 한도를 넘으면 자르지 않고 바꾸지 않는다', () => {
  const long = 'a'.repeat(NOTE_BODY_MAX);
  assert.equal(cleanPolished(`${long}b`, '짧은 글'), `${long}b`);
  assert.equal(splicePolished('짧은 글', 0, 0, `${long}b`), undefined);
  assert.equal(splicePolished(`${long.slice(1)}x`, 0, 1, 'yy'), undefined);
  assert.equal(splicePolished(long, 0, 0, long), long);
});

test('메모마다 다듬기는 하나만 돌고, 받을 창이 없으면 들고 있다가 넘긴다', async () => {
  let now = 0;
  const jobs = createPolishJobs(() => now);
  let calls = 0;
  let finish: (r: PolishReply) => void = () => {};
  const run = () => {
    calls++;
    return new Promise<PolishReply>((r) => {
      finish = r;
    });
  };
  const a = jobs.start(1, run);
  const b = jobs.start(1, run);
  assert.equal(calls, 1, '같은 메모를 다시 눌렀더니 AI 를 또 불렀다');
  assert.equal(a, b);
  assert.equal(jobs.state(1), 'busy');
  jobs.start(2, run);
  assert.equal(calls, 2);
  // 2번 메모가 끝났는데 받아 간 창이 없다 (1번은 아직 도는 중)
  finish({ ok: true, text: '다듬은', body: '원문', start: 0, end: 0 });
  await jobs.get(2)?.done;
  assert.equal(jobs.state(1), 'busy');
  assert.equal(jobs.state(2), 'ready', '받을 창이 없는데 답을 버렸다');
  const job2 = jobs.get(2);
  assert.ok(job2);
  assert.deepEqual(await job2.done, { ok: true, text: '다듬은', body: '원문', start: 0, end: 0 });
  jobs.taken(2);
  // 아직 도는 것은 받았다고 해도 지우지 않는다
  jobs.taken(1);
  assert.equal(jobs.state(1), 'busy');
  assert.equal(jobs.state(2), 'none');
  // 실패는 들고 있지 않는다
  const c = jobs.start(3, async () => ({ ok: false, error: 'fail' }));
  await c.done;
  assert.equal(jobs.state(3), 'none');
  // 오래 들고 있던 답은 버린다
  const ready: PolishReply = { ok: true, text: 'x', body: 'y', start: 0, end: 0 };
  const d = jobs.start(4, async () => ready);
  await d.done;
  assert.equal(jobs.state(4), 'ready');
  now += POLISH_KEEP_MS + 1;
  assert.equal(jobs.state(4), 'none');
});
