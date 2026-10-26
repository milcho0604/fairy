// 맥 메뉴 막대 아이콘 옆 글자 (설정 편의, 기본 끔): 집중 중이면 남은 분, 아니면 12시간 안의 다음 일정 시각과 제목.
// 메뉴 막대는 좁고 늘 보이는 곳이라 짧게 자른다. 컴퓨터 상태(CPU %)가 켜져 있으면 그 뒤에 붙는다 (main/tray-title.ts)
import type { CalEvent } from './event-store.ts';
import type { FocusState } from './focus.ts';
import { t } from './i18n/index.ts';

/** 다음 일정을 보여 줄 거리 */
export const TRAY_EVENT_AHEAD_MS = 12 * 60 * 60_000;
/** 제목 글자 상한 (사람이 보는 글자) */
export const TRAY_TITLE_MAX = 14;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function clipTitle(text: string, max = TRAY_TITLE_MAX): string {
  const g = Array.from(segmenter.segment(text.replace(/\s+/g, ' ').trim()), (s) => s.segment);
  return g.length <= max ? g.join('') : `${g.slice(0, max - 1).join('')}…`;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 지금 보일 글자. 없으면 빈 글 */
export function trayTitleText(now: number, focus: FocusState, events: readonly CalEvent[]): string {
  if (focus.phase !== 'idle' && focus.endsAt > now) {
    const min = Math.max(1, Math.ceil((focus.endsAt - now) / 60_000));
    return focus.phase === 'focus' ? t('tray.title.focus', { min }) : t('tray.title.break', { min });
  }
  const next = events
    .filter((e) => !e.allDay && e.startAt > now && e.startAt - now <= TRAY_EVENT_AHEAD_MS)
    .sort((a, b) => a.startAt - b.startAt)[0];
  if (!next) return '';
  return `${hhmm(next.startAt)} ${clipTitle(next.title)}`;
}

/** 다음에 글자가 바뀔 수 있는 때까지 기다릴 ms (집중은 분이 바뀔 때, 일정은 1분마다 보면 충분하다) */
export function trayTitleWait(now: number, focus: FocusState): number {
  if (focus.phase !== 'idle' && focus.endsAt > now) {
    const left = (focus.endsAt - now) % 60_000;
    return Math.max(1000, left + 50);
  }
  return 60_000;
}

/** CPU 글자와 합친다 (둘 다 있으면 사이를 띄운다) */
export function joinTrayTitle(info: string, cpu: string, hidden = ''): string {
  return [hidden, info, cpu].filter((s) => s.trim()).join('  ');
}
