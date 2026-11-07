// 구글 캘린더 설정 파일(google-calendar.json) 읽기. 아는 칸만 읽고 쓰므로, 여기에 없는 칸은 저장할 때마다 사라진다.
// 그래서 칸을 더하면 꼭 여기에 더한다. 화면과 시험이 같이 쓰려고 순수하게 둔다 (main/gcal.ts 가 파일을 읽고 쓴다).
import { cleanCalendarId, GCAL_PRIMARY, gcalAiOn } from './gcal.ts';
import { cleanCalendars, cleanChoice, type GcalCalendar } from './gcal-cals.ts';

/** 할 일 보내기 설정 (docs/gcal-todo-plan.md 4절). target: fairy 는 페어리가 만든 "페어리 할 일" 캘린더, pick 은 사용자가 고른 기존 캘린더 */
export interface GcalTodoPrefs {
  on: boolean;
  target: 'fairy' | 'pick';
  /** 올릴 캘린더. 아직 정하지 않았으면 null (켜져 있어도 이때는 보내지 않는다) */
  calendarId: string | null;
}

export interface GcalPrefs {
  push: boolean;
  /** 고른 캘린더의 원래 일정을 읽어 오기. 옛 설정(이 칸이 없음)은 꺼 둔다: 연결할 때 켠다 */
  pull: boolean;
  /** 가져온 구글 일정도 AI 에 보이기. 사용자가 켠 경우에만 (기본 꺼짐) */
  ai: boolean;
  /** 보낼 캘린더 (push 가 켜졌을 때). 예전 판에서는 가져오는 캘린더이기도 했다 */
  calendarId: string;
  lastSyncAt: number | null;
  /** 가져올 캘린더들 (구글 캘린더 옵션 창). 예전 설정(이 칸이 없음)은 [calendarId] */
  pullCals: string[];
  /** 마지막으로 읽은 내 캘린더 목록 (이름, 색, 권한). 아직 못 읽었으면 null */
  cals: GcalCalendar[] | null;
  /** 연결에 캘린더 목록 보기 권한이 있는지. 모르면 null, 예전 연결이면 false */
  listScope: boolean | null;
  /** 할 일을 구글 캘린더로 보내기 */
  todos: GcalTodoPrefs;
  /** 연결한 구글 계정의 지문 (기본 캘린더 id 의 sha256). 값 자체는 저장하지 않는다. 모르면 null */
  account: string | null;
}

export const defaultTodoPrefs = (): GcalTodoPrefs => ({ on: false, target: 'pick', calendarId: null });

export function cleanTodoPrefs(raw: unknown): GcalTodoPrefs {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    on: v.on === true,
    target: v.target === 'fairy' ? 'fairy' : 'pick',
    calendarId:
      typeof v.calendarId === 'string' && v.calendarId ? (cleanCalendarId(v.calendarId) ?? null) : null,
  };
}

/** 파일에서 읽은 값 → 설정. 깨졌거나 없으면 꺼진 기본값 */
export function parseGcalPrefs(raw: unknown): GcalPrefs {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const calendarId = cleanCalendarId(v.calendarId) ?? GCAL_PRIMARY;
  const pullCals = Array.isArray(v.pullCals)
    ? (cleanChoice({ pull: v.pullCals, push: null }, null)?.pull ?? [])
    : [calendarId];
  return {
    push: v.push === true,
    pull: v.pull === true,
    ai: gcalAiOn(v),
    calendarId,
    lastSyncAt: typeof v.lastSyncAt === 'number' && Number.isFinite(v.lastSyncAt) ? v.lastSyncAt : null,
    pullCals,
    cals: cleanCalendars(v.cals),
    listScope: typeof v.listScope === 'boolean' ? v.listScope : null,
    todos: cleanTodoPrefs(v.todos),
    account: typeof v.account === 'string' && /^[0-9a-f]{64}$/.test(v.account) ? v.account : null,
  };
}
