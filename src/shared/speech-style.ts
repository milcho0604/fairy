// 내 말투 (2026-10-11, 사용자 요청): 펫이 말풍선으로 하는 정해진 말을 AI 없이 바꾸는 규칙.
// 말 높이(반말, 해요체, 합쇼체, 하오체), 말끝 붙이기(냥, 멍), 나를 부르는 말(집사, 주인님), 이모지, 느낌표 세기,
// 그리고 때(아침 인사, 칭찬, 쉬자는 말, 잘 자)마다 직접 쓴 말. 프리셋 말투(활발한 응원단, 고양이체 등)도 이 규칙으로 만든다.
// 바꾸는 것은 문장 끝뿐이다: 따옴표와 괄호 안(할 일, 일정 제목, 시각)은 그대로 둔다. 순수 함수라 화면(미리 보기)도 쓴다
import { hasFinalConsonant, withParticle } from './josa.ts';

export type SpeechLevel = 'banmal' | 'haeyo' | 'hapsyo' | 'hao';
export type EmojiLevel = 'many' | 'some' | 'none';
export type BangLevel = 'soft' | 'normal' | 'strong';
export type CallKind = 'none' | 'butler' | 'master' | 'name' | 'custom';
export const MOMENTS = ['morning', 'praise', 'rest', 'night'] as const;
export type Moment = (typeof MOMENTS)[number];

export interface SpeechStyle {
  /** 말 높이. 내 말투에서는 반말, 해요체, 합쇼체만 고른다 (하오체는 선비 말투 프리셋) */
  level: SpeechLevel;
  /** 문장 끝에 붙이는 말 (냥, 멍). 빈 글이면 없음. 세 글자까지 */
  ending: string;
  /** 나를 부르는 말 */
  call: CallKind;
  /** call 이 name(내 이름), custom(직접) 일 때 그 말 */
  callText: string;
  emoji: EmojiLevel;
  bang: BangLevel;
  /** 때마다 직접 쓴 말 (여러 개면 하나를 고른다). {name} 펫 이름, {me} 나를 부르는 말, {todo} 할 일 */
  lines: Record<Moment, string[]>;
}

/** 세 글자, 부르는 말 열 글자, 직접 쓴 말 한 때에 다섯 줄, 한 줄 80자 */
export const ENDING_MAX = 3;
export const CALL_MAX = 10;
export const LINES_MAX = 5;
export const LINE_MAX = 80;

export const DEFAULT_STYLE: SpeechStyle = {
  level: 'banmal',
  ending: '',
  call: 'none',
  callText: '',
  emoji: 'some',
  bang: 'normal',
  lines: { morning: [], praise: [], rest: [], night: [] },
};

/** 내 말투 칸에서 고르는 말끝 */
export const ENDING_CHIPS = ['냥', '멍', '뿌', '용'] as const;

// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 지우려고 찾는다
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
/** 저장, 화면에서 온 글: 제어 문자와 앞뒤 빈칸을 지우고 max 글자(글자 단위)까지 */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
}

const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : d;

/** 저장 파일이나 화면에서 온 값을 내 말투로. 모르는 값은 기본값 (옛 설정은 기본값) */
export function parseStyle(raw: unknown): SpeechStyle {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawLines = (typeof r.lines === 'object' && r.lines !== null ? r.lines : {}) as Record<
    string,
    unknown
  >;
  const lines = {} as Record<Moment, string[]>;
  for (const m of MOMENTS) {
    const list = Array.isArray(rawLines[m]) ? (rawLines[m] as unknown[]) : [];
    lines[m] = list
      .slice(0, LINES_MAX * 2)
      .map((x) => cleanText(x, LINE_MAX))
      .filter(Boolean)
      .slice(0, LINES_MAX);
  }
  return {
    // 내 말투는 하오체를 고르지 않는다 (선비 말투 프리셋만)
    level: pick(r.level, ['banmal', 'haeyo', 'hapsyo'] as const, DEFAULT_STYLE.level),
    ending: cleanText(r.ending, ENDING_MAX).replace(/[.!?~,]/g, ''),
    call: pick(r.call, ['none', 'butler', 'master', 'name', 'custom'] as const, DEFAULT_STYLE.call),
    callText: cleanText(r.callText, CALL_MAX),
    emoji: pick(r.emoji, ['many', 'some', 'none'] as const, DEFAULT_STYLE.emoji),
    bang: pick(r.bang, ['soft', 'normal', 'strong'] as const, DEFAULT_STYLE.bang),
    lines,
  };
}

