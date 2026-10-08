// 빠른 입력 한 줄을 할 일로 (P2-04). "내일 보고서 쓰기!" → 제목 "보고서 쓰기", 마감 내일, 중요.
// 반복(v1): "매일 운동", "평일 스탠드업", "매주 주간 보고" → 반복 할 일, 마감 오늘(평일은 다음 평일).
// 반복 요일: "매주 월요일 회의", "월요일마다 회의", "gym every monday" → 매주, 마감은 오늘이 그 요일이면 오늘, 아니면 다음 그 요일.
// 영어(F): "tomorrow buy milk", "call mom on friday", "gym every monday", "daily stretch".
// 영어 상대 날짜: "write report in 2 days", "in a week", "by end of month", "next week", "this weekend" (quick-words.ts).
import { plusDays } from './day.ts';
import { normalizeQuick, takeKoDue } from './event-store.ts';
import { t } from './i18n/index.ts';
import {
  EN_REL_DAY_GUARD,
  EN_REL_DAY_WORD,
  EN_WEEKDAY_ANY,
  EN_WEEKDAY_FULL,
  enRelDay,
  enWeekdayIndex,
  weekdayOffset,
} from './quick-words.ts';
import type { Repeat } from './todo-store.ts';

export interface QuickTodo {
  title: string;
  due: string | null;
  important: boolean;
  repeat: Repeat | null;
}

const REPEAT_WORDS: Record<string, Repeat> = { 매일: 'daily', 평일: 'weekdays', 매주: 'weekly' };

// 한국어 날짜 낱말. 영어는 아래 EN_DAY 로 따로 읽는다
const DAY_WORDS: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2 };

// 한국어 반복 요일 (2026-10-08). 요일 순서는 getUTCDay 와 같다(일요일 0).
// "매주 월요일 회의", "월요일마다 회의", "회의 매주 월요일", "회의 월요일마다". 요일은 온 이름(월요일)만 읽는다.
// 예전에는 "매주" 만 읽고 "월요일" 은 제목에 남겨 마감이 오늘이었다. 영어 "gym every monday" 는 다음 월요일이라
// 같은 뜻이 말에 따라 다른 날이 됐다. 이제 둘 다 오늘이 그 요일이면 오늘, 아니면 다음 그 요일이다
const KO_WEEKDAYS = '일월화수목금토';
const KO_EVERY_WD_HEAD = /^(?:매주 ([일월화수목금토])요일(?:마다)?|([일월화수목금토])요일마다) /;
const KO_EVERY_WD_TAIL = / (?:매주 ([일월화수목금토])요일(?:마다)?|([일월화수목금토])요일마다)$/;

// ---- 영어 (F). 낱말은 맨 앞이나 맨 끝에 통째로 있을 때만 읽는다. 대소문자는 가리지 않는다 ----

// 반복: "daily gym", "gym every day", "weekdays standup", "every monday review"
const EN_REPEAT: [RegExp, Repeat][] = [
  [/^(?:daily|every day)$/i, 'daily'],
  [/^(?:on )?(?:weekdays|every weekday)$/i, 'weekdays'],
  [/^(?:weekly|every week)$/i, 'weekly'],
];
const EN_REPEAT_HEAD = /^(daily|every day|on weekdays|weekdays|every weekday|weekly|every week) /i;
const EN_REPEAT_TAIL = / (daily|every day|on weekdays|weekdays|every weekday|weekly|every week)$/i;
const EN_EVERY_DAY_HEAD = new RegExp(`^every (${EN_WEEKDAY_ANY}) `, 'i');
const EN_EVERY_DAY_TAIL = new RegExp(` every (${EN_WEEKDAY_ANY})$`, 'i');

