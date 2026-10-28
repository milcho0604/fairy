// 성격마다 다른 정해진 말 (2026-10-11): 인사, 칭찬, 쉬자는 말처럼 자주 하는 말을 고른 성격(다정한 친구, 존댓말 비서,
// 츤데레, 차분한 선생님) 말투로. 다정한 친구는 원래 말 그대로이고, 나머지는 사전의 voice.<성격>.<원래 키> 를 쓴다.
// AI 없이 정해진 말이다. 메인이 시작할 때 setVoiceSource 로 지금 성격을 읽는 곳을 정한다 (안 정하면 다정한 친구)
import type { PersonaId } from './ai/persona.ts';
import { dicts, getLang, hasLineOverride, type I18nKey, isMutedLine, t } from './i18n/index.ts';
import {
  applyStyle,
  callWord,
  DEFAULT_STYLE,
  fillLine,
  type Moment,
  passes,
  type SpeechStyle,
  selfWord,
} from './speech-style.ts';
import { variants, variantsOf } from './variants.ts';

/**
 * 성격마다 말투를 바꾸는 말 가운데 세 성격(존댓말 비서, 츤데레, 차분한 선생님) 모두 따로 쓴 것.
 * 이 밖에도 voice.<성격>.<원래 키> 가 사전에 있으면 그 말을 쓴다 (존댓말 비서는 말풍선의 정해진 말을 거의 다,
 * 츤데레와 차분한 선생님은 감정이 실린 말만. 정보만 전하는 말은 반말 그대로 같이 쓴다)
 */
const VOICED_BASE = [
  // 인사
  'briefing.hi.morning',
  'briefing.hi.day',
  'briefing.hi.evening',
  'routine.hi.first',
  'routine.hi.early',
  'routine.hi.onTime',
  'routine.hi.late',
  'routine.bye.rest',
  'routine.bye.head',
  'routine.rest',
  // 칭찬
  'companion.cheer.clear',
  'companion.cheer.streak',
  'companion.cheer.count',
  'companion.anniv.day',
  'companion.anniv.late',
  'companion.anniv.year',
  'pet.fed',
  'pet.fedWith',
  'routine.bye.doneMany',
  'routine.bye.doneOne',
  'briefing.review.none',
  'briefing.review.one',
  'briefing.review.many',
  // 쉬자, 하자는 말
  'pet.rest.1',
  'pet.rest.2',
  'pet.rest.3',
  'routine.cue',
  'briefing.next',
] as const satisfies readonly I18nKey[];

/** 변형이 여러 개인 말(휴식, 인사, 축하, 먹이기)의 변형도 세 성격 모두 따로 쓴다 */
const VARIANT_BASES = [
  'pet.rest',
  'briefing.hi.morning',
  'briefing.hi.day',
  'briefing.hi.evening',
  'companion.cheer.clear',
  'companion.cheer.streak',
  'companion.cheer.count',
  'pet.fed',
  'pet.fedWith',
] as const;
export const VOICED: readonly I18nKey[] = [
  ...VOICED_BASE,
  ...(VARIANT_BASES.flatMap((b) => variantsOf(b)).filter(
    (k) => !(VOICED_BASE as readonly string[]).includes(k),
  ) as I18nKey[]),
];

/** 원래 말을 덮는 성격 (다정한 친구는 원래 말) */
export const VOICE_PERSONAS = ['polite', 'tsundere', 'calm'] as const satisfies readonly PersonaId[];

/** 말을 따로 쓴 성격. 나머지(프리셋, 내 말투)는 이 가운데 하나의 말을 규칙으로 바꾼다 (shared/speech-style.ts) */
export type WrittenPersona = 'friend' | 'polite' | 'tsundere' | 'calm';
const WRITTEN = new Set<PersonaId>(['friend', 'polite', 'tsundere', 'calm']);

/** 말투 프리셋 (2026-10-11): 정해진 말 전부를 같은 규칙으로 바꾸니 빠지는 말이 없다 */
export const PRESET_STYLES: Record<Exclude<PersonaId, WrittenPersona | 'custom'>, SpeechStyle> = {
  cheer: { ...DEFAULT_STYLE, bang: 'strong', emoji: 'many' },
  cat: { ...DEFAULT_STYLE, ending: '냥', bang: 'soft', emoji: 'some' },
  puppy: { ...DEFAULT_STYLE, ending: '멍', bang: 'strong', emoji: 'some' },
  sageuk: { ...DEFAULT_STYLE, level: 'hao', bang: 'soft', emoji: 'none' },
  announcer: { ...DEFAULT_STYLE, level: 'hapsyo', bang: 'soft', emoji: 'none' },
};
export const PRESET_IDS = Object.keys(PRESET_STYLES) as (keyof typeof PRESET_STYLES)[];

/**
 * 이 성격의 말투를 내 말투(custom)로 복사할 때 시작값. 프리셋은 그 규칙, 존댓말 비서는 해요체, 나머지는 반말.
 * 내 말투는 하오체를 고르지 않아 선비 말투는 합쇼체로 (직접 고칠 수 있다)
 */
