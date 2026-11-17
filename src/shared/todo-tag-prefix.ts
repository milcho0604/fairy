// 태그로 걸러 보는 중의 새 할 일 칸 (2026-11-17). 칸이 비어 있으면 앞에 "#태그 " 를 미리 넣어 두고,
// 그대로 입력하면 그 태그가 붙게 한다. 순수 함수만 둔다 (화면은 TodoTab, 시험은 todo-tag-prefix.test.ts).
//
// 정한 규칙:
// - 칸에 사용자가 쓴 글이 있으면(공백뿐인 것 말고) 넣지 않는다. 쓰던 글, 붙여 넣은 글, 보관소에서 돌아온 글은 그대로다.
// - 자동으로 넣은 앞머리는 화면이 "자동 앞머리" 로 기억한다. 사용자가 그 글자를 하나라도 고치면 그 순간부터 사용자 글이라
//   다시는 건드리지 않는다 (직접 친 태그와 자동 태그를 글자 모양으로는 못 가르기 때문).
// - 태그를 풀면 자동 앞머리만 지우고, 다른 태그로 바꾸면 자동 앞머리만 바꾼다. 그 뒤에 쓴 글은 그대로다.
// - 할 일을 넣은 직후 칸이 비면 같은 태그를 다시 넣는다 (같은 태그로 이어서 적게). 사용자가 지운 칸에는 되넣지 않는다.

import { parseTodoLine, type QuickTodoTimed } from './remind-parse.ts';

const LEAD_TAG = /^#([\p{L}\p{N}_-]{1,20})[ \t]+/u;

/** 자동으로 넣는 앞머리: "#태그 " */
export const tagPrefix = (tag: string): string => `#${tag} `;

export interface PrefixSync {
  /** 칸에 들어갈 글 */
  text: string;
  /** 지금 칸 앞에 자동으로 넣어 둔 앞머리 (없으면 null) */
  auto: string | null;
  /** 글이 바뀌었는지 (바뀌면 커서를 글 끝으로 옮긴다) */
  changed: boolean;
}

/**
 * 고른 태그가 바뀌었을 때 칸의 글을 맞춘다.
 * auto: 지금 칸 앞에 자동으로 넣어 둔 앞머리 (없으면 null). tag: 새로 고른 태그 (없으면 null)
 */
export function syncTagPrefix(text: string, auto: string | null, tag: string | null): PrefixSync {
  // 자동 앞머리가 그대로 앞에 있을 때만 우리 것이다. 고쳐졌으면 사용자 글
  const mine = auto !== null && text.startsWith(auto);
  const rest = mine ? text.slice(auto.length) : text;
  if (!tag) return { text: rest, auto: null, changed: rest !== text };
  if (rest.trim() !== '' && !mine) return { text, auto: null, changed: false };
  const prefix = tagPrefix(tag);
  const next = `${prefix}${rest.trim() === '' ? '' : rest}`;
  return { text: next, auto: prefix, changed: next !== text };
}

/** 사용자가 칸을 고쳤다. 자동 앞머리가 그대로 남아 있지 않으면 더는 우리 것이 아니다 */
export function keepAuto(text: string, auto: string | null): string | null {
  return auto !== null && text.startsWith(auto) ? auto : null;
}

/**
 * 한 줄 앞에 붙은 "#태그 " 들을 떼어 낸다 ("#회사 #급함 내일 보고서" → lead "#회사 #급함 ", rest "내일 보고서").
 * 앞머리 태그가 있으면 날짜, 반복, 시각 낱말이 "맨 앞" 이 아니게 돼 읽히지 않으므로 넣을 때는 떼고 읽은 뒤 제목 앞에 되붙인다.
 * 태그뿐인 줄은 뗄 것이 없다 (제목이 비므로 그대로 둔다)
 */
export function splitLeadTags(line: string): { lead: string; rest: string } {
  let rest = line.normalize('NFC').trimStart();
  let lead = '';
  for (;;) {
    const m = rest.match(LEAD_TAG);
    if (!m || /^\d+$/.test(m[1] ?? '')) break;
    lead += `#${m[1]} `;
    rest = rest.slice(m[0].length);
  }
  if (!lead || rest.trim() === '') return { lead: '', rest: line };
  return { lead, rest };
}

/** 화면이 보낸 자동 앞머리가 맞는 모양("#태그 " 하나)인지. 아니면 null */
export function autoLeadInput(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC');
  const m = s.match(LEAD_TAG);
  return m && m[0] === s && !/^\d+$/.test(m[1] ?? '') ? s : null;
}

/** 앞머리 태그 하나를 제목 끝으로 옮긴다 ("점검표 쓰기" + "#회사 " 는 "점검표 쓰기 #회사") */
export const tagToEnd = (title: string, auto: string): string => `${title} ${auto.trim()}`;

/**
 * 태그를 뗀 나머지가 날짜 낱말뿐이면("#회사 내일") 읽는 쪽이 제목을 비우지 않으려고 그 낱말을 제목으로 남긴다.
 * 이때는 태그까지 한 줄로 읽어 제목은 태그, 날짜는 마감으로 한다 (태그를 안 떼던 때와 같은 결과). 아니면 null
 */
export function readTagOnlyTodo(
  lead: string,
  rest: string,
  today: string,
  nowMinute: number,
): QuickTodoTimed | null {
  if (!lead) return null;
  const whole = parseTodoLine(`${lead}${rest}`, today, nowMinute);
  return whole.title.trim() === lead.trim() ? { ...whole, title: lead.trim() } : null;
}