// ---- 한글 글자 ----

const BASE = 0xac00;
const isSyllable = (ch: string | undefined) => !!ch && ch >= '가' && ch <= '힣';
/** 글자를 초성, 중성, 종성 번호로 */
function split(ch: string): [number, number, number] {
  const n = (ch.codePointAt(0) ?? BASE) - BASE;
  return [Math.floor(n / 588), Math.floor((n % 588) / 28), n % 28];
}
const join = (l: number, v: number, f: number) => String.fromCodePoint(BASE + l * 588 + v * 28 + f);
const F_RIEUL = 8;
const F_BIEUP = 17;
/** 받침을 바꾼다 (f 번호) */
const withFinal = (ch: string, f: number) => {
  const [l, v] = split(ch);
  return join(l, v, f);
};
const finalOf = (ch: string | undefined) => (isSyllable(ch) ? split(ch as string)[2] : -1);

/** 받침 없는 마지막 글자의 해요체 줄임을 풀어 원래 말끝 모음으로 (해→하, 봐→보, 려→리, 줘→주) */
const UNCONTRACT: Record<string, string> = {
  해: '하',
  돼: '되',
  봐: '보',
  와: '오',
  줘: '주',
  려: '리',
  져: '지',
  쳐: '치',
  켜: '키',
  펴: '피',
  껴: '끼',
  겨: '기',
  셔: '시',
  여: '이',
  뎌: '디',
  텨: '티',
  혀: '히',
  녀: '니',
  며: '미',
  벼: '비',
  워: '우',
};
/** ㅡ 탈락 (아파요 → 아프-) */
const EU: Record<string, string> = { 파: '프', 빠: '쁘', 뻐: '쁘', 커: '크', 써: '쓰', 떠: '뜨', 꺼: '끄' };

/**
 * 해요체 말끝 하나(문장의 마지막 낱말)를 합쇼체나 하오체로. 모르는 모양이면 undefined (그대로 둔다).
 * q 는 물음(? 로 끝남)
 */
