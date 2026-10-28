// 말 안 하는 시간 (설정 > 비서). 이 시간에는 펫이 혼잣말과 휴식 권유를 하지 않는다.
// 일정 알림, 답이 왔다는 알림, 쪽지 같은 사용자가 챙겨야 하는 말은 그대로 한다.

export interface QuietHours {
  /** 시간대로 쉬기 */
  on: boolean;
  /** 시작과 끝 (하루 중 분). 시작이 끝보다 크면 밤을 넘긴다 (22:00 ~ 08:00) */
  from: number;
  to: number;
  /** 주말에는 하루 종일 쉬기 */
  weekend: boolean;
}

export const DEFAULT_QUIET: QuietHours = { on: false, from: 12 * 60, to: 13 * 60, weekend: false };

const minute = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440 ? v : d;

/** 저장 파일이나 화면에서 온 값을 말 안 하는 시간으로. 모르는 값은 기본값 */
export function parseQuiet(raw: unknown, base: QuietHours = DEFAULT_QUIET): QuietHours {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    on: typeof r.on === 'boolean' ? r.on : base.on,
    from: minute(r.from, base.from),
    to: minute(r.to, base.to),
    weekend: typeof r.weekend === 'boolean' ? r.weekend : base.weekend,
  };
}

/** 지금(ms)이 말 안 하는 시간인지. 시작과 끝이 같으면 시간대로는 쉬지 않는다 */
export function isQuietNow(q: QuietHours, now: number): boolean {
  const d = new Date(now);
  const day = d.getDay();
  if (q.weekend && (day === 0 || day === 6)) return true;
  if (!q.on || q.from === q.to) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return q.from < q.to ? m >= q.from && m < q.to : m >= q.from || m < q.to;
}
