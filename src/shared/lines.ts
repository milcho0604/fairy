// 펫 대사 한 곳 관리 (#125). 말풍선 정해진 말은 사전(shared/i18n/*)에 키별로 있다. 이 파일은 그 가운데
// 사용자가 고칠 수 있는 말을 "상황별 목록"(카탈로그)으로 모으고, 사용자가 고친 칸(덮어쓰기)만 따로 저장하게 하는 셈을 둔다.
//  - 대사 데이터는 따로 두지 않는다. 키와 틀은 사전에서 읽으니 #124 처럼 사전에 새 대사를 더하면 알맞은 상황 묶음에 저절로 들어온다.
//  - 덮어쓰기는 {ko: {키: 글}, en: {키: 글}} 이고 고친 칸만 든다. 기본값을 고르는 것은 사전이라 업데이트로 기본 대사가
//    바뀌어도 사용자가 고친 칸은 그대로 남고, 기본으로 되돌리면 칸이 지워질 뿐이다.
//  - 값({name} 같은)이 들어가는 대사는 고친 글에도 같은 값이 있어야 저장한다 (shared/line-template.ts)
import { withParticle } from './josa.ts';
import { checkLine, type LineCheck, renderTemplate } from './line-template.ts';
import type { LinesState } from './lines-ipc.ts';

export type LineLang = 'ko' | 'en';
export const isLineLang = (v: unknown): v is LineLang => v === 'ko' || v === 'en';

/** 덮어쓰기: 언어마다 {키: 고친 글}. 고친 칸만 든다 */
export type LineOverrides = { ko: Record<string, string>; en: Record<string, string> };
export const emptyOverrides = (): LineOverrides => ({ ko: {}, en: {} });

/**
 * 상황 묶음. 앞에 있는 묶음의 접두어가 먼저 맞는다. 접두어에 맞는 사전 키 가운데 말풍선 대사 꼴(글이나 값만 끼우는 함수)인
 * 것만 목록에 든다. 단추 이름, 설정 글 같은 화면 글은 접두어가 달라 들지 않는다
 */
export const LINE_GROUPS = [
  { id: 'hello', prefixes: ['pet.hello.', 'briefing.hi.', 'routine.hi.', 'routine.cue', 'idle.back.'] },
  {
    id: 'idle',
    prefixes: ['idle.any.', 'idle.work.', 'idle.mouse.', 'idle.together.', 'idle.friend.', 'idle.mood.'],
  },
  {
    id: 'time',
    prefixes: [
      'idle.morning.',
      'idle.lunch.',
      'idle.afternoon.',
      'idle.evening.',
      'idle.night.',
      'idle.late.',
      'idle.monday.',
      'idle.friday.',
      'idle.weekend.',
      'idle.week.',
      'idle.season.',
      'idle.special.',
    ],
  },
  { id: 'work', prefixes: ['idle.todo.', 'idle.event.', 'idle.focus.', 'idle.streak.', 'idle.memory.'] },
  {
    id: 'praise',
    prefixes: ['idle.praise.', 'idle.done.', 'companion.cheer.', 'companion.anniv.', 'routine.bye.done'],
  },
  {
    id: 'rest',
    prefixes: ['pet.rest.', 'idle.energy.', 'routine.bye.rest', 'routine.bye.head', 'routine.rest'],
  },
  { id: 'food', prefixes: ['pet.fed', 'pet.full', 'pet.noCoins', 'idle.hungry.', 'pout.hungry.'] },
  { id: 'play', prefixes: ['pet.play.', 'idle.play.', 'play.bubbles.', 'play.laser.', 'play.mole.'] },
  {
    id: 'sulk',
    prefixes: [
      'pet.sulk.',
      'pout.hiddenLong.',
      'pout.lonely.',
      'pout.restIgnored.',
      'pout.unheard.',
      'pout.startled.',
      'pout.stage3.',
      'pout.madeUp.',
      'pout.softer.',
    ],
  },
  { id: 'fun', prefixes: ['fun.joke.', 'fun.tickle.', 'fun.five.'] },
] as const;

export type LineGroupId = (typeof LINE_GROUPS)[number]['id'];

/** 카탈로그 한 줄 */
export interface LineDef {
  key: string;
  group: LineGroupId;
  /** 기본 대사 틀 (지금 언어 사전에서) */
  base: string;
  /** 틀 안에 쓰인 값 이름 (펫 이름 name 등) */
  vars: string[];
}

type Dict = Record<string, unknown>;

// ---- 사전 함수 값을 틀로 풀기 ----

