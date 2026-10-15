// 매일 쪽지 (2026-10-11): 하루 한 번 펫이 작은 쪽지를 들고 온다. AI 없이 이 컴퓨터의 기록으로만 쓴다
// (어제 끝낸 수, 오늘 첫 일정, 습관 연속, 철 이야기, 알려 준 것, 고른 성격 말투).
// 함께한 지 7, 30, 100, 365일(그 뒤로 해마다)에는 봉투에 스티커를 붙인 특별한 편지와 코인 선물.
// 순수 함수만 둔다. 저장(daily-note.json)과 배달은 main/daily-note.ts.
import type { PersonaId } from './ai/persona.ts';
import { dataLine, isPersona } from './ai/persona.ts';
import { milestoneCoins } from './coin-rules.ts';
import { isBirthday, type PetFact } from './knows.ts';
import { basePersonaOf } from './persona-voice.ts';
import type { NoteLook } from './together.ts';

/** 특별한 편지를 주는 날 (처음 만난 날이 1일째). 365일 뒤로는 해마다 (730, 1095, ...) */
export const NOTE_MILESTONES = [7, 30, 100, 365] as const;
/** 그날 못 만났으면 이만큼 지나서까지는 늦게라도 준다 */
export const NOTE_LATE_DAYS = 3;
/** 쪽지를 들고 오는 때 (현지 시각, 분). 9시 뒤 처음 자리에 있을 때, 밤 10시 전까지 */
export const NOTE_FROM_MIN = 9 * 60;
export const NOTE_UNTIL_MIN = 22 * 60;
/** 쪽지함에 남기는 수 (오래된 것부터 지운다) */
export const NOTE_BOX_MAX = 40;
/** 일정 제목은 쪽지 한 줄에 들어가게 자른다 */
const TITLE_MAX = 24;

export const NOTE_REASON = 'note-gift';

/** 특별한 편지에 넣는 코인 (coin-rules.ts 한 곳에) */
export { milestoneCoins };

/** 쪽지 한 줄: 사전 키와 값. 화면 말을 바꿔도 다시 읽으면 그 말로 보인다 */
export interface NoteLine {
  key: string;
  vars?: Record<string, string | number>;
}

export interface DailyNote {
  /** 받은 날 YYYY-MM-DD (하루 하나라 id 로도 쓴다) */
  day: string;
  look: NoteLook;
  /** 특별한 편지면 함께한 날 수 */
  milestone?: number;
  /** 특별한 편지에 든 코인 */
  coins?: number;
  lines: NoteLine[];
  /** 펼쳐 읽었는지 */
  read: boolean;
}

export interface NoteState {
  /** 쪽지함 (최근 것이 앞) */
  box: DailyNote[];
  /** 특별한 편지를 준 날 수들 */
  marks: number[];
}

export const EMPTY_NOTES: NoteState = { box: [], marks: [] };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 저장 파일에서 읽은 것을 고른다. 모르는 칸, 틀린 값은 버린다 */
export function parseNotes(raw: unknown): NoteState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const box: DailyNote[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(r.box) ? r.box.slice(0, NOTE_BOX_MAX * 2) : []) {
    const n = noteOf(v);
    if (!n || seen.has(n.day)) continue;
    seen.add(n.day);
    box.push(n);
  }
  box.sort((a, b) => b.day.localeCompare(a.day));
  const marks = Array.isArray(r.marks)
    ? [...new Set(r.marks.filter((x): x is number => Number.isInteger(x) && x > 0 && x < 100_000))].slice(-64)
    : [];
  return { box: box.slice(0, NOTE_BOX_MAX), marks };
}

function noteOf(v: unknown): DailyNote | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const n = v as Record<string, unknown>;
  if (typeof n.day !== 'string' || !DAY_RE.test(n.day)) return undefined;
  const lines: NoteLine[] = [];
  for (const l of Array.isArray(n.lines) ? n.lines.slice(0, 6) : []) {
    if (typeof l !== 'object' || l === null) continue;
    const { key, vars } = l as Record<string, unknown>;
    if (typeof key !== 'string' || !key.startsWith('note.')) continue;
    const clean: Record<string, string | number> = {};
    if (typeof vars === 'object' && vars !== null)
      for (const [k, x] of Object.entries(vars).slice(0, 8))
        if (typeof x === 'number' && Number.isFinite(x)) clean[k] = x;
        else if (typeof x === 'string') clean[k] = x.slice(0, 60);
    lines.push(Object.keys(clean).length ? { key, vars: clean } : { key });
  }
  if (lines.length === 0) return undefined;
  const milestone =
    Number.isInteger(n.milestone) && (n.milestone as number) > 0 ? (n.milestone as number) : 0;
  const coins = Number.isInteger(n.coins) && (n.coins as number) > 0 ? Math.min(100, n.coins as number) : 0;
  return {
    day: n.day,
    look: n.look === 'letter' ? 'letter' : 'note',
    ...(milestone ? { milestone } : {}),
    ...(coins ? { coins } : {}),
    lines,
    read: n.read === true,
  };
}

