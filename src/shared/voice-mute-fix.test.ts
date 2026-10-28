import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canDeliverEvening,
  composeNote,
  EMPTY_NOTES,
  EVENING_GAP_MIN,
  fileNote,
  NOTE_VARIANTS,
  parseNotes,
} from './daily-note.ts';
import { pickLine as pickFun, pickJoke } from './fun.ts';
import { dicts, setLang, setMutedLines, t } from './i18n/index.ts';
import { voiced, voicedLive } from './persona-voice.ts';
import { sulkLine } from './pet-life.ts';
import { poutLines } from './pout.ts';
import { farewellText, greetText, restText } from './routine-text.ts';
import { DEFAULT_STYLE, type SpeechStyle } from './speech-style.ts';

const loose = t as unknown as (key: string, vars?: Record<string, string | number>) => string;
const mute = (ko: string[]) => setMutedLines({ ko, en: [] });
const unmute = () => setMutedLines({ ko: [], en: [] });

test('주간 편지 여는 말은 요일을 단정하지 않는다 (화, 수요일에도 온다)', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const p of ['friend', 'polite', 'tsundere', 'calm']) {
      for (let v = 1; v <= NOTE_VARIANTS.weekOpen; v++) {
        const out = loose('note.week.open', { p, v, name: '콩' });
        assert.ok(!/월요일|Monday/.test(out), `${lang} ${p} ${v}: ${out}`);
      }
    }
  }
  setLang('ko');
});

test('매일 쪽지는 낮 시간이 단정되지 않는다 (아침, 저녁 말이 없다)', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const key of ['note.open', 'note.close']) {
      for (const p of ['friend', 'polite', 'tsundere', 'calm']) {
        for (let v = 1; v <= 8; v++) {
          const out = loose(key, { p, v, name: '콩' });
          assert.ok(
            !/아침|저녁|일어났|morning|evening|tonight|You're up/.test(out),
            `${lang} ${key} ${p} ${v}: ${out}`,
          );
        }
      }
    }
  }
  setLang('ko');
});

test('저녁 쪽지는 매일 쪽지를 들고 온 뒤 간격을 둔다 (21시에 처음 앉아도 연달아 오지 않는다)', () => {
  const day = '2026-10-28';
  const daily = {
    ...composeNote({ day, persona: 'friend', petName: '콩', facts: [] } as never, () => 0),
    at: 21 * 60 + 5,
  };
  const st = fileNote(EMPTY_NOTES, daily);
  const at = { day, present: true, calm: true, on: true };
  assert.equal(canDeliverEvening(st, { ...at, minute: 21 * 60 + 6 }), false);
  assert.equal(canDeliverEvening(st, { ...at, minute: 21 * 60 + 5 + EVENING_GAP_MIN - 1 }), false);
  assert.equal(canDeliverEvening(st, { ...at, minute: 21 * 60 + 5 + EVENING_GAP_MIN }), true);
  // 낮에 받았으면 밤 9시에 바로
  const noon = fileNote(EMPTY_NOTES, { ...daily, at: 12 * 60 });
  assert.equal(canDeliverEvening(noon, { ...at, minute: 21 * 60 }), true);
  // 시각 기록이 없는 옛 쪽지는 막지 않는다
  const { at: _drop, ...old } = daily;
  assert.equal(canDeliverEvening(fileNote(EMPTY_NOTES, old), { ...at, minute: 21 * 60 }), true);
  // 저장했다 읽어도 시각이 남는다
  assert.equal(parseNotes(JSON.parse(JSON.stringify(st))).box[0]?.at, 21 * 60 + 5);
});

test('삐진 말: 안 쓰기로 한 말은 가까운 다른 말로, 모두 안 쓰면 말하지 않는다', () => {
  const all = [1, 2, 3, 4, 5, 6, 7].map((n) => `pet.sulk.${n}`);
  try {
    assert.ok(sulkLine(3));
    mute(['pet.sulk.3']);
    assert.equal(sulkLine(3), voiced('pet.sulk.2'));
    mute(all);
    assert.equal(sulkLine(3), undefined);
  } finally {
    unmute();
  }
});

test('voicedLive: 안 쓰기로 한 말은 undefined', () => {
  try {
    assert.ok(voicedLive('pet.play.walkStart'));
    mute(['pet.play.walkStart']);
    assert.equal(voicedLive('pet.play.walkStart'), undefined);
  } finally {
    unmute();
  }
});

test('토라진 말 목록에서 안 쓰기로 한 말은 빠지고, 다 빠지면 빈 목록', () => {
  try {
    assert.equal(poutLines('pout.lonely', 4).length, 4);
    mute(['pout.lonely.2']);
    assert.equal(poutLines('pout.lonely', 4).length, 3);
    mute([1, 2, 3, 4].map((n) => `pout.lonely.${n}`));
    assert.deepEqual(poutLines('pout.lonely', 4), []);
    unmute();
    assert.equal(poutLines('pout.friend', 4, { friend: '밤' }, [2, 3]).length, 2);
  } finally {
    unmute();
  }
});

test('웃겨 줘와 웃음 말은 안 쓰기로 한 번호를 고르지 않고, 다 끄면 undefined', () => {
  const only3 = (n: number) => n === 3;
  for (let i = 0; i < 20; i++)
    assert.equal(
      pickJoke([], () => i / 20, only3),
      3,
    );
  assert.equal(
    pickJoke(
      [],
      () => 0,
      () => false,
    ),
    undefined,
  );
  assert.equal(
    pickFun(
      4,
      () => 0,
      (k) => k === 4,
    ),
    4,
  );
  assert.equal(
    pickFun(
      4,
      () => 0.5,
      () => false,
    ),
    undefined,
  );
});

test('헤어짐, 쉬는 날, 맞이 말: 안 쓰기로 한 말은 빠지고 모두 끄면 빈 글', () => {
  const f = { day: '2026-10-28', doneTitles: [], tomorrow: [], leftToday: 0, quiet: true };
  try {
    assert.ok(farewellText(f));
    mute(['routine.bye.head']);
    assert.equal(farewellText(f), '');
    assert.ok(restText('2026-10-28', '일정 하나'));
    mute(['routine.rest']);
    assert.equal(restText('2026-10-28', ''), '');
    assert.equal(restText('2026-10-28', '일정 하나'), '일정 하나');
    mute(['routine.hi.first']);
    assert.equal(
      greetText({
        day: '2026-10-28',
        arrival: 'onTime',
        first: true,
        streak: 0,
        coins: 0,
        briefing: '',
        quiet: true,
      }),
      '',
    );
  } finally {
    unmute();
  }
});

test('1인칭 "나" 로 불러도 뜻이 뒤집히지 않는다', () => {
  const me: SpeechStyle = { ...DEFAULT_STYLE, ownRate: 'always', self: 'me' };
  // 술래잡기: name 은 놀이 상대 친구
  assert.match(voiced('play.tag.start', { name: '밤' }, 'custom', me), /밤/);
  assert.doesNotMatch(voiced('play.tag.swap', { name: '밤' }, 'custom', me), /내가/);
  // 이름이 주어가 아닌 말
  assert.equal(
    voiced('idle.friend.1.2', { name: '콩' }, 'custom', me),
    '이제 타자 소리만 들어도 너인 줄 내가 알아.',
  );
  assert.match(voiced('companion.anniv.day', { name: '콩', n: 7 }, 'custom', me), /나를 잘 부탁해/);
  assert.ok(dicts.ko['play.tag.start']);
});
