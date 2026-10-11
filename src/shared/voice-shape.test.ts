import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PersonaId } from './ai/persona.ts';
import { dicts, type I18nKey, setLang } from './i18n/index.ts';
import { basePersonaOf, setSpeechSource, styled, voiced } from './persona-voice.ts';
import { DEFAULT_STYLE, type SpeechStyle } from './speech-style.ts';

// 말풍선 말 모양 검사 (2026-10-11): 페어리가 말풍선으로 하는 정해진 말 전부를 모든 성격(프리셋, 내 말투의 이상한 입력까지)
// 으로 만들어 보고, 말끝이 어색하게 붙은 곳이 없는지 본다. 하나야냥, 요냥(반말), 물음표 뒤 냥, 이모지나 영어 뒤 냥,
// 겹친 말끝, 빈칸 뒤 문장 부호, 채우지 못한 자리 표시. 문자열 하나가 아니라 말투 규칙(speech-style.ts)을 고친다

/** 말풍선에 나오는 말 (메뉴, 설정 글은 빼고) */
const BUBBLE =
  /^(idle\.|companion\.(cheer|anniv|friend)\.|pet\.(sulk\.|rest\.|energy\.fresh|life\.(rested|madeUp|affection)|unlock\.|hello\.|hideHint|tooChatty$|busyCpu|play\.(noBall|walk)|seek\.|fed|newHouse|houseMoved|houseStyle|home\.(goIn|back)|noCoins|full|foodMade|calendarBroken)|routine\.(hi\.|bye\.|rest|cue|streak|coins)|briefing\.(hi\.|oneEvent|events|allDay|todos|nothing|next|review\.|due\.left)|remind\.say\.|assist\.(overdue\.moved|week\.friday)|panel\.(review\.moved|focus\.(done|breakDone|todoAsk))|note\.(bring|open$|yesterday|event|habit|birthday|food|like|season|close|special\.)|together\.work)/;
const KEYS = Object.keys(dicts.ko).filter((k) => BUBBLE.test(k)) as I18nKey[];

const KO_VARS = {
  name: '콩이',
  title: '보고서',
  food: '붕어빵',
  value: '고양이',
  friend: '밀크',
  list: '보고서, 회의',
};
const EN_VARS = {
  name: 'Bean',
  title: 'Report',
  food: 'taiyaki',
  value: 'cats',
  friend: 'Milk',
  list: 'Report, Meeting',
};

/** 이름이 정해진 값 말고는 숫자 (i, v 는 여러 말 가운데 고르는 값이라 돌려 가며) */
function varsFor(lang: 'ko' | 'en', round: number, persona: PersonaId): Record<string, string | number> {
  const named: Record<string, string | number> = {
    ...(lang === 'ko' ? KO_VARS : EN_VARS),
    time: lang === 'ko' ? '오후 3:00' : '3:00 PM',
    weekday: lang === 'ko' ? '월요일' : 'Monday',
    date: lang === 'ko' ? '10월 14일' : 'Oct 14',
    range: '',
    dur: lang === 'ko' ? '2시간' : '2 hours',
    keys: 'Cmd+Shift+H',
    p: basePersonaOf(persona),
    i: round,
    v: (round % 3) + 1,
    s: round % 4,
  };
  return new Proxy(named, {
    get: (o, k) => (typeof k === 'string' ? (k in o ? o[k] : round + 2) : undefined),
    has: () => true,
  });
}

const style = (s: Partial<SpeechStyle>): SpeechStyle => ({ ...DEFAULT_STYLE, ...s });
const CASES: { persona: PersonaId; custom?: SpeechStyle; label: string }[] = [
  ...(['friend', 'polite', 'tsundere', 'calm', 'cheer', 'cat', 'puppy', 'sageuk', 'announcer'] as const).map(
    (persona) => ({ persona, label: persona }),
  ),
  { persona: 'custom', label: '내 말투 반말 뿌 집사', custom: style({ ending: '뿌', call: 'butler' }) },
  { persona: 'custom', label: '해요체 용', custom: style({ level: 'haeyo', ending: '용', emoji: 'many' }) },
  { persona: 'custom', label: '합쇼체 냥', custom: style({ level: 'hapsyo', ending: '냥', bang: 'strong' }) },
  { persona: 'custom', label: '반말 요', custom: style({ ending: '요', call: 'master' }) },
  // 화면에서 다듬기 전 값이 그대로 올 수도 있다 (미리 보기): 부호, 빈칸, 이모지, 영어, 이름 끝 소리를 모르는 부르는 말
  {
    persona: 'custom',
    label: '이상한 입력',
    custom: style({ ending: ' 냥! ', call: 'name', callText: '🐱', emoji: 'none', bang: 'soft' }),
  },
  {
    persona: 'custom',
    label: '이모지 말끝',
    custom: style({ ending: '🐾', call: 'custom', callText: 'Sam' }),
  },
  { persona: 'custom', label: '영어 말끝', custom: style({ ending: 'nya', bang: 'strong', emoji: 'many' }) },
];

