// 화면 글 사전 (v2 다국어). 기본은 한국어. 메인은 시작할 때, 화면은 그리기 전에 setLang 을 부른다.
// 사전 값은 글이거나 함수다. 글 안의 {이름} 은 vars 로 채운다. 함수는 복수형, 숫자, 조사처럼 모양이 바뀔 때 쓴다.
import { renderTemplate } from '../line-template.ts';
import { en, ko } from './dict.ts';

export type Lang = 'ko' | 'en';
/** 설정 값. auto 는 운영체제 말을 따른다 */
export type LangPref = 'auto' | Lang;

type Dict = typeof ko;
export type I18nKey = keyof Dict;
type Vars = Record<string, string | number>;
type Args<K extends I18nKey> = Dict[K] extends (vars: infer V) => string ? [vars: V] : [vars?: Vars];

const DICTS: Record<Lang, Record<string, unknown>> = { ko, en };

let lang: Lang = 'ko';

export const isLang = (v: unknown): v is Lang => v === 'ko' || v === 'en';

export function setLang(next: Lang): void {
  lang = isLang(next) ? next : 'ko';
}

export function getLang(): Lang {
  return lang;
}

/** 날짜, 숫자 모양에 쓰는 말 */
export const locale = (): string => (lang === 'en' ? 'en-US' : 'ko-KR');

/** 설정 값과 운영체제 말 목록으로 실제 말을 정한다. auto 면 첫 말이 한국어일 때만 ko */
export function resolveLang(pref: LangPref, systemLangs: readonly string[]): Lang {
  if (pref === 'ko' || pref === 'en') return pref;
  return systemLangs[0]?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** 사전에서 글을 찾는다. 지금 말에 없으면 한국어, 그것도 없으면 키를 그대로 */
export function t<K extends I18nKey>(key: K, ...args: Args<K>): string {
  return lookup(key, args[0] as Vars | undefined);
}

// 사용자가 고친 펫 대사 (#125, shared/lines.ts). 메인이 시작할 때와 설정에서 고칠 때 넣는다. 고친 칸만 들어 있다
const lineOverrides: Record<Lang, Map<string, string>> = { ko: new Map(), en: new Map() };

/** 고친 대사를 통째로 바꿔 넣는다 (언어마다 {키: 글}). 사전의 기본 글은 그대로 두고 찾을 때 먼저 본다 */
export function setLineOverrides(o: Record<Lang, Record<string, string>>): void {
  for (const l of ['ko', 'en'] as const) {
    lineOverrides[l].clear();
    for (const [k, v] of Object.entries(o[l] ?? {})) if (typeof v === 'string') lineOverrides[l].set(k, v);
  }
}

/** 지금 말에서 사용자가 이 키의 대사를 고쳤는지 */
export const hasLineOverride = (key: string): boolean => lineOverrides[lang].has(key);

function lookup(key: string, vars: Vars | undefined): string {
  const mine = lineOverrides[lang].get(key);
  if (mine !== undefined) return renderTemplate(mine, vars);
  const v = DICTS[lang][key] ?? DICTS.ko[key];
  if (typeof v === 'function') return (v as (vars?: Vars) => string)(vars);
  if (typeof v !== 'string') return key;
  if (!vars) return v;
  // {이름} 과 {이름:은} (값 뒤에 받침에 맞는 조사). 값이 없는 자리는 그대로 둔다
  return renderTemplate(v, vars);
}

/** 시험용: 사전을 직접 보고 싶을 때 */
export const dicts = { ko, en } as const;