function formalWord(word: string, level: 'hapsyo' | 'hao', q: boolean, prop = false): string | undefined {
  const hap = level === 'hapsyo';
  // 끝이 확실한 말
  const fixed: [RegExp, string, string][] = [
    [/거(예|에)요$/, '것입니다', '것이오'],
    [/어때요$/, q ? '어떻습니까' : '어떻습니다', '어떻소'],
    [/아니에요$/, '아닙니다', '아니오'],
    [/이에요$/, q ? '입니까' : '입니다', '이오'],
    // 받침 없는 이름씨 뒤 하오체 이다는 요 (하나예요 → 하나요, 최고예요 → 최고요)
    [/예요$/, q ? '입니까' : '입니다', '요'],
    [/닌가요$/, '닙니까', '니오'],
    [/인가요$/, '입니까', '이오'],
    [/겠습니다$/, '겠습니다', '겠소'],
    [/입니다$/, '입니다', isSyllable(word.at(-4)) && finalOf(word.at(-4)) === 0 ? '요' : '이오'],
    [/실래요$/, '시겠습니까', '시겠소'],
    [/세요$/, q ? '십니까' : '', ''],
    [/을까요$/, '을까요', '으리까'],
  ];
  for (const [re, h, o] of fixed) {
    if (!re.test(word)) continue;
    const to = hap ? h : o;
    if (to) return word.replace(re, to);
    break;
  }
  if (/세요$/.test(word)) {
    // 해 주세요, 쉬세요 (시키는 말) / 대단하세요, 계세요 (그렇다는 말)
    const stem = word.slice(0, -2);
    const states = /(대단하|부지런하|계|멋지|좋으|빠르|바쁘|훌륭하|이)$/;
    if (states.test(stem)) return `${stem}${hap ? '십니다' : '시오'}`;
    return `${stem}${hap ? '십시오' : '시오'}`;
  }
  // 을게요 / ㄹ게요 → 겠습니다
  if (/을게요$/.test(word)) return `${word.slice(0, -3)}${hap ? '겠습니다' : '겠소'}`;
  if (/게요$/.test(word)) {
    const s = word.slice(0, -2);
    const last = s.at(-1);
    if (finalOf(last) === F_RIEUL)
      return `${s.slice(0, -1)}${withFinal(last as string, 0)}${hap ? '겠습니다' : '겠소'}`;
  }
  // ㄹ까요 (드릴까요): 합쇼체는 그대로, 하오체는 리까 (드리리까)
  if (/까요$/.test(word)) {
    if (hap) return word;
    const s = word.slice(0, -2);
    const last = s.at(-1);
    return finalOf(last) === F_RIEUL ? `${s.slice(0, -1)}${withFinal(last as string, 0)}리까` : `${s}리까`;
  }
  // 하오체: 존댓말 비서 말에 이미 있는 습니다 (잘 먹겠습니다)
  if (!hap && /습니다$/.test(word)) return `${word.slice(0, -3)}소`;
  if (!hap && /니다$/.test(word)) {
    const s = word.slice(0, -2);
    const last = s.at(-1);
    if (finalOf(last) === F_BIEUP) return `${s.slice(0, -1)}${withFinal(last as string, 0)}오`;
  }
  // 래요(할래요) → 겠습니다
  if (/래요$/.test(word)) {
    const s = word.slice(0, -2);
    const last = s.at(-1);
    if (finalOf(last) === F_RIEUL)
      return `${s.slice(0, -1)}${withFinal(last as string, 0)}${hap ? (q ? '겠습니까' : '겠습니다') : '겠소'}`;
  }
  // 하오체의 네요, 군요 → 구려 (오셨네요 → 오셨구려)
  if (!hap && /(네요|군요)$/.test(word)) return `${word.slice(0, -2)}구려`;
  // 네요, 군요, 는데요, 죠, 지요, 나요 → 말 줄기 + 습니다
  let stem: string | undefined;
  for (const tail of ['는데요', '네요', '군요', '지요', '죠', ...(q ? ['나요'] : [])])
    if (word.endsWith(tail)) stem = word.slice(0, -tail.length);
  if (stem !== undefined) return stem ? endStem(stem, hap, q) : undefined;
  // 어요, 아요 (받침 있는 줄기): 있어요 → 있습니다, 좋아요 → 좋습니다, 반가워요 → 반갑습니다
  const m = /(.)(어|아)요$/.exec(word);
  if (m) {
    const s = word.slice(0, -2);
    // 받침 있는 줄기 (있어요 → 있-), 받침 없는 줄기 (쉬어요 → 쉬-)
    if (finalOf(m[1]) >= 0) return endStem(s, hap, q, prop);
  }
  const w = /(.)워요$/.exec(word);
  if (w && isSyllable(w[1]))
    return endStem(`${word.slice(0, -3)}${withFinal(w[1] as string, F_BIEUP)}`, hap, q);
  // 줄인 모음 + 요: 해요 → 하-, 드려요 → 드리-, 가요 → 가-
  const v = /(.)요$/.exec(word);
  if (v && isSyllable(v[1]) && finalOf(v[1]) === 0) {
    const ch = v[1] as string;
    const base = UNCONTRACT[ch] ?? EU[ch] ?? ch;
    return endStem(`${word.slice(0, -2)}${base}`, hap, q, prop);
  }
  return undefined;
}

