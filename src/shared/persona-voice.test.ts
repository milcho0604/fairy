import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PersonaId } from './ai/persona.ts';
import { briefingBody, briefingText, deadlineText, reviewText } from './briefing.ts';
import { dicts, type I18nKey, setLang, t } from './i18n/index.ts';
import { setVoiceSource, VOICE_PERSONAS, VOICED, voiced } from './persona-voice.ts';
import { remindLine } from './remind-text.ts';
import { restLines } from './rest.ts';
import { farewellText, greetText, restText } from './routine-text.ts';

test('성격마다 바꾸는 말은 세 성격 모두 사전(한국어, 영어)에 있다', () => {
  for (const key of VOICED)
    for (const p of VOICE_PERSONAS) {
      const k = `voice.${p}.${key}`;
      assert.ok(k in dicts.ko, k);
      assert.ok(k in dicts.en, k);
    }
});

test('다정한 친구는 원래 말, 다른 성격은 그 말투 (말마다 서로 다르다)', () => {
  setLang('ko');
  const vars = { name: '콩이', n: 3, food: '붕어빵' };
  for (const key of VOICED) {
    const all = (['friend', ...VOICE_PERSONAS] as const).map((p) => voiced(key, vars, p));
    assert.equal(new Set(all).size, 4, `${key}: ${all.join(' / ')}`);
    for (const line of all) assert.ok(!/undefined|NaN/.test(line), line);
  }
  assert.equal(voiced('pet.fed', undefined, 'friend'), '냠냠, 고마워!');
  assert.match(voiced('pet.fed', undefined, 'polite'), /요/);
});

test('지금 성격은 setVoiceSource 로 읽는다. 영어도 성격 말투', () => {
  setVoiceSource(() => 'tsundere');
  try {
    setLang('en');
    assert.notEqual(voiced('briefing.hi.morning'), 'Good morning!');
    setLang('ko');
    assert.notEqual(voiced('briefing.hi.morning'), '좋은 아침!');
  } finally {
    setVoiceSource(() => 'friend');
    setLang('ko');
  }
  assert.equal(voiced('briefing.hi.morning'), '좋은 아침!');
});

// ---- 한 말풍선 안에서 말투가 섞이지 않는다 (2026-10-11) ----
// 성격마다 말풍선에 나오는 정해진 말을 실제로 만들어 보고, 문장 끝이 그 성격 말투인지 본다.
// 존댓말 비서는 반말 끝(…야, …해, …어)이 없고, 나머지(반말)는 존댓말 끝(…요, …니다)이 없다.
// 이름이나 "하나 끝!" 처럼 끝이 말투를 정하지 않는 문장은 넘어간다

const SAY_DAY = '2026-10-12';
const SAY_NOW = new Date(2026, 9, 12, 9, 0).getTime();
const titles = ['보고서', '디자인 회의'];

