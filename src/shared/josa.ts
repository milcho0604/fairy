// 펫 이름 뒤에 붙는 조사를 고른다. 이름 끝 소리에 받침이 있으면 앞쪽, 없으면 뒤쪽을 쓴다.
// 예: 콩이랑, 밤이랑, 콩이와, 밤과.

/** [받침 있을 때, 받침 없을 때, 판단 못 할 때] */
const PARTICLES = {
  이랑: ['이랑', '랑', '(이)랑'],
  과: ['과', '와', '와(과)'],
  이: ['이', '가', '이(가)'],
  은: ['은', '는', '은(는)'],
  을: ['을', '를', '을(를)'],
  아: ['아', '야', '아(야)'],
} as const;

export type Particle = keyof typeof PARTICLES;

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 숫자를 우리말로 읽을 때 끝 소리. 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔은 받침이 있다.
const DIGIT_HAS_FINAL = [true, true, false, true, false, false, true, true, true, false];

/**
 * 이름 끝 소리에 받침이 있는지. 판단할 수 없으면 undefined.
 * 한글 음절은 정확하고, 영어는 흔한 읽기를 따르는 추정이다.
 */
export function hasFinalConsonant(name: string): boolean | undefined {
  // 끝의 문장 부호, 이모지, 공백은 건너뛰고 마지막 글자나 숫자를 본다.
  const match = /[가-힣]|[a-z]+|\d+/gi;
  const tokens = name.match(match);
  const last = tokens?.at(-1);
  if (!last) return undefined;

  const code = last.codePointAt(last.length - 1) ?? 0;
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) return (code - HANGUL_FIRST) % 28 !== 0;
  // 10 십, 100 백처럼 0 으로 끝나는 자리 이름도 모두 받침이 있어 끝 숫자만 보면 된다.
  if (/^\d+$/.test(last)) return DIGIT_HAS_FINAL[Number(last.at(-1))];
  return englishHasFinal(last.toLowerCase());
}

function englishHasFinal(word: string): boolean {
  if (word.endsWith('ng')) return true; // King 킹
  if (/[lmn]$/.test(word)) return true; // Bill 빌, Sam 샘, Ben 벤
  // 짧은 모음 뒤 k, p, t, b 는 받침으로 읽는 경우가 많다. Jack 잭, Bob 밥, Kat 캣. Mark 마크는 아니다.
  return /[aeiou](ck|[kptb])$/.test(word);
}

/** 이름에 조사를 붙인다. withParticle('밤', '이랑') === '밤이랑' */
export function withParticle(name: string, particle: Particle): string {
  const [withFinal, withoutFinal, unknown] = PARTICLES[particle];
  const final = hasFinalConsonant(name);
  if (final === undefined) return name + unknown;
  return name + (final ? withFinal : withoutFinal);
}