/** 말 줄기 + 습니다/ㅂ니다 (하오체는 소/오). prop 이면 같이 하자는 말 (합시다, 읍시다) */
function endStem(stem: string, hap: boolean, q: boolean, prop = false): string {
  const last = stem.at(-1);
  if (!isSyllable(last)) return stem;
  const f = finalOf(last);
  const head = stem.slice(0, -1);
  // 지난 일(았, 었)은 같이 하자는 말이 아니다
  if (hap && prop && !q && f !== 20) {
    if (f === 0) return `${head}${withFinal(last as string, F_BIEUP)}시다`;
    if (f === F_RIEUL) return `${head}${withFinal(last as string, F_BIEUP)}시다`;
    return `${stem}읍시다`;
  }
  if (f === 0) {
    if (!hap) return `${stem}오`;
    return `${head}${withFinal(last as string, F_BIEUP)}${q ? '니까' : '니다'}`;
  }
  if (f === F_RIEUL) {
    // ㄹ 줄기: 알- → 압니다, 아오
    if (!hap) return `${head}${withFinal(last as string, 0)}오`;
    return `${head}${withFinal(last as string, F_BIEUP)}${q ? '니까' : '니다'}`;
  }
  if (!hap) return `${stem}소`;
  return `${stem}${q ? '습니까' : '습니다'}`;
}

// ---- 문장 나누기 ----

interface Piece {
  /** 문장 몸 (끝 부호 앞) */
  body: string;
  /** 문장 끝 부호와 뒤 빈칸 ("! ", "?", "") */
  tail: string;
}

const OPEN = new Set(['"', "'", '“', '‘', '(', '「']);
const CLOSE: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '(': ')', '「': '」' };

/** 문장으로 나눈다. 따옴표와 괄호 안의 부호는 문장 끝으로 보지 않는다 */
function sentences(text: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  let start = 0;
  let close: string | undefined;
  while (i < text.length) {
    const ch = text[i] as string;
    if (close) {
      if (ch === close) close = undefined;
      i++;
      continue;
    }
    // 영어 줄임표(it's)는 따옴표가 아니다: 앞이 글자면 넘어간다
    if (OPEN.has(ch) && !(ch === "'" && /\w/.test(text[i - 1] ?? ''))) {
      close = CLOSE[ch];
      i++;
      continue;
    }
    if (/[.!?…~\n]/.test(ch)) {
      let j = i;
      while (j < text.length && /[.!?…~\n]/.test(text[j] as string)) j++;
      while (j < text.length && text[j] === ' ') j++;
      out.push({ body: text.slice(start, i), tail: text.slice(i, j) });
      start = j;
      i = j;
      continue;
    }
    i++;
  }
  if (start < text.length) out.push({ body: text.slice(start), tail: '' });
  return out;
}

/** 문장 몸의 끝이 말끝(풀이말)인지: 마지막이 한글 글자이고 따옴표, 괄호로 끝나지 않는다 */
const PREDICATE_END =
  /(요|죠|니다|니까|시다|시오|구려|[이리]오|소|[야해어아지자네게래다까줘봐돼워려져겨혀쳐켜펴여군걸냐니파내빼와데라]|거든|잖아|구나|(신|끝|만|지|떠|일어|\s)나)$/;
/** 나로 끝나도 풀이말이 아닌 말 (하나, 둘. / 나.) */
const NOT_PREDICATE = /(^|\s)하나$|^나$/;
const endsWithPredicate = (body: string) => {
  const b = body.trimEnd();
  return PREDICATE_END.test(b) && !NOT_PREDICATE.test(b);
};

// ---- 말투 바꾸기 ----

