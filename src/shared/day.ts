// 날짜 글(YYYY-MM-DD) 셈. 할 일 마감, 연속 기록, 삐짐, 일정, 베타 기록이 같이 쓴다 (예전에는 파일마다 같은 함수가 있었다).
// 날짜만 다루므로 UTC 로 센다: 현지 시각으로 하루(24시간)를 더하면 서머타임이 바뀌는 날 하루가 23, 25시간이라 날짜가 밀린다.

/** YYYY-MM-DD 에 n 일 (n 은 음수도 된다) */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 에 n 달. 그 달에 같은 날이 없으면 그 달 말일 (1월 31일 + 1달 = 2월 28일, 윤년이면 29일) */
export function plusMonths(day: string, n: number): string {
  const [y = 2000, m = 1, d = 1] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

/** 그 달의 말일 (n 달 뒤의 말일도) */
export function monthEnd(day: string, n = 0): string {
  const [y = 2000, m = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m + n, 0)).toISOString().slice(0, 10);
}

/** 요일: 0 일 ~ 6 토 */
export const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
