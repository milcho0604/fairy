// 시계로 재는 기다림 (버그잡이 4). 저장해 둔 시각이 지금보다 뒤면(기록한 뒤 시계가 뒤로 갔다: 잘못 맞춘 날짜를 고침,
// 배터리 나간 컴퓨터) "아직 안 지남"으로 보면 그 시각까지 몇 날, 몇 해를 기다렸다. 그런 시각은 이미 지난 것으로 본다.

/** at 에서 ms 가 아직 지나지 않았는지. at 이 지금보다 뒤거나 수가 아니면 false (지난 것) */
export function fresh(at: number, now: number, ms: number): boolean {
  return Number.isFinite(at) && at <= now && now - at < ms;
}
