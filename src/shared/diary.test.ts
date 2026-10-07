import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { StatStore } from './beta-stats.ts';
import { type Db, migrate } from './db-schema.ts';
import { acceptPolished, type DiaryFacts, daySeed, diaryText, hasDiary } from './diary.ts';
import { setLang } from './i18n/index.ts';
import { TodoStore } from './todo-store.ts';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 6, 9, 0); // 2026-10-06 09:00
const blank: DiaryFacts = {
  day: '2026-10-06',
  onMin: 0,
  done: 0,
  focusMin: 0,
  walkMin: 0,
  lookCount: 0,
  fed: 0,
};

test('일기: 끝낸 수, 눈에 띄는 일 하나(집중, 산책, 밥, 같이 보기 순), 맺음말', () => {
  setLang('ko');
  const many = diaryText({ ...blank, onMin: 300, done: 6, focusMin: 50, walkMin: 5, fed: 2 });
  assert.match(many, /^오늘 할 일을 6개나 끝냈다\. 정말 대단하다\. 50분 동안 같이 집중했다\./);
  assert.ok(!many.includes('산책'));
  const walk = diaryText({ ...blank, onMin: 60, done: 1, focusMin: 10, walkMin: 5, fed: 2 });
  assert.match(walk, /^오늘 할 일을 1개 끝냈다\. 같이 5분 산책했다\./);
  const fed = diaryText({ ...blank, onMin: 60, fed: 2, lookCount: 1 });
  assert.match(fed, /^오늘은 할 일 없이 느긋하게 보냈다\. 밥을 2번 먹었다\./);
  const look = diaryText({ ...blank, onMin: 60, lookCount: 3 });
  assert.match(look, /같이 화면을 3번 들여다봤다\./);
  // 할 일, 눈에 띄는 일 하나, 맺음말 세 덩이라 길지 않다
  assert.ok(many.length < 120, many);
});

test('같은 날은 늘 같은 글, 다른 날은 맺음말이 바뀐다', () => {
  setLang('ko');
  const f = { ...blank, onMin: 60, done: 2 };
  assert.equal(diaryText(f), diaryText({ ...f }));
  const ends = new Set(
    Array.from({ length: 14 }, (_, i) =>
      diaryText({ ...f, day: `2026-10-${String(i + 1).padStart(2, '0')}` }),
    ),
  );
  assert.ok(ends.size >= 3, `${ends.size}`);
  assert.ok(daySeed('2026-10-06') >= 0 && daySeed('2026-10-06') < 1);
});

test('영어 일기는 단수와 복수가 맞다', () => {
  setLang('en');
  assert.match(
    diaryText({ ...blank, onMin: 10, done: 1, fed: 1 }),
    /^Finished one to-do today\. Had one tasty meal\./,
  );
  assert.match(
    diaryText({ ...blank, onMin: 10, done: 2, lookCount: 1 }),
    /^Finished 2 to-dos today\. We looked at the screen together once\./,
  );
  setLang('ko');
});

test('기록이 없는 날은 일기가 없다', () => {
  assert.equal(hasDiary(blank), false);
  assert.equal(hasDiary({ ...blank, onMin: 1 }), true);
  assert.equal(hasDiary({ ...blank, fed: 1 }), true);
});

test('AI 가 다듬은 글: 숫자를 지키고 짧아야 쓴다', () => {
  const src = '오늘 할 일을 6개 끝냈다. 50분 동안 같이 집중했다.';
  assert.equal(
    acceptPolished(src, '"오늘은 할 일 6개를 해치웠어!\n50분이나 같이 집중했지."'),
    '오늘은 할 일 6개를 해치웠어! 50분이나 같이 집중했지.',
  );
  // 숫자가 바뀌거나 빠지면 버린다
  assert.equal(acceptPolished(src, '오늘 할 일 7개를 끝냈어. 50분 집중!'), undefined);
  assert.equal(acceptPolished(src, '오늘 많이 했어!'), undefined);
  assert.equal(acceptPolished(src, '   '), undefined);
  assert.equal(acceptPolished(src, `6 50 ${'아'.repeat(300)}`), undefined);
});