// 날짜: today, tonight, tomorrow, the day after tomorrow. 앞에 by, on, due 가 붙어도 된다 ("report by tomorrow")
const EN_DAY_OFFSET: Record<string, number> = {
  today: 0,
  tonight: 0,
  tomorrow: 1,
  tmrw: 1,
  'day after tomorrow': 2,
  'the day after tomorrow': 2,
};
const EN_DAY_WORD = '(?:the )?day after tomorrow|today|tonight|tomorrow|tmrw';
const EN_LEAD = '(?:by |on |due |until )?';
const EN_DAY_HEAD = new RegExp(`^${EN_LEAD}(${EN_DAY_WORD}) `, 'i');
const EN_DAY_TAIL = new RegExp(` ${EN_LEAD}(${EN_DAY_WORD})$`, 'i');
// 상대 날짜: "in 2 days", "within a week", "by end of month", "next week", "this weekend". 일정과 같은 낱말, 같은 셈.
// 다른 날짜 낱말처럼 맨 앞이나 맨 끝에 있을 때만 읽는다: "check in 2 days later" 의 가운데는 제목이다
const EN_REL_HEAD = new RegExp(`^${EN_LEAD}(${EN_REL_DAY_WORD}),? ${EN_REL_DAY_GUARD}`, 'i');
const EN_REL_TAIL = new RegExp(` ${EN_LEAD}(${EN_REL_DAY_WORD})$`, 'i');
// 요일: 온 이름(friday)은 그대로, 줄임말(fri)은 by, on, due, next, this 같은 앞말이 있을 때만.
// "sun cream", "sat exam" 처럼 줄임말이 제목 첫 낱말인 경우를 날짜로 오인하지 않게.
const EN_WD = '(?:(by|on|due|until) )?(?:(next|this) )?';
const EN_WD_FULL_HEAD = new RegExp(`^${EN_WD}(${EN_WEEKDAY_FULL}) `, 'i');
const EN_WD_FULL_TAIL = new RegExp(` ${EN_WD}(${EN_WEEKDAY_FULL})$`, 'i');
const EN_WD_ABBR_HEAD = new RegExp(`^(?:(by|on|due|until) |(next|this) )+(${EN_WEEKDAY_ANY}) `, 'i');
const EN_WD_ABBR_TAIL = new RegExp(` (?:(by|on|due|until) |(next|this) )+(${EN_WEEKDAY_ANY})$`, 'i');

const EN_DEADLINE = new RegExp(
  `\\b(?:by|until|due)\\s+(?:\\d|(?:noon|midnight|${EN_DAY_WORD}|next|this|${EN_WEEKDAY_ANY}|(?:the )?end of|the weekend)\\b|in \\S+ (?:days?|weeks?|months?)\\b)|\\bwithin \\S+ (?:days?|weeks?|months?)\\b`,
  'i',
);

/**
 * 영어 마감 표시("by 5pm", "until friday")가 있으면 true. 패널이 시각이 든 줄을 일정으로 넣기 전에 보고
 * 할 일로 남긴다(한국어 "3시까지" 와 같은 규칙).
 */
export function hasDeadlineWord(text: string): boolean {
  return text.includes('까지') || EN_DEADLINE.test(text);
}

/** 맨 앞이나 맨 끝의 영어 날짜, 요일 낱말. 있으면 [마감, 남은 말] */
function takeEnglishDue(rest: string, today: string): [string, string] | null {
  for (const re of [EN_DAY_HEAD, EN_DAY_TAIL]) {
    const m = rest.match(re);
    if (m) {
      const key = (m[1] ?? '').toLowerCase();
      return [plusDays(today, EN_DAY_OFFSET[key] ?? 0), rest.replace(re, '')];
    }
  }
  for (const re of [EN_REL_HEAD, EN_REL_TAIL]) {
    const m = rest.match(re);
    const day = m ? enRelDay(m[1] ?? '', today) : null;
    if (day) return [day, rest.replace(re, ' ').trim()];
  }
  for (const [re, wdAt, nextAt] of [
    [EN_WD_FULL_HEAD, 3, 2],
    [EN_WD_FULL_TAIL, 3, 2],
    [EN_WD_ABBR_HEAD, 3, 2],
    [EN_WD_ABBR_TAIL, 3, 2],
  ] as const) {
    const m = rest.match(re);
    if (!m) continue;
    const target = enWeekdayIndex(m[wdAt] ?? '');
    if (target < 0) continue;
    const next = (m[nextAt] ?? '').toLowerCase() === 'next';
    return [plusDays(today, weekdayOffset(today, target, next)), rest.replace(re, '')];
  }
  return null;
}

/**
 * today 는 현지 날짜 YYYY-MM-DD. 날짜 낱말은 맨 앞이나 맨 끝에 있을 때만 날짜로 본다 ("오늘의 메모"는 제목).
 * 영어도 같다: "tomorrow buy milk", "call mom on friday", "report by next mon", "gym every monday".
 */
