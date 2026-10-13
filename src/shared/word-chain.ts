// 끝말잇기 (채팅 창에서 AI 없이). 한국어는 끝 글자로, 영어는 끝 알파벳으로 잇는다.
// 규칙: 두 글자 넘게, 앞 말 끝 글자로 시작(한국어는 두음법칙 허용: 력→역, 라→나, 녀→여), 이미 나온 말은 안 된다.
// 사용자 말은 사전을 보지 않고 믿어 준다. 펫은 내장 단어(word-chain-words.ts)에서 고르고, 이을 말이 없으면 진다.
// 여기에는 규칙과 계산만 둔다 (시험할 수 있게). 코인과 채팅 창 잇기는 main/fun.ts.

export type ChainLang = 'ko' | 'en';

export const WORD_CHAIN = {
  /** 펫이 이만큼 이으면 "머리가 핑핑" 하고 진다 (한 판이 끝없이 길지 않게) */
  maxTurns: 15,
  /** 이만큼 말이 없으면 판이 저절로 끝난다 (다음 말은 보통 대화) */
  idleMs: 10 * 60_000,
  /** 이기면 코인. 끝말잇기로 받는 코인은 하루 이만큼까지 (놀이 하루 상한 안에서) */
  coin: 1,
  coinDaily: 2,
  /** 한국어 말 길이 (음절), 영어 말 길이 (글자) */
  ko: [2, 8] as const,
  en: [2, 20] as const,
} as const;

export interface ChainState {
  lang: ChainLang;
  /** 나온 말 (사용자, 펫 다 같이) */
  used: string[];
  /** 펫이 마지막으로 한 말 */
  last: string;
  /** 펫이 이은 수 (처음 말 빼고) */
  turns: number;
  /** 마지막으로 주고받은 시각 */
  at: number;
}

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
/** 초성 ㄴ, ㄹ, ㅇ 번호 */
const NIEUN = 2;
const RIEUL = 5;
const IEUNG = 11;
/** 중성 번호: ㅑ ㅕ ㅖ ㅛ ㅠ ㅣ (ㄹ, ㄴ 이 ㅇ 으로), ㅏ ㅐ ㅗ ㅚ ㅜ ㅡ (ㄹ 이 ㄴ 으로) */
const TO_IEUNG = new Set([2, 6, 7, 12, 17, 20]);
const TO_NIEUN = new Set([0, 1, 8, 11, 13, 18]);

const syllable = (ch: string): { cho: number; jung: number; jong: number } | undefined => {
  const code = ch.codePointAt(0) ?? 0;
  if (ch.length !== 1 || code < HANGUL_FIRST || code > HANGUL_LAST) return undefined;
  const n = code - HANGUL_FIRST;
  return { cho: Math.floor(n / 588), jung: Math.floor((n % 588) / 28), jong: n % 28 };
};
const compose = (cho: number, jung: number, jong: number) =>
  String.fromCodePoint(HANGUL_FIRST + cho * 588 + jung * 28 + jong);

/** 두음법칙으로 바뀐 첫 글자 (력→역, 라→나, 뇨→요). 바뀌지 않으면 undefined */
export function dueum(ch: string): string | undefined {
  const s = syllable(ch);
  if (!s) return undefined;
  if (s.cho === RIEUL && TO_IEUNG.has(s.jung)) return compose(IEUNG, s.jung, s.jong);
  if (s.cho === RIEUL && TO_NIEUN.has(s.jung)) return compose(NIEUN, s.jung, s.jong);
  if (s.cho === NIEUN && TO_IEUNG.has(s.jung)) return compose(IEUNG, s.jung, s.jong);
  return undefined;
}

/** 말의 끝 글자 (한국어 음절, 영어 알파벳) */
export const lastChar = (word: string): string => word.at(-1) ?? '';

/** 끝 글자 ch 다음 말이 시작해도 되는 글자들 (첫 칸이 원래 글자) */
export function startChars(ch: string, lang: ChainLang): string[] {
  if (lang === 'en') return [ch];
  const d = dueum(ch);
  return d && d !== ch ? [ch, d] : [ch];
}

/** 이 글자로 이어도 되는지 */
export const startsRight = (word: string, ch: string, lang: ChainLang): boolean =>
  startChars(ch, lang).includes(word[0] ?? '');

/** 채팅 한 줄을 말 하나로. 'word' 면 이을 말, 'short' 면 한 글자, 'other' 면 말이 아니다 (보통 대화) */
export function readWord(
  text: string,
  lang: ChainLang,
): { kind: 'word'; word: string } | { kind: 'short' } | { kind: 'other' } {
  // 끝의 느낌표, 물음표, 마침표, 물결은 떼고 본다 ("사과!" "사과~")
  const s = text.trim().replace(/[!?.~…]+$/u, '');
  if (lang === 'ko') {
    if (!/^[가-힣]+$/.test(s)) return { kind: 'other' };
    const [lo, hi] = WORD_CHAIN.ko;
    if (s.length < lo) return { kind: 'short' };
    return s.length <= hi ? { kind: 'word', word: s } : { kind: 'other' };
  }
  const w = s.toLowerCase();
  if (!/^[a-z]+$/.test(w)) return { kind: 'other' };
  const [lo, hi] = WORD_CHAIN.en;
  if (w.length < lo) return { kind: 'short' };
  return w.length <= hi ? { kind: 'word', word: w } : { kind: 'other' };
}

