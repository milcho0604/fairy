// 무료 AI(작은 로컬 모델) 답 다듬기 (v2). 작은 모델은 생각 표시를 남기거나, 한자를 섞거나,
// 같은 낱말을 되풀이하거나, 길게 늘어놓는다(2026-10-06 비교 시험). 보여 주기 전에 고친다.

/** 펫 답은 짧게. 이만큼 문장이 넘으면 자른다 (목록과 코드는 자르지 않는다) */
const MAX_SENTENCES = 4;

export function cleanLocalAnswer(text: string, o: { partial?: boolean; banmal?: boolean } = {}): string {
  let s = text;
  // 생각 표시: 닫힌 것은 통째로, 아직 안 닫힌 것은 그 뒤를 모두 (받는 중)
  s = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const open = s.indexOf('<think>');
  if (open >= 0) s = s.slice(0, open);
  // 한자(중국어), 가나(일본어)는 한국어, 영어 답에 섞이면 깨진 토막이다. 코드 블록 밖에서만 지운다
  s = outsideCode(s, (part) =>
    part
      // 일본어 가나도 (1.7B 가 "떠上がって" 처럼 섞었다)
      .replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]+/g, '')
      // 같은 낱말 되풀이 ("전화 전화", "네! 네! 네!"). 낱말 경계가 있어야 한다("사과 과일"은 그대로).
      // 받는 중에는 하지 않는다: 뒤 글자가 오면 되풀이가 아니게 될 수 있어(그 그림) 앞 글이 바뀐다
      // 영어는 "had had" 처럼 두 번은 맞는 말일 수 있어 세 번부터만 줄인다
      .replace(
        o.partial ? /$^/ : /(?<=^|\s)(\S{1,12}?)([!?.,~]*)(?:\s+\1\2)+(?=\s|$)/g,
        (m, w: string, p: string) => (/[가-힣]/.test(w) || m.split(/\s+/).length >= 3 ? w + p : m),
      )
      .replace(/[ \t]{2,}/g, ' '),
  );
  if (o.partial) return s.replace(/^\s+/, '');
  // 다 받은 뒤에만: 혼자 대화를 이어 쓴 부분, 존댓말 어미(작은 모델은 반말 지시를 잘 안 지킨다), 이모지 여러 개
  s = cutFakeTurns(s);
  if (o.banmal) s = outsideCode(s, toBanmal);
  s = limitEmoji(s);
  s = dropRepeatedBlocks(s);
  return cutSentences(s.trim()).trim();
}