/** 정해진 말 하나를 성격 말투로 (쪽지와 같이 일하는 말은 성격 말을 고른 뒤 말투 규칙만) */
function say(key: I18nKey, vars: Record<string, string | number>, c: (typeof CASES)[number]): string {
  if (/^(note|together)\./.test(key)) return styled(voiced(key, vars, 'friend'), c.persona, c.custom);
  return voiced(key, vars, c.persona, c.custom);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 어떤 말에도 없어야 하는 모양 */
const COMMON_BAD: [RegExp, string][] = [
  [/undefined|NaN|\[object|\{\w+\}/, '채우지 못한 값'],
  [/ {2}/, '빈칸 두 개'],
  [/\s[.,!?](?=\s|$)/, '빈칸 뒤 문장 부호'],
  [/[!?,]\.|,[!?]|\.,/, '겹친 문장 부호'],
  [/(?<!\.)\.\.(?!\.)/, '마침표 두 개'],
];

function problems(text: string, lang: 'ko' | 'en', c: (typeof CASES)[number]): string[] {
  const out: string[] = [];
  if (!text.trim()) out.push('빈 말');
  for (const [re, why] of COMMON_BAD) if (re.test(text)) out.push(why);
  const raw = (c.custom ?? (c.persona === 'cat' ? style({ ending: '냥' }) : undefined))?.ending ?? '';
  const ending = c.persona === 'puppy' ? '멍' : raw.replace(/[\s.!?~,]/g, '');
  const level = c.custom?.level ?? 'banmal';
  if (lang === 'ko' && ending) {
    const e = esc(ending);
    // 말끝 앞은 한글 글자여야 한다 (물음표, 말줄임, 따옴표, 이모지, 영어 뒤 X)
    if (new RegExp(`[^가-힣\\s'"“‘(]${e}`, 'u').test(text) && !/[^가-힣]/u.test(ending))
      out.push('말끝이 한글 뒤가 아니다');
    if (new RegExp(`(${e}){2}`).test(text)) out.push('겹친 말끝');
    if (level === 'banmal' && !/^[요용]/.test(ending) && new RegExp(`요${e}`).test(text))
      out.push('반말에 요 + 말끝');
    // 반말 이다 + 말끝: 하나야냥 X (하나다냥), 물음은 냥만 줄인다 (진짜냥?)
    if (level === 'banmal' && new RegExp(`[가-힣]야${e}(?!\\?)`).test(text)) out.push('야 + 말끝');
    if (ending === '냥' && /[가-힣]야냥\?/.test(text)) out.push('야냥?');
    if (/^[요용]/.test(ending) && /(?<!니)다[요용]/.test(text)) out.push('다 + 요');
  }
  if (lang === 'en') {
    if (/[가-힣]/.test(text)) out.push('영어 말에 한글');
    if ((text.match(/\b(meow|woof)\b/g) ?? []).length > 1) out.push('울음소리 두 번');
    if (/\b(meow|woof)\b/.test(text) && !['냥', '멍'].includes(ending)) out.push('다른 성격에 울음소리');
    if (/\b(meow|woof)[A-Za-z]/.test(text)) out.push('울음소리에 글자가 붙었다');
  }
  if (c.custom?.emoji === 'none' && /\p{Extended_Pictographic}/u.test(text))
    out.push('이모지 없이인데 이모지');
  return out;
}

for (const lang of ['ko', 'en'] as const)
  test(`말풍선 말 모양: 모든 정해진 말 × 모든 성격, 내 말투의 이상한 입력까지 (${lang})`, () => {
    setLang(lang);
    const bad = new Set<string>();
    try {
      for (const c of CASES) {
        setSpeechSource({ style: () => c.custom ?? DEFAULT_STYLE, petName: () => KO_VARS.name });
        for (const key of KEYS)
          for (let round = 0; round < 6; round++) {
            const text = say(key, varsFor(lang, round, c.persona), c);
            for (const why of problems(text, lang, c)) bad.add(`[${c.label}] ${key}: ${why} ⟵ ${text}`);
          }
      }
    } finally {
      setLang('ko');
      setSpeechSource({ style: () => DEFAULT_STYLE, petName: () => '' });
    }
    assert.ok(KEYS.length > 200, `말풍선 말이 ${KEYS.length}개뿐`);
    assert.deepEqual([...bad].slice(0, 40), []);
  });