/** 띄어쓰기, 문장 부호를 빼고 소문자로 (시작, 그만 말 맞추기) */
const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s!?.~…,'"]+/gu, '')
    .trim();

const START_KO = /^끝말잇기(하자|해|할래|해줘|하고싶어|하고놀자|ㄱ+|고)?$/;
const START_EN = /^(let'?s)?(play)?(a)?wordchain(game)?(please)?$/;

/** 끝말잇기를 하자는 말인지 ("끝말잇기", "끝말 잇기 하자", "word chain") */
export const isChainStart = (text: string): boolean => {
  const s = squash(text);
  return START_KO.test(s) || START_EN.test(s.replace(/'/g, ''));
};

const GIVE_UP = new Set([
  '그만',
  '그만할래',
  '그만하자',
  '그만해',
  '몰라',
  '모르겠어',
  '졌다',
  '졌어',
  '내가졌어',
  '항복',
  '포기',
  '끝',
  'stop',
  'quit',
  'giveup',
  'igiveup',
  'iquit',
  'youwin',
  'idontknow',
  'idk',
]);

/** 그만하겠다(지겠다)는 말인지 */
export const isGiveUp = (text: string): boolean => GIVE_UP.has(squash(text).replace(/'/g, ''));

/** 펫이 이을 말: 시작 글자가 맞고 아직 안 나온 것 중 아무거나. 없으면 undefined */
export function pickWord(
  ch: string | undefined,
  used: readonly string[],
  words: readonly string[],
  lang: ChainLang,
  rand: () => number,
): string | undefined {
  const seen = new Set(used);
  const ok = words.filter((w) => !seen.has(w) && (ch === undefined || startsRight(w, ch, lang)));
  if (!ok.length) return undefined;
  return ok[Math.min(ok.length - 1, Math.floor(rand() * ok.length))];
}

/** 새 판: 펫이 먼저 말한다. 첫 말은 이을 말이 있는 끝 글자로 (처음부터 막히지 않게) */
export function startChain(
  lang: ChainLang,
  words: readonly string[],
  rand: () => number,
  now: number,
): ChainState {
  const easy = words.filter((w) => pickWord(lastChar(w), [w], words, lang, () => 0) !== undefined);
  const word = pickWord(undefined, [], easy, lang, rand) ?? (lang === 'ko' ? '사과' : 'apple');
  return { lang, used: [word], last: word, turns: 0, at: now };
}

/** 판이 오래 쉬어서 끝났는지 */
export const chainExpired = (s: ChainState, now: number): boolean => now - s.at > WORD_CHAIN.idleMs;

export type ChainStep =
  /** 말이 아니다: 판을 조용히 끝내고 보통 대화로 넘긴다 */
  | { kind: 'leave' }
  /** 사용자가 그만 (펫이 이긴다) */
  | { kind: 'giveUp' }
  /** 한 글자 */
  | { kind: 'short'; state: ChainState }
  /** 첫 글자가 틀렸다 (다시) */
  | { kind: 'wrongStart'; need: string[]; state: ChainState }
  /** 이미 나온 말 (다시) */
  | { kind: 'used'; word: string; state: ChainState }
  /** 펫이 이을 말이 없다 (사용자가 이긴다) */
  | { kind: 'stumped'; need: string[] }
  /** 펫이 많이 이어서 지친다 (사용자가 이긴다) */
  | { kind: 'tired'; turns: number }
  /** 펫이 이었다 */
  | { kind: 'next'; word: string; need: string[]; state: ChainState };

/** 사용자 한 줄을 받아 한 번 주고받는다 */
export function chainTurn(
  s: ChainState,
  text: string,
  words: readonly string[],
  rand: () => number,
  now: number,
): ChainStep {
  if (isGiveUp(text)) return { kind: 'giveUp' };
  const read = readWord(text, s.lang);
  if (read.kind === 'other') return { kind: 'leave' };
  const touched = { ...s, at: now };
  if (read.kind === 'short') return { kind: 'short', state: touched };
  const { word } = read;
  const ch = lastChar(s.last);
  if (!startsRight(word, ch, s.lang))
    return { kind: 'wrongStart', need: startChars(ch, s.lang), state: touched };
  if (s.used.includes(word)) return { kind: 'used', word, state: touched };
  const used = [...s.used, word];
  const end = lastChar(word);
  const need = startChars(end, s.lang);
  if (s.turns >= WORD_CHAIN.maxTurns) return { kind: 'tired', turns: s.turns };
  const mine = pickWord(end, used, words, s.lang, rand);
  if (!mine) return { kind: 'stumped', need };
  return {
    kind: 'next',
    word: mine,
    need: startChars(lastChar(mine), s.lang),
    state: { ...touched, used: [...used, mine], last: mine, turns: s.turns + 1 },
  };
}

/** 끝말잇기로 받을 코인: 이번에 원하는 만큼(want)에서 오늘 끝말잇기로 받은 만큼(chainToday)을 빼고 */
export const chainCoinsAllowed = (want: number, chainToday: number): number =>
  Math.max(0, Math.min(want, WORD_CHAIN.coinDaily - chainToday));
