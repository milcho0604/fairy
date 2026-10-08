// 날짜 글(YYYY-MM-DD) 셈. 할 일 마감, 연속 기록, 삐짐, 일정, 베타 기록이 같이 쓴다 (예전에는 파일마다 같은 함수가 있었다).
// 날짜만 다루므로 UTC 로 센다: 현지 시각으로 하루(24시간)를 더하면 서머타임이 바뀌는 날 하루가 23, 25시간이라 날짜가 밀린다.

/** YYYY-MM-DD 에 n 일 (n 은 음수도 된다) */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** 요일: 0 일 ~ 6 토 */
export const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