export function styleForCopy(persona: PersonaId): SpeechStyle {
  const preset = PRESET_STYLES[persona as keyof typeof PRESET_STYLES];
  if (preset) {
    const level = preset.level === 'hao' ? 'hapsyo' : preset.level;
    return { ...preset, level, endings: preset.ending ? [preset.ending] : [] };
  }
  return persona === 'polite' ? { ...DEFAULT_STYLE, level: 'haeyo' } : DEFAULT_STYLE;
}

let source: () => PersonaId = () => 'friend';
let customSource: () => SpeechStyle = () => DEFAULT_STYLE;
let petNameSource: () => string = () => '';
let todoSource: () => string | undefined = () => undefined;

/** 내 말투, 펫 이름, 지금 먼저 할 일 (직접 쓴 말의 {name}, {todo}) 을 읽는 곳. 메인이 시작할 때 정한다 */
export function setSpeechSource(o: {
  style: () => SpeechStyle;
  petName: () => string;
  todo?: () => string | undefined;
}): void {
  customSource = o.style;
  petNameSource = o.petName;
  todoSource = o.todo ?? (() => undefined);
}

/** 성격의 말투 규칙. 말을 따로 쓴 성격이면 undefined */
export function styleOf(persona: PersonaId, custom: SpeechStyle = customSource()): SpeechStyle | undefined {
  if (WRITTEN.has(persona)) return undefined;
  if (persona === 'custom') return custom;
  return PRESET_STYLES[persona as keyof typeof PRESET_STYLES];
}

/** 이 성격이 바탕으로 쓰는 말 (반말이면 다정한 친구, 높임이면 존댓말 비서) */
export function basePersonaOf(persona: PersonaId, custom: SpeechStyle = customSource()): WrittenPersona {
  if (WRITTEN.has(persona)) return persona as WrittenPersona;
  return styleOf(persona, custom)?.level === 'banmal' ? 'friend' : 'polite';
}

/** 반말로 말하는 성격인지 (채팅 AI 답 다듬기에 쓴다) */
export const isBanmal = (persona: PersonaId, custom: SpeechStyle = customSource()): boolean =>
  basePersonaOf(persona, custom) !== 'polite';

/** 때마다 직접 쓴 말로 바꿀 수 있는 말 (내 말투) */
const MOMENT_OF: [RegExp, Moment][] = [
  [/^(briefing\.hi\.morning|routine\.hi\.|idle\.morning\.)/, 'morning'],
  [/^(companion\.cheer\.|idle\.praise\.|routine\.bye\.done|briefing\.review\.(one|many))/, 'praise'],
  [/^pet\.rest\./, 'rest'],
  [/^(idle\.late\.|idle\.night\.|routine\.bye\.rest)/, 'night'],
  [/^idle\.lunch\./, 'lunch'],
  [/^(idle\.done\.|idle\.todo\.clear)/, 'done'],
  [/^panel\.focus\.(done|breakDone)/, 'focusEnd'],
  [/^idle\.back\./, 'back'],
  [/^(idle\.hungry\.|pout\.hungry\.)/, 'hungry'],
  [/^(idle\.evening\.|routine\.bye\.)/, 'evening'],
];
/** 그 때에 직접 쓴 말이 없으면 비슷한 때의 말을 쓴다 (칭찬 말이 끝낸 직후에도, 아침 인사가 돌아왔을 때도) */
const FALLBACK: Partial<Record<Moment, Moment>> = { done: 'praise', back: 'morning', evening: 'night' };
export const momentOf = (key: string): Moment | undefined => MOMENT_OF.find(([re]) => re.test(key))?.[1];

/** 이름을 불러 시작하는 인사 */
const GREET = /^(briefing\.hi\.|routine\.hi\.|idle\.back\.)/;
/** 이모지를 많이 고르면 붙이는 그림 (때마다). 정보만 전하는 말(일정, 알림)에는 붙이지 않는다 */
function emojiFor(key: string, persona: PersonaId): string | undefined {
  const m = momentOf(key);
  if (persona === 'cheer' && (m || /^(idle|companion|routine\.(hi|bye\.head|cue|rest))/.test(key)))
    return '📣';
  if (m === 'morning') return '☀️';
  if (m === 'praise') return '👏';
  if (m === 'rest') return '🍵';
  if (m === 'night') return '🌙';
  if (
    /^(idle\.|companion\.|pet\.(fed|life|energy|unlock|seek|play)|routine\.(hi|bye\.head|cue|rest))/.test(key)
  )
    return '✨';
  return undefined;
}

/** 값 name 이 펫 자신이 아니라 다른 펫(놀이 상대 친구)인 말. 1인칭으로 바꾸지 않는다 */
const NAME_IS_OTHER = /^play\.tag\./;

