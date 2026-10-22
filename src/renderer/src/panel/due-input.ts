// 상세 칸의 날짜, 시각 칸이 메인에 보낼 값을 가른다. 키보드로 칸을 고치는 도중에는 값이 덜 찼거나('' , 연도 한두 자리) 뜻이 틀린
// 값(0002-10-22)이 change 로 오므로, 그것을 그대로 보내면 마감과 시각, 알림이 지워진다. 지우기는 "없애기" 단추로만 한다.

/** 보내도 되는 마감일(YYYY-MM-DD, 연도 1000 이상, 실제 있는 날)이면 그 값, 아니면 undefined */
export function dueToSend(v: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1000) return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? v : undefined;
}

/** 보내도 되는 마감 시각(하루 안의 분)이면 그 값, 칸이 비었거나 덜 찼으면 undefined */
export function minuteToSend(v: string): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : undefined;
}