export interface StyleContext {
  /** 지금 말 (영어면 말 높이, 부르는 말 바꾸기는 하지 않는다) */
  lang: 'ko' | 'en';
  /** 나를 부르는 말 (부르는 말이 없으면 빈 글) */
  me: string;
  /** 인사처럼 이름을 불러 시작하는 말인지 */
  greet?: boolean;
  /** 이모지를 많이 고를 때 붙일 그림 (때마다) */
  emoji?: string;
}

/** 나를 부르는 말 (집사, 주인님, 내 이름) */
export function callWord(style: Pick<SpeechStyle, 'call' | 'callText' | 'level'>, lang: 'ko' | 'en'): string {
  if (style.call === 'butler') return lang === 'en' ? 'Butler' : '집사';
  if (style.call === 'master') return lang === 'en' ? 'Master' : '주인님';
  if (style.call === 'name' || style.call === 'custom') return style.callText;
  return '';
}

/** 부를 때 (콩이야, 지민아, 지민님, 집사) */
function vocative(me: string, style: SpeechStyle, lang: 'ko' | 'en'): string {
  if (lang === 'en' || style.call !== 'name') return me;
  if (style.level !== 'banmal') return `${me}님`;
  // 끝 소리를 모르는 이름(이모지, 기호)은 아(야)를 붙이지 않는다
  return hasFinalConsonant(me) === undefined ? me : withParticle(me, '아');
}

/** 반말 줄의 너, 네(너의)를 부르는 말로 (네 편이야 → 집사 편이야, 너도 → 집사도) */
function replaceYou(text: string, me: string): string {
  return text
    .replace(/(^|[\s,])네가(?=\s)/g, (_, a) => `${a}${withParticle(me, '이')}`)
    .replace(/(^|[\s,])너(랑|와)(?=[\s,.!?])/g, (_, a) => `${a}${withParticle(me, '이랑')}`)
    .replace(/(^|[\s,])너(는|도|를|한테|에게|만)(?=[\s,.!?])/g, (_, a, j: string) =>
      j === '는'
        ? `${a}${withParticle(me, '은')}`
        : j === '를'
          ? `${a}${withParticle(me, '을')}`
          : `${a}${me}${j}`,
    )
    .replace(/(^|[\s,])너(?=[\s,.!?])/g, (_, a) => `${a}${me}`)
    .replace(/(^|[\s,])네 (?=[가-힣])/g, (_, a) => `${a}${me} `);
}

const EMOJI_RE = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}/gu;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;

/**
 * 정해진 말 하나를 말투로 바꾼다 (base 는 그 말 높이의 원래 말: 반말이면 다정한 친구, 높임이면 존댓말 비서 말).
 * 따옴표, 괄호 안은 그대로. 바꾸는 것: 말 높이(해요체 → 합쇼체, 하오체), 너 → 부르는 말, 말끝, 느낌표, 이모지
 */