function sampleBubbles(persona: PersonaId): string[] {
  setVoiceSource(() => persona);
  try {
    const out: string[] = [];
    const events = [{ minute: 600, title: '디자인 회의' }];
    for (const nowMinute of [8 * 60, 13 * 60, 19 * 60]) {
      out.push(briefingText({ events, dueToday: 2, overdue: 1, nowMinute, next: '보고서' }));
      out.push(briefingText({ events: [], dueToday: 0, overdue: 0, nowMinute }));
      out.push(
        briefingText({
          events: [...events, { minute: 0, title: '휴가', allDay: true }, events[0]!],
          dueToday: 0,
          overdue: 0,
          nowMinute,
        }),
      );
    }
    const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
    for (const day of days) {
      for (const arrival of ['early', 'onTime', 'late'] as const)
        for (const coins of [0, 3, 8])
          out.push(
            greetText({
              day,
              arrival,
              first: false,
              streak: 5,
              coins,
              briefing: briefingBody({ events, dueToday: 1, overdue: 0 }),
              quiet: false,
            }),
          );
      out.push(
        greetText({ day, arrival: 'onTime', first: true, streak: 1, coins: 3, briefing: '', quiet: false }),
      );
      out.push(restText(day, briefingBody({ events, dueToday: 0, overdue: 0 }, '')));
      const meet = { start: 540, end: 1080 };
      for (const doneTitles of [[], ['보고서'], titles])
        for (const leftToday of [0, 2]) {
          out.push(
            farewellText({
              day,
              doneTitles,
              tomorrow: events,
              leftToday,
              quiet: false,
              next: { inDays: 1, day, meet },
            }),
          );
          out.push(farewellText({ day, doneTitles, tomorrow: [], leftToday, quiet: false }));
          out.push(
            farewellText({
              day,
              doneTitles,
              tomorrow: [],
              leftToday,
              quiet: false,
              next: { inDays: 3, day, meet },
            }),
          );
          out.push(
            farewellText({
              day,
              doneTitles,
              tomorrow: [],
              leftToday,
              quiet: false,
              next: { inDays: 1, day, meet },
            }),
          );
          out.push(
            farewellText({
              day,
              doneTitles,
              tomorrow: [
                { minute: 0, title: '휴가', allDay: true },
                { minute: 0, title: '출장', allDay: true },
              ],
              leftToday,
              quiet: false,
              next: { inDays: 1, day, meet },
            }),
          );
        }
    }
    for (const doneTitles of [[], ['보고서'], titles])
      out.push(reviewText({ doneTitles, leftToday: 1 }), deadlineText(titles));
    out.push(...restLines());
    const at = (min: number) => SAY_NOW + min * 60_000;
    for (const kind of ['event', 'todo'] as const) {
      for (const min of [0, 10, 150, 24 * 60, 3 * 24 * 60, 7 * 24 * 60])
        out.push(remindLine({ kind, title: '디자인 회의', anchor: { kind: 'time', at: at(min) } }, SAY_NOW));
      for (const day of ['2026-10-12', '2026-10-13', '2026-10-19'])
        out.push(remindLine({ kind, title: '보고서', anchor: { kind: 'day', day } }, SAY_NOW));
    }
    const vars = {
      name: '콩이',
      n: 3,
      food: '붕어빵',
      coins: 5,
      step: 50,
      seconds: 30,
      open: 2,
      eventMin: 10,
      workedH: 2,
      minutes: 25,
      breakMin: 5,
      title: '보고서',
    };
    const keys = Object.keys(dicts.ko).filter(
      (k) =>
        k.startsWith('idle.') ||
        /^(companion\.(cheer|anniv)|pet\.(fed|rest|life\.(rested|madeUp|affection)|unlock|energy\.fresh|full|noCoins|play\.walk|seek\.|home\.(goIn|back))|routine\.cue|assist\.(overdue\.moved|week\.friday)|panel\.(review\.moved|focus\.(done|breakDone|todoAsk)))/.test(
          k,
        ),
    );
    for (const k of keys) out.push(voiced(k as I18nKey, vars));
    return out;
  } finally {
    setVoiceSource(() => 'friend');
  }
}

/** 문장 끝 말 (따옴표, 괄호 속 시각, 문장 부호를 걷어 낸 마지막 글자들) */
function endings(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((x) =>
      x
        .replace(/\([^)]*\)\s*$/, '')
        .replace(/["'”’]/g, '')
        .replace(/[\s.!?~,…]+$/, '')
        .trim(),
    )
    .filter(Boolean);
}
const POLITE_END = /(요|니다|니까)$/;
const BANMAL_END = /(야|해|어|아|지|자|네|게|래|다|까|줘|봐|돼|워|려|져|군|걸|냐|니)$/;

test('성격마다 한 말풍선의 말투가 같다: 존댓말 비서는 존댓말만, 다른 성격은 반말만 (한국어)', () => {
  setLang('ko');
  for (const persona of ['friend', ...VOICE_PERSONAS] as const) {
    const bad: string[] = [];
    for (const text of sampleBubbles(persona))
      for (const end of endings(text)) {
        const polite = POLITE_END.test(end);
        if (persona === 'polite' ? !polite && BANMAL_END.test(end) : polite) bad.push(`${end}  ⟵ ${text}`);
      }
    assert.deepEqual([...new Set(bad)], [], persona);
  }
});

test('성격 말은 원래 말과 인자 모양이 같고 영어 사전에도 있다', () => {
  for (const key of Object.keys(dicts.ko)) {
    const m = /^voice\.(polite|tsundere|calm)\.(.+)$/.exec(key);
    if (!m) continue;
    assert.ok(m[2]! in dicts.ko, `원래 키가 없다: ${key}`);
    assert.ok(key in dicts.en, key);
    assert.equal(
      typeof (dicts.ko as Record<string, unknown>)[key],
      typeof (dicts.ko as Record<string, unknown>)[m[2]!],
      key,
    );
  }
});

test('영어도 존댓말 비서는 인사 뒤 브리핑과 헤어짐이 같은 말투 (원래 친구 말이 섞이지 않는다)', () => {
  setLang('en');
  setVoiceSource(() => 'polite');
  try {
    const hi = briefingText({ events: [], dueToday: 0, overdue: 0, nowMinute: 9 * 60 });
    assert.notEqual(hi, `${t('briefing.hi.morning')} ${t('briefing.nothing')}`);
    assert.ok(!hi.includes(t('briefing.nothing')), hi);
    const bye = farewellText({ day: SAY_DAY, doneTitles: [], tomorrow: [], leftToday: 0, quiet: false });
    assert.ok(!bye.includes('Rest well!'), bye);
  } finally {
    setVoiceSource(() => 'friend');
    setLang('ko');
  }
});