const OPEN = '';
const CLOSE = '';
const MARK = new RegExp(`${OPEN}(\\w+)${CLOSE}[가각]`, 'g');
/** 받침 없는 말과 있는 말로 조사가 어떻게 갈리는지 보고 조사를 알아낸다 */
const PROBE_PARTICLES = ['이랑', '과', '이', '은', '을', '아', '이다', '으로'] as const;

/** 값만 끼우는 함수인지 거르는 데 쓰는 소스 읽기. 글(따옴표 안)을 지우고 ${} 안의 식만 남긴다 */
function codeOf(src: string): string {
  const noQuote = src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
  return noQuote.replace(
    /`((?:[^`\\]|\\.)*)`/g,
    (_m, body: string) => [...body.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(' + ') || "''",
  );
}

/** 값 이름 말고는 부르는 함수가 없고 갈래(조건, 반복, 색인)가 없는 함수 */
function plainFunction(fn: (...a: never[]) => string): boolean {
  const code = codeOf(Function.prototype.toString.call(fn));
  // ?? (값이 없을 때 기본값)은 값을 늘 채워 넘기니 갈래로 보지 않는다
  const body = code.slice(code.indexOf('=>') + 2).replace(/\?\?/g, '');
  if (/\?|&&|\|\||\bif\b|\bswitch\b|\bfor\b|\bwhile\b|\[/.test(body)) return false;
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) if (m[1] !== 'withParticle') return false;
  return true;
}

/**
 * 사전 값을 대사 틀로. 글이면 그대로, 값만 끼우는 함수면 값 자리를 {이름} (조사가 붙었으면 {이름:은}) 으로 풀어 낸 글.
 * 갈래가 있는 함수, 개수에 따라 모양이 바뀌는 함수 같은 것은 undefined (사용자가 고칠 수 없다)
 */
export function templateOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v !== 'function') return undefined;
  const fn = v as (vars: Record<string, string>) => string;
  if (!plainFunction(fn as never)) return undefined;
  const names = new Set<string>();
  const probe = (tail: string) =>
    new Proxy(
      {},
      {
        get: (_t, name) => {
          if (typeof name !== 'string') return undefined;
          names.add(name);
          return `${OPEN}${name}${CLOSE}${tail}`;
        },
      },
    ) as Record<string, string>;
  let a: unknown;
  let b: unknown;
  try {
    a = fn(probe('가'));
    b = fn(probe('각'));
  } catch {
    return undefined;
  }
  if (typeof a !== 'string' || typeof b !== 'string') return undefined;
  const partsA = a.split(MARK);
  const partsB = b.split(MARK);
  // split 에 잡는 묶음이 있어 [글, 이름, 글, 이름, ...] 이다
  if (partsA.length !== partsB.length) return undefined;
  let out = '';
  for (let i = 0; i < partsA.length; i++) {
    const x = partsA[i] ?? '';
    const y = partsB[i] ?? '';
    if (i % 2 === 1) {
      if (x !== y) return undefined;
      out += `{${x}}`;
      continue;
    }
    if (x === y) {
      out += x;
      continue;
    }
    // 이름 바로 뒤 글이 받침 있고 없고에 따라 갈리면 조사다
    const hit = PROBE_PARTICLES.find((p) => {
      const s1 = withParticle('가', p).slice(1);
      const s2 = withParticle('각', p).slice(1);
      return i > 0 && x.startsWith(s1) && y.startsWith(s2) && x.slice(s1.length) === y.slice(s2.length);
    });
    if (!hit) return undefined;
    const s1 = withParticle('가', hit).slice(1);
    // 방금 쓴 {이름} 을 {이름:조사} 로 바꾼다
    out = out.replace(/\{(\w+)\}$/, `{$1:${hit}}`) + x.slice(s1.length);
  }
  // 값 자리를 하나도 안 쓰면서 이름만 읽은 경우는 없다 (읽었는데 안 쓴 값은 틀에 없으니 무시)
  return out;
}

// ---- 카탈로그 ----

/** 접두어에 맞아도 말풍선 대사가 아닌 것 (단추 이름, 장난감 이름) */
const NOT_SPEECH = new Set(['fun.five.button']);

/** 사전 키가 속한 상황 묶음. 어디에도 안 속하면 undefined */
export function groupOf(key: string): LineGroupId | undefined {
  if (NOT_SPEECH.has(key)) return undefined;
  return LINE_GROUPS.find((g) => g.prefixes.some((p) => key.startsWith(p)))?.id;
}

/** 말투 변형(voice.<성격>.키)은 따로 고치지 않는다: 기본 키를 고치면 모든 말투가 그 글을 쓴다 (shared/persona-voice.ts) */
const isVariant = (key: string) => key.startsWith('voice.');

/** 사전에서 고칠 수 있는 대사 목록. 묶음 순서, 묶음 안은 사전 순서 */
export function buildCatalog(dict: Dict): LineDef[] {
  const out: LineDef[] = [];
  for (const [key, value] of Object.entries(dict)) {
    if (isVariant(key)) continue;
    const group = groupOf(key);
    if (!group) continue;
    const base = templateOf(value);
    if (base === undefined || !base.trim()) continue;
    out.push({
      key,
      group,
      base,
      vars: [...base.matchAll(/\{(\w+)(?::[^{}]+)?\}/g)]
        .map((m) => m[1] ?? '')
        .filter((v, i, a) => a.indexOf(v) === i),
    });
  }
  const order = LINE_GROUPS.map((g) => g.id) as string[];
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

// ---- 덮어쓰기 ----

/** 파일에서 읽은 값을 믿지 않고 걸러 낸다: 모양이 맞는 {ko, en} 글 칸만 */
export function parseOverrides(raw: unknown): LineOverrides {
  const out = emptyOverrides();
  if (typeof raw !== 'object' || raw === null) return out;
  for (const lang of ['ko', 'en'] as const) {
    const part = (raw as Record<string, unknown>)[lang];
    if (typeof part !== 'object' || part === null) continue;
    for (const [key, value] of Object.entries(part)) {
      if (typeof value === 'string' && value.trim() && key.length < 120) out[lang][key] = value;
    }
  }
  return out;
}

/** 덮어쓰기 하나 더하기: 기본 틀과 견줘 검사한 뒤 합친 덮어쓰기. 기본과 같은 글이면 칸을 지운다 (고친 칸만 저장) */
export function setOverride(
  current: LineOverrides,
  lang: LineLang,
  def: Pick<LineDef, 'key' | 'base'>,
  edited: string,
): { ok: true; overrides: LineOverrides } | { ok: false; check: Exclude<LineCheck, { ok: true }> } {
  const check = checkLine(def.base, edited);
  if (!check.ok) return { ok: false, check };
  const next: LineOverrides = { ko: { ...current.ko }, en: { ...current.en } };
  if (check.text === def.base) delete next[lang][def.key];
  else next[lang][def.key] = check.text;
  return { ok: true, overrides: next };
}

/** 기본값으로 되돌리기: 그 칸을 지운다 (key 를 안 주면 그 언어 전부) */
export function resetOverride(current: LineOverrides, lang: LineLang, key?: string): LineOverrides {
  const next: LineOverrides = { ko: { ...current.ko }, en: { ...current.en } };
  if (key === undefined) next[lang] = {};
  else delete next[lang][key];
  return next;
}

/**
 * 덮어쓰기를 지금 사전에 맞춰 정리한다: 사전에서 사라진 키, 대사가 아니게 된 키, 기본 대사의 값이 바뀌어
 * 고친 글이 검사를 못 넘는 칸은 버린다 (업데이트로 {name} 이 새로 생긴 대사의 옛 수정이 값 없이 나오지 않게)
 */
export function pruneOverrides(current: LineOverrides, dicts: Record<LineLang, Dict>): LineOverrides {
  const next = emptyOverrides();
  for (const lang of ['ko', 'en'] as const) {
    for (const [key, text] of Object.entries(current[lang])) {
      if (!groupOf(key) || isVariant(key)) continue;
      const base = templateOf(dicts[lang][key]);
      if (base === undefined) continue;
      const c = checkLine(base, text);
      if (c.ok) next[lang][key] = c.text;
    }
  }
  return next;
}

/** 덮어쓴 글로 만든 말. 값 자리를 채운다 */
export const renderOverride = renderTemplate;

/** 덮어쓰기에서 한 칸 읽기 */
export function overrideOf(o: LineOverrides, lang: LineLang, key: string): string | undefined {
  return Object.hasOwn(o[lang], key) ? o[lang][key] : undefined;
}

/** 설정 화면에 보낼 목록: 상황 묶음별 대사, 기본 틀, 지금 틀, 고친 칸 표시 */
export function buildLinesState(
  dict: Dict,
  lang: LineLang,
  overrides: LineOverrides,
  petName: string,
): LinesState {
  const catalog = buildCatalog(dict);
  const groups = LINE_GROUPS.map((g) => ({
    id: g.id,
    lines: catalog
      .filter((d) => d.group === g.id)
      .map((d) => {
        const mine = overrideOf(overrides, lang, d.key);
        return { key: d.key, base: d.base, text: mine ?? d.base, edited: mine !== undefined, vars: d.vars };
      }),
  })).filter((g) => g.lines.length > 0);
  const edited = groups.reduce((n, g) => n + g.lines.filter((l) => l.edited).length, 0);
  return { lang, petName, edited, groups };
}
