// 성격마다 다른 정해진 말 (2026-10-11): 인사, 칭찬, 쉬자는 말처럼 자주 하는 말을 고른 성격(다정한 친구, 존댓말 비서,
// 츤데레, 차분한 선생님) 말투로. 다정한 친구는 원래 말 그대로이고, 나머지는 사전의 voice.<성격>.<원래 키> 를 쓴다.
// AI 없이 정해진 말이다. 메인이 시작할 때 setVoiceSource 로 지금 성격을 읽는 곳을 정한다 (안 정하면 다정한 친구)
import type { PersonaId } from './ai/persona.ts';
import { dicts, getLang, type I18nKey, t } from './i18n/index.ts';

/** 성격마다 말투를 바꾸는 말 (모두 voice.polite., voice.tsundere., voice.calm. 이 사전에 있다. 시험이 본다) */
export const VOICED = [
  // 인사
  'briefing.hi.morning',
  'briefing.hi.day',
  'briefing.hi.evening',
  'routine.hi.first',
  'routine.bye.rest',
  // 칭찬
  'companion.cheer.clear',
  'companion.cheer.streak',
  'companion.cheer.count',
  'pet.fed',
  'pet.fedWith',
  'routine.bye.doneMany',
  // 쉬자, 하자는 말
  'pet.rest.1',
  'pet.rest.2',
  'pet.rest.3',
] as const satisfies readonly I18nKey[];
export type VoicedKey = (typeof VOICED)[number];

/** 원래 말을 덮는 성격 (다정한 친구는 원래 말) */
export const VOICE_PERSONAS = ['polite', 'tsundere', 'calm'] as const satisfies readonly PersonaId[];

let source: () => PersonaId = () => 'friend';

export function setVoiceSource(read: () => PersonaId): void {
  source = read;
}

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

/** 성격 말투로 고른 말. 그 성격 말이 사전에 없으면 원래 말 */
export function voiced(key: VoicedKey, vars?: Record<string, string | number>, persona = source()): string {
  if (persona !== 'friend') {
    const alt = `voice.${persona}.${key}`;
    const dict = (getLang() === 'en' ? dicts.en : dicts.ko) as Record<string, unknown>;
    if (alt in dict) return looseT(alt, vars);
  }
  return looseT(key, vars);
}