test('일기 기록은 그날 숫자만 센다 (끝낸 할 일, 밥, 집중, 산책, 같이 보기)', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const stats = new StatStore(db, utcDay);
  const todos = new TodoStore(db, utcDay);
  const a = todos.add({ title: '비밀 회의록' }, T0);
  todos.complete(a.id, T0);
  todos.complete(todos.add({ title: 'x' }, T0).id, T0 - 86_400_000);
  stats.tick(T0, false);
  stats.addFocus(T0, 25);
  stats.addWalk(T0, 5);
  stats.countLook(T0);
  todos.reward(20, 'test', T0);
  todos.feed(T0);
  const [yesterday, today] = stats.diaryFacts(['2026-10-05', '2026-10-06']);
  assert.deepEqual(today, {
    day: '2026-10-06',
    onMin: 1,
    done: 1,
    focusMin: 25,
    walkMin: 5,
    lookCount: 1,
    fed: 1,
  });
  assert.deepEqual(yesterday, { ...blank, day: '2026-10-05', done: 1 });
  // 할 일 제목은 일기에 들어가지 않는다
  assert.ok(!JSON.stringify(today).includes('비밀'));
  assert.ok(!diaryText(today as DiaryFacts).includes('비밀'));
  assert.deepEqual(stats.diaryFacts([]), []);
});

test('오늘 일기는 아직 쓰는 중이라 맺음말이 없다', () => {
  setLang('ko');
  const f = { ...blank, onMin: 30, done: 2 };
  assert.equal(diaryText(f, true), '오늘 할 일을 2개 끝냈다.');
  assert.ok(diaryText(f).length > diaryText(f, true).length);
});

test('작은 모델이 지어낸 글과 단위를 바꾼 글은 버린다 (무료 AI 실측)', () => {
  // 2026-10-07 Qwen3 1.7B 로 다듬은 실제 답
  const good = acceptPolished(
    '오늘 할 일을 4개 끝냈다. 50분 동안 같이 집중했다. 나는 옆에서 꾸벅꾸벅 졸았다. 좋은 하루였다.',
    '오늘은 4개의 일을 완료했어. 50분 동안 집중했고, 옆에서 꾸벅꾸벅 졸아서 좋은 하루였네.',
  );
  assert.ok(good);
  // "1개" 가 "1일" 이 됐다
  assert.equal(
    acceptPolished(
      '오늘 할 일을 1개 끝냈다. 같이 10분 산책했다. 바깥 공기가 좋았다. 내일도 같이 해야지.',
      '1일을 끝냈다. 함께 10분 산책했어. 바깥 공기가 좋았구나. 내일도 같이 해야지.',
    ),
    undefined,
  );
  // 숫자가 없는 글에 없는 이야기를 지어냈다
  assert.equal(
    acceptPolished(
      '오늘은 할 일 없이 느긋하게 보냈다. 오늘도 고마운 하루였다.',
      '오늘도 놀이를 하고 싶은데, 나만 그런 거야. 네가 더 편하게 할 수 있어.',
    ),
    undefined,
  );
  // 숫자가 없는 날은 다듬지 않는다 (3차 실측: "조금만 쉬면 안전하게 일해볼 수 있을까?")
  assert.equal(
    acceptPolished(
      '오늘은 할 일 없이 느긋하게 보냈다. 오늘도 고마운 하루였다.',
      '오늘도 고마운 하루였다. 조금만 쉬면 안전하게 일해볼 수 있을까?',
    ),
    undefined,
  );
  // 원래 글은 지켰지만 없는 말을 더 많이 붙였다 (2차 실측)
  assert.equal(
    acceptPolished(
      '오늘은 할 일 없이 느긋하게 보냈다. 오늘도 고마운 하루였다.',
      '오늘도 고마운 하루였어. 데스크톱 펫이랑 함께 잘한 날이었어.',
    ),
    undefined,
  );
  assert.ok(
    acceptPolished(
      '오늘 할 일을 6개나 끝냈다. 정말 대단하다. 25분 동안 같이 집중했다. 나는 옆에서 꾸벅꾸벅 졸았다. 내일도 같이 해야지.',
      '오늘 할 일을 6개 끝내고, 25분 동안 함께 집중했어. 내일도 같이 해야지!',
    ),
  );
  // 영어도 단위째 본다
  assert.ok(acceptPolished('We focused for 50 minutes.', 'We focused together for 50 minutes!'));
  assert.equal(acceptPolished('We focused for 50 minutes.', 'We focused for 50 hours.'), undefined);
});
