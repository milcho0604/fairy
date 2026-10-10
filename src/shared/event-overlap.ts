// 일정 시간 겹침 (2026-10-10). 새 일정을 넣을 때 같은 시간에 다른 일정이 있으면 알려 주고, 일정 탭에서 겹치는 줄에 표시한다.
// 종일 일정은 보지 않는다 (여행 중 회의처럼 겹치는 게 보통이다). 끝 시각이 없는 일정은 30분짜리로 본다 (오늘 탭 "지금"과 같다).

export const NO_END_MIN = 30;

interface Span {
  id?: number;
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
}

const endOf = (e: Span) =>
  e.endAt !== null && e.endAt > e.startAt ? e.endAt : e.startAt + NO_END_MIN * 60_000;

/** ev 와 시간이 겹치는 시각 일정들, 이른 것부터. 같은 id 는 뺀다 */
export function overlapping<T extends Span>(existing: readonly T[], ev: Span): T[] {
  if (ev.allDay) return [];
  const from = ev.startAt;
  const to = endOf(ev);
  return existing
    .filter((e) => !e.allDay && (ev.id === undefined || e.id !== ev.id) && e.startAt < to && from < endOf(e))
    .sort((a, b) => a.startAt - b.startAt);
}

/** 목록 안에서 다른 일정과 겹치는 일정 id */
export function clashIds(events: readonly (Span & { id: number })[]): Set<number> {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.startAt - b.startAt);
  const out = new Set<number>();
  // 시작 순으로 훑으며 지금까지 가장 늦게 끝나는 일정과 비교한다
  let last: (Span & { id: number }) | undefined;
  for (const e of timed) {
    if (last && e.startAt < endOf(last)) {
      out.add(last.id);
      out.add(e.id);
    }
    if (!last || endOf(e) > endOf(last)) last = e;
  }
  return out;
}
