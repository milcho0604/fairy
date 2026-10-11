// 알림 미루기 고르기 (10분, 1시간, 내일)와 빠른 입력 "30분 뒤 알려 줘" (2026-10-11).
// 시스템 알림 단추(맥, 윈도우)와 오늘 탭 "방금 울린 알림" 칸이 같은 고르기를 쓴다. 미룬 것은 reminders.ts 가 플래너 저장 파일에 둔다.
import { normalizeQuick } from './event-store.ts';

export type SnoozeChoice = '10m' | '1h' | 'tomorrow';
export const SNOOZE_CHOICES: readonly SnoozeChoice[] = ['10m', '1h', 'tomorrow'];
export const isSnoozeChoice = (v: unknown): v is SnoozeChoice => SNOOZE_CHOICES.includes(v as SnoozeChoice);
/** 말풍선, 시스템 알림 단추 id ("snooze:10m") */
export const snoozeAction = (c: SnoozeChoice) => `snooze:${c}`;
export const choiceOfAction = (a: string | undefined): SnoozeChoice | undefined => {
  const c = a?.startsWith('snooze:') ? a.slice(7) : undefined;
  return isSnoozeChoice(c) ? c : undefined;
};

const MIN = 60_000;
/** "내일"은 다음 날 아침 9시. 새벽(5시 전)에 고르면 그날 아침 9시 (밤을 새운 사람의 내일) */
export const TOMORROW_MINUTE = 9 * 60;
const DAWN_HOUR = 5;

/** 고른 미루기가 다시 울릴 때 (현지 시각) */
export function snoozeAt(choice: SnoozeChoice, now: number): number {
  if (choice === '10m') return now + 10 * MIN;
  if (choice === '1h') return now + 60 * MIN;
  const d = new Date(now);
  if (d.getHours() >= DAWN_HOUR) d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(TOMORROW_MINUTE / 60), TOMORROW_MINUTE % 60, 0, 0);
  return d.getTime();
}

/**
 * 고를 수 있는 미루기. 일정이 섞여 있으면 다시 울릴 때가 쓸모 있는 것만(stale 전), 내일은 빼고.
 * 할 일만이면 셋 다 (할 일은 마감이 지나도 할 일이다. 사용자가 고른 때에 다시 말한다)
 */
export function snoozeChoices(o: { now: number; stale: number; todosOnly: boolean }): SnoozeChoice[] {
  if (o.todosOnly) return [...SNOOZE_CHOICES];
  return SNOOZE_CHOICES.filter((c) => c !== 'tomorrow' && snoozeAt(c, o.now) < o.stale);
}

// ---- 빠른 입력: "30분 뒤 알려 줘", "1시간 후에", "in 30 minutes", "remind me in an hour to stretch" ----

const KO_NUM: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 };
// 상대 시각: "30분", "1시간", "1시간 30분", "1시간 반", "한 시간", "반 시간" + 뒤/후/있다가 (+에)
const KO_REL =
  /(?:^|\s)(?:(\d{1,4}) ?분|(\d{1,3}|한|두|세|네|다섯) ?시간(?: ?(\d{1,2}) ?분| ?(반))?|(반) ?시간) ?(?:뒤|후|있다가)(?:에)?(?=\s|$|[.,!]|알려|알림|말해|깨워)/;
const KO_ASK =
  /(?:^|\s)(?:(?:좀 ?)?(?:알려 ?(?:줘요|줘|주세요|줄래\??|달라)|다시 ?알려 ?줘|말해 ?줘|깨워 ?줘|알림(?: ?줘)?|리마인드(?: ?해 ?줘)?))(?=\s|$|[.,!?])/;
const EN_REL =
  /(?:^|\s)(?:in (?:(\d{1,4}) ?(?:m|min|mins|minutes?)|(\d{1,2}(?:\.\d)?|an?|one|two|three) ?(?:h|hr|hrs|hours?)|(half an hour))|(\d{1,4}) ?(minutes?|mins?|hours?|hrs?) (?:from now|later))(?=\s|$|[.,!])/i;
const EN_ASK = /(?:^|\s)(?:remind me|ping me|nudge me|alert me|notify me|reminder:?)(?=\s|$|[.,!:])/i;
const EN_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
/** 이레까지 */
export const REMIND_IN_MAX_MIN = 7 * 24 * 60;

/**
 * 빠른 입력 한 줄이 "지금부터 N분 뒤 알려 줘"인지. 상대 시각과 알림 말(알려 줘, remind me)이 같이 있거나,
 * 상대 시각만 있고 다른 글이 없으면("1시간 후에", "in 30 minutes") 알림이다. 제목은 남은 글 (없으면 빈 글).
 * 상대 시각에 제목만 있으면("30분 뒤 빨래") 알림이 아니라 일정이다 (예전처럼 parseQuickEvent 가 읽는다)
 */
export function parseRemindIn(text: string): { title: string; minutes: number } | null {
  let rest = ` ${normalizeQuick(text).trim()} `;
  if (rest.length > 220) return null;
  const take = (re: RegExp) => {
    const m = re.exec(rest);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };
  let minutes: number | undefined;
  let asked = false;
  const ko = take(KO_REL);
  if (ko) {
    if (ko[1]) minutes = Number(ko[1]);
    else if (ko[5]) minutes = 30;
    else {
      const h = /^\d+$/.test(ko[2] ?? '') ? Number(ko[2]) : (KO_NUM[ko[2] ?? ''] ?? 0);
      minutes = h * 60 + (ko[4] ? 30 : Number(ko[3] ?? 0));
    }
    asked = !!take(KO_ASK);
  } else {
    const en = take(EN_REL);
    if (!en) return null;
    if (en[1]) minutes = Number(en[1]);
    else if (en[3]) minutes = 30;
    else if (en[4]) minutes = Number(en[4]) * (/^h/i.test(en[5] ?? '') ? 60 : 1);
    else {
      const v = en[2] ?? '';
      minutes = Math.round((/^\d/.test(v) ? Number(v) : (EN_NUM[v.toLowerCase()] ?? 1)) * 60);
    }
    asked = !!take(EN_ASK);
  }
  if (minutes === undefined || minutes < 1 || minutes > REMIND_IN_MAX_MIN) return null;
  const title = cleanTitle(rest);
  if (!asked && title) return null;
  return { title, minutes };
}

/** 남은 글 다듬기: 앞뒤 문장 부호, "~라고", 영어 "to" */
function cleanTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[,.:;\-\s]+|[,.:;\-\s!?]+$/g, '').trim();
  t = t.replace(/^to\s+/i, '').replace(/\s+to$/i, '');
  // "약 먹으라고", "물 마시라고" → "약 먹기"는 못 만들어도 "~라고"는 뗀다. "청소하라고" → "청소하기"
  t = t
    .replace(/하라고$/, '하기')
    .replace(/(?:으라고|라고)$/, '')
    .trim();
  return t.slice(0, 200);
}

/** 지금부터 minutes 뒤, 분 단위로 올림 (알림이 1분 일찍 울리지 않게) */
export function remindInAt(now: number, minutes: number): number {
  return Math.ceil((now + minutes * MIN) / MIN) * MIN;
}