export function applyStyle(base: string, style: SpeechStyle, ctx: StyleContext): string {
  const ko = ctx.lang === 'ko';
  let text = base;
  if (ko && ctx.me && style.level === 'banmal') text = replaceYou(text, ctx.me);
  const parts = sentences(text);
  const ending = endingFor(style.ending, ctx.lang);
  // 영어 말끝(meow)은 문장마다 붙이면 시끄럽다: 말 하나에 한 번, 마지막 낱말로 끝나는 문장에만
  const enAt = ko
    ? -1
    : parts.findLastIndex((p) => /[A-Za-z0-9]$/.test(stripTrailer(p.body.replace(PAREN_END, '')).core));
  const out = parts.map((p, idx) => {
    // 끝에 붙은 괄호 (오전 10:00) 는 떼어 두었다 다시 붙인다 (말끝은 그 앞이다)
    const paren = PAREN_END.exec(p.body);
    let body = paren ? p.body.slice(0, paren.index) : p.body;
    const after = paren ? paren[0] : '';
    let tail = p.tail;
    const q = tail.startsWith('?');
    // 끝에 붙은 이모지 (좋아 🎉) 도 떼어 두었다 다시 붙인다 (말끝은 그 앞이다)
    const cut = stripTrailer(body);
    body = cut.core;
    const pred = ko && endsWithPredicate(body);
    if (ko && pred && (style.level === 'hapsyo' || style.level === 'hao')) {
      const m = /(\S+)(\s*)$/.exec(body);
      if (m) {
        // 같이 하자는 말 (같이 시작해요, 해 봐요 → 시작합시다, 해 봅시다)
        const w = m[1] as string;
        const prop =
          /(봐요|가요)$/.test(w) ||
          (/(^|\s)(같이|함께|또|느긋하게)\s+(\S+\s+)?\S+\s*$/.test(body) &&
            /(해요|어요|아요|나요)$/.test(w) &&
            !/(돼요|있어요|없어요|좋아요|같아요)$/.test(w));
        const formal = formalWord(w, style.level, q, prop);
        if (formal) body = body.slice(0, m.index) + formal + (m[2] ?? '');
      }
    }
    if (ending && ko && pred) body = withEnding(body, ending, q);
    else if (ending && idx === enAt) body = `${body}, ${ending}`;
    body += cut.trailer;
    // 느낌표 세기: 약하게는 ! 를 마침표로 (…! 는 …), 세게는 마침표로 끝난 말끝 문장을 ! 로
    if (style.bang === 'soft')
      tail = tail
        .replace(/!+/g, '.')
        .replace(/([?…])\.+/g, '$1')
        .replace(/\.{4,}/g, '...');
    else if (style.bang === 'strong' && pred && /^\.(\s|$)/.test(tail)) tail = tail.replace('.', '!');
    if (ko && idx === 0 && ctx.greet && ctx.me) body = `${vocative(ctx.me, style, ctx.lang)}, ${body}`;
    return body + after + tail;
  });
  let result = out.join('');
  if (style.emoji === 'none')
    result = result
      .replace(EMOJI_RE, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.!?,])(?=\s|$)/g, '$1')
      .trim();
  else if (style.emoji === 'many' && ctx.emoji && !HAS_EMOJI.test(result))
    result = `${result.trimEnd()} ${ctx.emoji}`;
  return result;
}

/** 문장 끝에 붙은 괄호 (오전 10:00) */
const PAREN_END = /\s*\([^()]*\)\s*$/;

/** 영어 화면의 말끝: 냥, 멍은 영어 울음소리로, 다른 한글 말끝은 붙이지 않는다. 문장 부호와 빈칸은 걷어 낸다 */
const EN_ENDING: Record<string, string> = { 냥: 'meow', 멍: 'woof' };
function endingFor(raw: string, lang: 'ko' | 'en'): string {
  const ending = raw.replace(/[\s.!?~,…'"“”‘’()]/g, '');
  if (lang === 'ko') return ending;
  return EN_ENDING[ending] ?? (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ending) ? '' : ending);
}

/** 문장 몸 끝의 이모지와 빈칸을 떼어 낸다 (core 에 말끝을 붙이고 trailer 를 다시 붙인다) */
function stripTrailer(body: string): { core: string; trailer: string } {
  const m = /(?:\s*(?:\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}))*\s*$/u.exec(body);
  const at = m?.index ?? body.length;
  return { core: body.slice(0, at), trailer: body.slice(at) };
}

/**
 * 한국어 말끝(냥, 멍)을 문장 끝 말에 붙인다. 그냥 붙이면 어색한 모양은 고친다:
 * 이미 그 말끝이면 그대로 (냥냥), 요 + 용은 용 하나로 (좋아요 → 좋아용), 다 + 요는 네요 (찾았다 → 찾았네요),
 * 반말 이다(…야) 는 다로 (하나야 → 하나다냥, 거야 → 거다냥), 냥으로 묻는 말은 냥이 물음 끝이 된다
 * (진짜야? → 진짜냥?, 왔어? → 왔냥?, 괜찮아? → 괜찮냥?)
 */