export function parseQuickTodo(text: string, today: string): QuickTodo {
  // 전각 "！", 붙여 쓴 "내일3시" 를 다듬는다. 띄어쓰기를 하나도 안 했으면 반복 낱말도 띄운다 ("매일운동").
  // 띄어쓰기를 한 글의 "매일경제 읽기" 는 신문 이름일 수 있어 그대로 둔다
  let rest = normalizeQuick(text);
  if (!rest.includes(' ')) rest = rest.replace(/^(매일|평일|매주)(?=[가-힣])/, '$1 ');
  let important = false;
  while (rest.endsWith('!') || rest.startsWith('!')) {
    important = true;
    rest = rest.replace(/^!+|!+$/g, '').trim();
  }
  let repeat: Repeat | null = null;
  let repeatDue: string | null = null;
  // 반복 요일이 있으면 매주, 첫 마감은 다가오는 그 요일 (한국어와 영어가 같은 규칙, weekdayOffset next=false)
  const koEvery = rest.match(KO_EVERY_WD_HEAD) ?? rest.match(KO_EVERY_WD_TAIL);
  if (koEvery) {
    repeat = 'weekly';
    repeatDue = plusDays(
      today,
      weekdayOffset(today, KO_WEEKDAYS.indexOf(koEvery[1] ?? koEvery[2] ?? ''), false),
    );
    rest = rest.replace(koEvery[0], ' ').trim();
  }
  for (const [word, r] of Object.entries(REPEAT_WORDS)) {
    if (repeat) break;
    if (rest.startsWith(`${word} `)) {
      repeat = r;
      rest = rest.slice(word.length + 1);
      break;
    }
  }
  if (!repeat) {
    const every = rest.match(EN_EVERY_DAY_HEAD) ?? rest.match(EN_EVERY_DAY_TAIL);
    const target = every ? enWeekdayIndex(every[1] ?? '') : -1;
    if (every && target >= 0) {
      // "every monday": 매주 반복, 첫 마감은 다가오는 그 요일(오늘이 그 요일이면 오늘)
      repeat = 'weekly';
      repeatDue = plusDays(today, weekdayOffset(today, target, false));
      rest = rest.replace(every[0], ' ').trim();
    } else {
      const m = rest.match(EN_REPEAT_HEAD) ?? rest.match(EN_REPEAT_TAIL);
      const hit = m ? EN_REPEAT.find(([re]) => re.test(m[1] ?? '')) : undefined;
      if (m && hit) {
        repeat = hit[1];
        rest = rest.replace(m[0], ' ').trim();
      }
    }
  }
  let due: string | null = null;
  for (const [word, n] of Object.entries(DAY_WORDS)) {
    const head = new RegExp(`^${word}(까지)? `);
    const tail = new RegExp(` ${word}(까지)?$`);
    if (head.test(rest)) {
      due = plusDays(today, n);
      rest = rest.replace(head, '');
      break;
    }
    if (tail.test(rest)) {
      due = plusDays(today, n);
      rest = rest.replace(tail, '');
      break;
    }
  }
  // 한국어 요일, 월일, "15일", "다음 달 5일", "글피" (영어 "friday report" 와 같은 규칙: 오늘이 그 요일이면 오늘)
  if (!due && !repeatDue) {
    const ko = takeKoDue(rest, today);
    if (ko) [due, rest] = ko;
  }
  if (!due && !repeatDue) {
    const en = takeEnglishDue(rest, today);
    if (en) [due, rest] = en;
  }
  if (repeatDue && !due) due = repeatDue;
  if (repeat && !due) {
    due = today;
    if (repeat === 'weekdays')
      while ([0, 6].includes(new Date(`${due}T00:00:00Z`).getUTCDay())) due = plusDays(due, 1);
  }
  return { title: rest.trim(), due, important, repeat };
}

/** 마감일을 사람 말로: 오늘, 내일, 어제까지, 10월 5일. */
export function dueLabel(due: string, today: string): { text: string; overdue: boolean } {
  if (due === today) return { text: t('panel.due.today'), overdue: false };
  if (due === plusDays(today, 1)) return { text: t('panel.due.tomorrow'), overdue: false };
  const date = { m: Number(due.slice(5, 7)), d: Number(due.slice(8, 10)) };
  if (due < today) return { text: t('panel.due.past', date), overdue: true };
  return { text: t('panel.due.date', date), overdue: false };
}
