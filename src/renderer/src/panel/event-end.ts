// 일정 줄의 끝 시각 고치기 (#146). 시작은 시각 칸에서 고치고, 끝은 여기서: 끝 시각 칸 값과 길이 글.
import { t } from '../../../shared/i18n/index.ts';

/**
 * 끝 시각 칸("15:30") 값을 시작과 같은 날의 ms 로. 끝은 시작보다 늦어야 한다.
 * 비었으면 null (끝 시각 없애기), 모양이 틀렸거나 시작보다 늦지 않으면 undefined (바꾸지 않는다)
 */
export function endFromInput(startAt: number, value: string): number | null | undefined {
  if (value === '') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  const d = new Date(startAt);
  d.setHours(h, min, 0, 0);
  return d.getTime() > startAt ? d.getTime() : undefined;
}

/** time 칸 값 "15:30" (현지 시각) */
export function timeInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 일정 길이 글: 45분, 1시간, 1시간 30분 (영어 45 min, 1 h, 1 h 30 min) */
export function lengthLabel(startAt: number, endAt: number): string {
  const min = Math.max(1, Math.round((endAt - startAt) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return t('rows.len.min', { n: m });
  if (m === 0) return t('rows.len.hour', { n: h });
  return t('rows.len.hourMin', { h, m });
}
