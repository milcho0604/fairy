// 펫 질문 칩 (이슈 #124). AI 를 부르지 않고 앱 데이터로 바로 답한다 (비용 0).
// 답 글은 사전(i18n/chips.ts)이고, 여기는 데이터에서 뽑는 셈만 한다.
import { cutText } from './cut-text.ts';
import { t } from './i18n/index.ts';

export const CHIP_IDS = ['todoDone', 'todoLeft', 'nextEvent', 'focusToday', 'coins'] as const;
export type ChipId = (typeof CHIP_IDS)[number];

export const isChipId = (v: unknown): v is ChipId => CHIP_IDS.includes(v as ChipId);

/** 칩 단추들 (말풍선 버튼). 글은 지금 말로 */
export function chipButtons(): { id: ChipId; label: string }[] {
  return CHIP_IDS.map((id) => ({ id, label: t(`chips.${id}`) }));
}

/** 일정 한 줄에서 답에 쓰는 것만 */
export interface ChipEvent {
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
}

export interface ChipFacts {
  now: number;
  /** 오늘 끝낸 할 일 수 */
  doneToday: number;
  /** 안 끝난 할 일 제목, 먼저 하면 좋을 순서 (첫 것을 권한다) */
  open: readonly string[];
  /** 앞으로 보일 일정 (정렬 안 해도 된다) */
  events: readonly ChipEvent[];
  /** 오늘 집중한 분 (끝난 것 + 지금 도는 것) */
  focusMin: number;
  /** 지금 집중 중 */
  focusing: boolean;
  coins: number;
}

const DAY_MS = 86_400_000;

function midnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 일정이 끝났는지. 끝 시각이 없는 시각 일정은 시작하는 순간까지만 "앞"으로 본다 */
function upcoming(e: ChipEvent, now: number): boolean {
  if (e.allDay) return (e.endAt ?? e.startAt + DAY_MS) > midnight(now);
  return (e.endAt ?? e.startAt) >= now;
}

/** 지금 이후 가장 가까운 일정. 지금 도는 일정(시작했고 아직 안 끝남)도 가장 가까운 것으로 본다. 없으면 undefined */
export function nextEventOf(events: readonly ChipEvent[], now: number): ChipEvent | undefined {
  const key = (e: ChipEvent) => (e.allDay ? Math.max(e.startAt, midnight(now)) : Math.max(e.startAt, now));
  return events.filter((e) => upcoming(e, now)).sort((a, b) => key(a) - key(b) || a.startAt - b.startAt)[0];
}

/** "오늘 오후 3:30", "내일 종일", "10월 20일 오전 9:00" */
export function whenLabel(e: ChipEvent, now: number): string {
  const days = Math.round(
    (midnight(e.allDay ? Math.max(e.startAt, now) : e.startAt) - midnight(now)) / DAY_MS,
  );
  const at = new Date(e.allDay ? Math.max(e.startAt, now) : e.startAt);
  const day =
    days <= 0
      ? t('chips.when.today')
      : days === 1
        ? t('chips.when.tomorrow')
        : t('chips.when.date', { month: at.getMonth() + 1, day: at.getDate() });
  if (e.allDay) return `${day} ${t('chips.when.allDay')}`;
  const h = at.getHours();
  const clock = t('chips.when.clock', {
    hour12: h % 12 === 0 ? 12 : h % 12,
    min: String(at.getMinutes()).padStart(2, '0'),
    pm: h >= 12,
  });
  return `${day} ${clock}`;
}

/** 집중한 분을 "45분", "1시간", "1시간 10분" 으로 */
export function minutesLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return t('chips.time.min', { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? t('chips.time.hour', { h }) : t('chips.time.hourMin', { h, m: rest });
}

/** 제목을 말풍선에 넣기 좋게 자른다 */
export const shortTitle = (title: string, max = 24): string => {
  const one = title.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${cutText(one, max - 1)}…`;
};

/** 칩 하나의 답 */
export function chipAnswer(id: ChipId, f: ChipFacts): string {
  switch (id) {
    case 'todoDone':
      if (f.doneToday === 0) return t('chips.a.doneNone');
      return f.open.length === 0
        ? t('chips.a.doneAll', { n: f.doneToday })
        : t('chips.a.done', { n: f.doneToday, open: f.open.length });
    case 'todoLeft': {
      const first = f.open[0];
      return first === undefined
        ? t('chips.a.leftNone')
        : t('chips.a.left', { n: f.open.length, title: shortTitle(first) });
    }
    case 'nextEvent': {
      const e = nextEventOf(f.events, f.now);
      if (!e) return t('chips.a.eventNone');
      if (!e.allDay && e.startAt <= f.now) return t('chips.a.eventNow', { title: shortTitle(e.title) });
      return t('chips.a.event', { when: whenLabel(e, f.now), title: shortTitle(e.title) });
    }
    case 'focusToday': {
      if (f.focusMin <= 0) return t('chips.a.focusNone');
      const time = minutesLabel(f.focusMin);
      return f.focusing ? t('chips.a.focusRunning', { time }) : t('chips.a.focus', { time });
    }
    case 'coins':
      return t('chips.a.coins', { n: f.coins });
  }
}