/** 오늘 들고 올 쪽지가 남았는지: 오늘 것이 아직 없다 (하루 하나) */
export function noteDueToday(state: NoteState, day: string): boolean {
  return !state.box.some((n) => n.day === day);
}

/**
 * 지금 쪽지를 들고 와도 되는 때인지: 오늘 것이 없고, 9시에서 밤 10시 사이, 사용자가 자리에 있고, 펫이 말을 걸어도 될 때
 * (숨거나 집중, 노는 중이 아니다. 부르는 쪽이 present, calm 으로 알려 준다)
 */
export function canDeliver(
  state: NoteState,
  o: { day: string; minute: number; present: boolean; calm: boolean },
): boolean {
  return (
    noteDueToday(state, o.day) &&
    o.minute >= NOTE_FROM_MIN &&
    o.minute < NOTE_UNTIL_MIN &&
    o.present &&
    o.calm
  );
}

/** 특별한 편지를 줄 날인지. 함께한 날(days)이 기념일이거나 그 뒤 NOTE_LATE_DAYS 안이고 아직 안 준 것 */
export function milestoneDue(days: number, marks: readonly number[]): number | undefined {
  if (!Number.isFinite(days) || days < NOTE_MILESTONES[0]) return undefined;
  const years = Math.floor(days / 365);
  const all = [
    ...NOTE_MILESTONES,
    ...Array.from({ length: Math.max(0, years - 1) }, (_, i) => 365 * (i + 2)),
  ];
  // 가장 최근 기념일만 본다 (오래 비웠다 와서 지난 것을 여러 통 받지 않게)
  const due = all.filter((m) => days >= m && days - m <= NOTE_LATE_DAYS && !marks.includes(m));
  return due.length ? Math.max(...due) : undefined;
}

/**
 * 만난 날 기념 말풍선(shared/companion.ts anniversaryDue)을 특별한 편지가 대신하는 날: 7, 30, 100일과 해마다.
 * 매일 쪽지가 켜져 있으면 같은 날 "만난 지 7일째야!" 말풍선과 편지가 겹쳐 같은 말을 두 번 했다
 */
export function letterCovers(due: { mark: number; key: string }): boolean {
  return due.key === 'companion.anniv.year' || (NOTE_MILESTONES as readonly number[]).includes(due.mark);
}

export type Season = 0 | 1 | 2 | 3;
/** 철: 3~5월 봄(0), 6~8월 여름(1), 9~11월 가을(2), 12~2월 겨울(3) */
export function seasonOf(day: string): Season {
  const m = Number(day.slice(5, 7));
  if (m >= 3 && m <= 5) return 0;
  if (m >= 6 && m <= 8) return 1;
  if (m >= 9 && m <= 11) return 2;
  return 3;
}

/** 쪽지를 쓸 때 아는 것 (모두 이 컴퓨터에 있는 것) */
export interface NoteFacts {
  day: string;
  persona: PersonaId;
  petName: string;
  /** 어제 끝낸 할 일 수 */
  yesterdayDone: number;
  /** 오늘 첫 일정 ("오전 10:00" 같은 시각 글과 제목). 종일 일정이면 time 이 빈 글 */
  firstEvent?: { time: string; title: string };
  /** 가장 길게 이어 온 습관 */
  habit?: { title: string; streak: number };
  /** 사용자가 알려 준 것 (생일, 좋아하는 간식, 좋아하는 것) */
  facts: readonly PetFact[];
  /** 특별한 편지면 함께한 날 수 */
  milestone?: number;
}

const clip = (s: string) => {
  const one = dataLine(s);
  return [...one].length > TITLE_MAX ? `${[...one].slice(0, TITLE_MAX - 1).join('')}…` : one;
};