function withEnding(body: string, ending: string, q: boolean): string {
  if (body.endsWith(ending)) return body;
  if (/^[요용]/.test(ending)) {
    if (body.endsWith('요')) return body.slice(0, -1) + ending;
    // 반말 다 + 요는 네요 (찾았다 → 찾았네요, 월요일이다 → 월요일이네요). 합쇼체 니다는 그대로
    if (body.endsWith('다') && !body.endsWith('니다')) return `${body.slice(0, -1)}네${ending}`;
  }
  const last = body.at(-1);
  const prev = body.at(-2);
  // 반말 이다: 이야, 거야, 모음 뒤 야 (최고야). 해야, 자야(…해야 해의 줄임)는 이다가 아니다
  if (last === '야' && isSyllable(prev) && !/[해워어아자]/.test(prev as string)) {
    // 반말에 요, 용을 붙이면 해요체 이다로 (하나야 → 하나예요, 편이야 → 편이에요)
    if (/^[요용]/.test(ending))
      return prev === '이' ? `${body.slice(0, -1)}에${ending}` : `${body.slice(0, -1)}예${ending}`;
    if (!q) return `${body.slice(0, -1)}다${ending}`;
    if (ending === '냥') return `${body.slice(0, -1)}${ending}`;
  }
  // 냥으로 묻는 말: 받침 있는 줄기 + 아/어 (왔어, 있어, 괜찮아) 는 아/어를 빼고 냥
  if (q && ending === '냥' && (last === '어' || last === '아') && finalOf(prev) > 0)
    return `${body.slice(0, -1)}${ending}`;
  return body + ending;
}

/** 직접 쓴 말의 자리 표시를 채운다: {name} 펫 이름, {me} 나를 부르는 말, {todo} 할 일 */
export function fillLine(line: string, v: { name: string; me: string; todo: string }): string {
  return line
    .replace(/\{name\}/g, v.name)
    .replace(/\{me\}/g, v.me)
    .replace(/\{todo\}/g, v.todo)
    .trim();
}

/** AI 성격 지시에 넣을 내 말투 설명 (채팅 답도 같은 말투가 되게). 직접 쓴 말은 예로 셋까지 */
export function describeStyle(style: SpeechStyle, lang: 'ko' | 'en'): string {
  const me = callWord(style, lang);
  const examples = MOMENTS.flatMap((m) => style.lines[m])
    .slice(0, 3)
    .map((x) => `"${x.replace(/"/g, "'")}"`);
  if (lang === 'en') {
    const level =
      style.level === 'banmal' ? 'You talk casually and warmly.' : 'You talk politely and neatly.';
    return [
      level,
      style.ending ? `End some sentences with "${style.ending}".` : '',
      me ? `Call the user "${me}".` : '',
      style.bang === 'strong' ? 'Sound upbeat, with exclamation marks.' : '',
      style.bang === 'soft' ? 'Keep a calm tone and avoid exclamation marks.' : '',
      examples.length ? `Lines the user likes you to say: ${examples.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  const level =
    style.level === 'banmal'
      ? '반말로 다정하게 말한다.'
      : style.level === 'haeyo'
        ? '해요체 존댓말로 말한다 (…해요, …예요).'
        : style.level === 'hapsyo'
          ? '합쇼체로 또박또박 말한다 (…합니다, …입니까).'
          : '하오체로 점잖게 말한다 (…하오, …소).';
  return [
    level,
    style.ending
      ? `문장 끝마다 ${withParticle(`"${style.ending}"`, '을')} 붙인다 (예: 좋아${style.ending}).`
      : '',
    me ? `사용자를 "${me}"(이)라고 부른다.` : '',
    style.bang === 'strong' ? '느낌표를 자주 써서 힘차게 말한다.' : '',
    style.bang === 'soft' ? '느낌표 없이 차분하게 말한다.' : '',
    examples.length ? `사용자가 좋아하는 말투의 예: ${examples.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
