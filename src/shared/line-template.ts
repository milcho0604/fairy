// 펫 대사 틀 (#125). 대사 고치기에서 사용자가 쓰는 글과 사전 글이 같은 문법을 쓴다.
//   {name}     값을 그대로 (펫 이름, 개수 등)
//   {name:은}  값 뒤에 받침에 맞는 조사 (콩은, 밤은). 조사는 shared/josa.ts 의 은 이 이랑 과 을 아 이다 으로
// 사전의 글 값은 이미 {name} 문법이고, 사전의 함수 값은 shared/lines.ts 가 틀로 풀어 낸다.
import { type Particle, withParticle } from './josa.ts';

const PARTICLE_NAMES: readonly Particle[] = ['이랑', '과', '이', '은', '을', '아', '이다', '으로'];
const isParticle = (v: string): v is Particle => (PARTICLE_NAMES as readonly string[]).includes(v);

/** {이름} 또는 {이름:조사}. 이름은 영문자, 숫자, _ */
const TOKEN = /\{(\w+)(?::([^{}]+))?\}/g;

type Vars = Record<string, string | number>;

/** 틀 안의 값 자리를 채운다. 값이 없는 자리와 모르는 조사는 그대로 둔다 */
export function renderTemplate(tpl: string, vars?: Vars): string {
  return tpl.replace(TOKEN, (m, name: string, particle: string | undefined) => {
    const v = vars?.[name];
    if (v === undefined) return m;
    if (particle === undefined) return String(v);
    return isParticle(particle) ? withParticle(String(v), particle) : m;
  });
}

/** 틀 안에 쓰인 값 이름들 (겹침 없이, 쓰인 순서) */
export function varsOf(tpl: string): string[] {
  const out: string[] = [];
  for (const m of tpl.matchAll(TOKEN)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/** 고친 대사 글자 수 상한 (말풍선에 담기는 길이) */
export const LINE_TEXT_MAX = 200;

export type LineCheck =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'long' | 'brace' | 'missing' | 'unknown' | 'particle'; vars?: string[] };

/**
 * 고친 대사 검사. 기본 대사에 있던 값({name} 등)은 하나도 빠지면 안 되고(말이 어색해지거나 정보가 사라진다),
 * 기본 대사에 없던 값을 새로 쓰면 채울 값이 없으니 안 된다. 짝이 안 맞는 중괄호와 모르는 조사도 거른다.
 * 앞뒤 공백과 줄바꿈은 정리해 한 줄로 만든다
 */
export function checkLine(base: string, edited: string): LineCheck {
  const text = edited.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > LINE_TEXT_MAX) return { ok: false, reason: 'long' };
  // 값 자리를 걷어 내고 남은 중괄호는 짝이 안 맞는 것이다
  if (/[{}]/.test(text.replace(TOKEN, ''))) return { ok: false, reason: 'brace' };
  for (const m of text.matchAll(TOKEN))
    if (m[2] !== undefined && !isParticle(m[2])) return { ok: false, reason: 'particle' };
  const want = varsOf(base);
  const got = varsOf(text);
  const missing = want.filter((v) => !got.includes(v));
  if (missing.length) return { ok: false, reason: 'missing', vars: missing };
  const unknown = got.filter((v) => !want.includes(v));
  if (unknown.length) return { ok: false, reason: 'unknown', vars: unknown };
  return { ok: true, text };
}