/** 같은 코드 블록이나 같은 줄을 되풀이하면 처음 것만 남긴다 (설치본 시험에서 코드 덩어리가 세 번 나옴) */
function dropRepeatedBlocks(s: string): string {
  const seen = new Set<string>();
  return s
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part) => {
      if (part.startsWith('```')) {
        const key = part.replace(/^```\w*/, '').trim();
        if (seen.has(key)) return '';
        seen.add(key);
        return part;
      }
      return part
        .split('\n')
        .filter((line) => {
          // 목록 번호는 빼고 비교한다 ("1. 자료 정리", "2. 자료 정리")
          const key = line.trim().replace(/^([-*]|\d+[.)])\s+/, '');
          if (key.length < 4) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .join('\n');
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n');
}

/** 모델이 혼자 다음 대화를 지어 쓰면 거기서 자르고, 맨 앞의 "콩이:" 같은 이름표를 뗀다 */
function cutFakeTurns(s: string): string {
  const i = s.search(/(^|\n)\s*(사용자|User)\s*:/);
  const head = i >= 0 ? s.slice(0, i) : s;
  return head.replace(/^\s*[^\s:]{1,12}\s*:\s+(?=\S)/, '');
}

const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu;
/** 이모지는 한 개까지 */
function limitEmoji(s: string): string {
  let seen = 0;
  return s.replace(EMOJI, (m) => (seen++ === 0 ? m : ''));
}

const isHangul = (ch: string) => ch >= '가' && ch <= '힣';
const jong = (ch: string) => (ch.charCodeAt(0) - 0xac00) % 28;
/** 끝 낱말 뒤: 문장 부호, 공백, 끝 */
const END = '(?=[.!?~…:,)\\]\\s]|$)';
const FIXED: [RegExp, string][] = [
  [/안녕하세요|안녕하십니까/g, '안녕'],
  [new RegExp(`감사(?:합니다|해요)${END}`, 'g'), '고마워'],
  [new RegExp(`드릴게요?${END}`, 'g'), '줄게'],
  [new RegExp(`드려요${END}`, 'g'), '줄게'],
  [new RegExp(`주세요${END}`, 'g'), '줘'],
  [new RegExp(`보세요${END}`, 'g'), '봐'],
  [new RegExp(`하세요${END}`, 'g'), '해'],
  [new RegExp(`그렇습니다${END}`, 'g'), '그래'],
  [new RegExp(`아닙니다${END}`, 'g'), '아니야'],
  [new RegExp(`합니다${END}`, 'g'), '해'],
  [new RegExp(`됩니다${END}`, 'g'), '돼'],
  [new RegExp(`해요${END}`, 'g'), '해'],
  [new RegExp(`네요${END}`, 'g'), '네'],
  [new RegExp(`군요${END}`, 'g'), '구나'],
  [new RegExp(`(?:지요|죠)${END}`, 'g'), '지'],
];
/** 문장 끝 "요" 를 떼도 되는 앞 글자 (해요체 = 반말 + 요) */
const DROP_YO = new Set('어아해야지네게까래워봐줘돼와가서고데걸대니나다라');
/** "요" 로 끝나도 어미가 아닌 낱말 */
const YO_WORDS = ['필요', '중요', '주요', '수요', '개요', '아니요'];

/**
 * 존댓말 어미를 반말로 (2026-10-06 작은 모델 비교 시험의 후처리). 자주 나오는 꼴만 바꾸고
 * 모르는 꼴은 그대로 둔다. 높임 "-시-"(피곤하셔서)와 ㅂ 불규칙(춥습니다)은 못 고친다.
 */
export function toBanmal(text: string): string {
  let s = text;
  for (const [re, rep] of FIXED) s = s.replace(re, rep);
  // 입니다, 이에요, 예요 → 받침 있으면 이야, 없으면 야
  s = s.replace(new RegExp(`(.)(?:입니다|이에요|예요)${END}`, 'g'), (_m, prev: string) =>
    isHangul(prev) ? prev + (jong(prev) !== 0 ? '이야' : '야') : `${prev}이야`,
  );
  // X습니다 → 있어, 좋아 (받침 ㅆ 은 늘 어)
  s = s.replace(new RegExp(`(.)습니다${END}`, 'g'), (_m, prev: string) => {
    const v = isHangul(prev) ? Math.floor(((prev.charCodeAt(0) - 0xac00) % 588) / 28) : -1;
    return prev + (jong(prev) !== 20 && [0, 2, 8].includes(v) ? '아' : '어');
  });
  // 문장 끝 요 떼기
  s = s.replace(new RegExp(`([가-힣]+)요${END}`, 'g'), (m, word: string) => {
    if (YO_WORDS.some((w) => `${word}요`.endsWith(w))) return m;
    return DROP_YO.has(word.at(-1) ?? '') ? word : m;
  });
  // 저는, 제가 → 나는, 내가
  return s
    .replace(/(^|[\s,.!?])저(는|도|를|랑|한테)(?=\s)/g, '$1나$2')
    .replace(/(^|[\s,.!?])제가(?=\s)/g, '$1내가');
}

/** 코드 블록(```) 밖의 글에만 고치기를 적용한다 */
function outsideCode(s: string, fix: (part: string) => string): string {
  return s
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part) => (part.startsWith('```') ? part : fix(part)))
    .join('');
}

/** 그냥 글이면 앞 몇 문장만. 목록, 코드가 있으면 그대로 (사용자가 정리를 부탁한 답) */
function cutSentences(s: string): string {
  if (/```|^\s*([-*]|\d+\.)\s/m.test(s)) return s;
  const sentences = s.split(/(?<=[.!?。~])\s+/);
  if (sentences.length <= MAX_SENTENCES) return s;
  return sentences.slice(0, MAX_SENTENCES).join(' ').trim();
}