/** 직접 쓴 말 하나를 고른다 (rand 0~1) */
function ownLine(
  style: SpeechStyle,
  moment: Moment,
  vars: Record<string, string | number> | undefined,
): string | undefined {
  const fallback = FALLBACK[moment];
  const list = style.lines[moment].length > 0 || !fallback ? style.lines[moment] : style.lines[fallback];
  if (!list.length) return undefined;
  // 직접 쓴 말을 얼마나 자주 쓰는가 (항상이면 늘, 아니면 그 비율만큼. 나머지는 원래 말)
  if (!passes(style.ownRate, rand)) return undefined;
  const line = list[Math.min(list.length - 1, Math.floor(rand() * list.length))] ?? list[0] ?? '';
  const me = callWord(style, getLang());
  const todo = (typeof vars?.title === 'string' ? vars.title : undefined) ?? todoSource() ?? '';
  return fillLine(line, { name: petNameSource() || String(vars?.name ?? ''), me, todo });
}
let rand = Math.random;
/** 시험용: 직접 쓴 말 고르기를 정해진 값으로 */
export function setVoiceRandom(r: () => number): void {
  rand = r;
}

export function setVoiceSource(read: () => PersonaId): void {
  source = read;
}

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

/** 지금 고른 성격 (말풍선 말을 고르는 곳 밖에서 볼 때) */
export const currentPersona = (): PersonaId => source();

/**
 * 성격 말투로 고른 말. 그 성격 말(voice.<성격>.<키>)이 사전에 없으면 원래 말.
 * 펫이 말풍선으로 하는 정해진 말은 t 대신 이것으로 (한 말풍선 안에서 인사만 존댓말이고 몸말은 반말이 되지 않게).
 * 프리셋과 내 말투는 바탕 말(다정한 친구나 존댓말 비서)을 말투 규칙으로 바꾼다. custom 을 주면 그 내 말투로 (미리 보기)
 */
export function voiced(
  key: I18nKey,
  vars?: Record<string, string | number>,
  persona = source(),
  custom?: SpeechStyle,
): string {
  const style = styleOf(persona, custom ?? customSource());
  if (style) {
    const moment = momentOf(key);
    const own = moment ? ownLine(style, moment, vars) : undefined;
    if (own) return own;
  }
  const base = basePersonaOf(persona, custom ?? customSource());
  // 펫이 자기를 "나", "저" 같은 말로 부르게 했으면 이름 자리에 그 말을 넣는다 (한국어, 조사는 withParticle 이 맞춘다)
  // 단, name 이 펫 자신이 아닌 말(술래잡기 상대 친구 이름)은 그대로 둔다. "나야, 술래잡기 하자" 로 뜻이 뒤집힌다
  const me = style && !NAME_IS_OTHER.test(key) ? selfWord(style, getLang()) : undefined;
  if (me && vars && 'name' in vars) vars = { ...vars, name: me };
  let text = looseT(key, vars);
  // 사용자가 직접 고친 대사는 말투와 상관없이 그 글을 쓴다 (말투 변형이 고친 글을 가리지 않게, #125)
  if (base !== 'friend' && !hasLineOverride(key)) {
    const alt = `voice.${base}.${key}`;
    const dict = (getLang() === 'en' ? dicts.en : dicts.ko) as Record<string, unknown>;
    if (alt in dict) text = looseT(alt, vars);
  }
  if (!style) return text;
  const lang = getLang();
  const emoji = emojiFor(key, persona);
  return applyStyle(text, style, {
    lang,
    me: callWord(style, lang),
    greet: GREET.test(key),
    rand,
    ...(emoji ? { emoji } : {}),
  });
}

/**
 * voiced 인데 사용자가 안 쓰기로 한 말(설정 > 대사 관리)이면 undefined. 정해진 열쇠 하나를 바로 부르는 곳은 이것으로
 * 부르고, undefined 면 말풍선을 띄우지 않는다 (변형을 고르는 곳은 variants.pick 이 같은 일을 한다)
 */
export function voicedLive(key: I18nKey, vars?: Record<string, string | number>): string | undefined {
  return isMutedLine(key) ? undefined : voiced(key, vars);
}

/** 변형 묶음에서 하나 골라 voiced. 묶음을 모두 안 쓰기로 했으면 undefined (말풍선을 띄우지 않는다) */
export function voicedPick(
  base: string,
  vars?: Record<string, string | number>,
  rand?: () => number,
): string | undefined {
  const key = variants.pick(base, rand);
  return key === null ? undefined : voiced(key as I18nKey, vars);
}

/** 이미 만든 말(쪽지 줄처럼 성격마다 따로 쓴 말)에 지금 말투 규칙을 입힌다. 말을 따로 쓴 성격이면 그대로 */
export function styled(text: string, persona = source(), custom?: SpeechStyle): string {
  const style = styleOf(persona, custom ?? customSource());
  if (!style) return text;
  const lang = getLang();
  return applyStyle(text, style, { lang, me: callWord(style, lang), rand });
}