/**
 * 쪽지 글 (2~4줄). 특별한 편지는 날 수, 마음 한 줄, 코인, 맺음. 보통 쪽지는 여는 말, 이 컴퓨터 기록 한두 줄, 맺음.
 * 기록은 생일 > 오늘 첫 일정 > 어제 끝낸 수 순으로 하나, 남은 것(습관, 알려 준 것, 어제, 철) 가운데 하나를 rand 로 고른다
 */
export function composeNote(f: NoteFacts, rand: () => number = Math.random): DailyNote {
  // 쪽지 줄은 말을 따로 쓴 네 성격으로 쓰고, 프리셋과 내 말투는 펼칠 때 말투 규칙을 입힌다 (persona-voice.ts styled)
  const p = basePersonaOf(isPersona(f.persona) ? f.persona : 'friend');
  const pick = (n: number) => 1 + Math.min(n - 1, Math.floor(rand() * n));
  if (f.milestone) {
    const coins = milestoneCoins(f.milestone);
    return {
      day: f.day,
      look: 'letter',
      milestone: f.milestone,
      coins,
      lines: [
        { key: 'note.special.open', vars: { p, n: f.milestone } },
        { key: 'note.special.heart', vars: { p, n: f.milestone, v: pick(2) } },
        { key: 'note.special.coins', vars: { p, coins } },
        { key: 'note.special.close', vars: { p, name: f.petName } },
      ],
      read: false,
    };
  }
  const first: NoteLine[] = [];
  const rest: NoteLine[] = [];
  if (isBirthday(f.facts, f.day)) first.push({ key: 'note.birthday', vars: { p } });
  if (f.firstEvent)
    (first.length ? rest : first).push({
      key: f.firstEvent.time ? 'note.event' : 'note.eventAllDay',
      vars: { p, time: f.firstEvent.time, title: clip(f.firstEvent.title) },
    });
  const yesterday: NoteLine =
    f.yesterdayDone > 0
      ? { key: 'note.yesterday', vars: { p, n: f.yesterdayDone } }
      : { key: 'note.yesterdayNone', vars: { p } };
  (first.length ? rest : first).push(yesterday);
  if (f.habit && f.habit.streak >= 2)
    rest.push({ key: 'note.habit', vars: { p, title: clip(f.habit.title), n: f.habit.streak } });
  const liked = f.facts.filter((x) => x.kind !== 'birthday');
  if (liked.length > 0) {
    const fact = liked[Math.min(liked.length - 1, Math.floor(rand() * liked.length))] as PetFact;
    rest.push({ key: fact.kind === 'food' ? 'note.food' : 'note.like', vars: { p, value: fact.value } });
  }
  rest.push({ key: 'note.season', vars: { p, s: seasonOf(f.day), v: pick(2) } });
  const second = rest[Math.min(rest.length - 1, Math.floor(rand() * rest.length))] as NoteLine;
  return {
    day: f.day,
    look: 'note',
    lines: [
      { key: 'note.open', vars: { p, name: f.petName, v: pick(3) } },
      ...first.slice(0, 1),
      second,
      { key: 'note.close', vars: { p, v: pick(3) } },
    ],
    read: false,
  };
}

/** 쪽지함에 넣는다 (같은 날 것은 바꾼다). 최근 것이 앞, NOTE_BOX_MAX 까지 */
export function fileNote(state: NoteState, note: DailyNote): NoteState {
  const box = [note, ...state.box.filter((n) => n.day !== note.day)]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, NOTE_BOX_MAX);
  const marks =
    note.milestone && !state.marks.includes(note.milestone) ? [...state.marks, note.milestone] : state.marks;
  return { box, marks };
}

/** 읽었다 */
export function markRead(state: NoteState, day: string): NoteState {
  return { ...state, box: state.box.map((n) => (n.day === day && !n.read ? { ...n, read: true } : n)) };
}

/** 펫이 들고 있는 쪽지: 오늘 받은 것을 아직 안 펼쳤으면 그것 */
export function heldNote(state: NoteState, day: string): DailyNote | undefined {
  const n = state.box.find((x) => x.day === day);
  return n && !n.read ? n : undefined;
}

/** 안 읽은 쪽지 수 (쪽지함 표시) */
export const unreadCount = (state: NoteState): number => state.box.filter((n) => !n.read).length;
