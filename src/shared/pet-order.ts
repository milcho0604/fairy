// 설정 창 모습 칸의 카드 순서 (2026-10-12 사용자 보고: 펫을 고르면 고른 카드가 사라지고 카드가 막 바뀐다).
// 예전에는 고른 펫이 맨 위 "지금" 카드로 올라가고 옛 펫은 보관함 맨 앞에 끼어 모든 카드가 한 칸씩 밀렸다.
// 보관함이 꽉 차 화면이 카드로 가득하면 누른 카드가 어디로 갔는지 찾을 수 없었다

/**
 * 보관함에 지금 펫(saved)을 넣은 목록. 꺼내는 펫(skipId)이 있으면 그 자리에 바꿔 넣고(다른 카드는 제자리),
 * 꺼낸 자리가 없으면(기본 펫이나 밀크, 초코로 바꿀 때) 맨 앞에. saved 가 없으면 꺼낸 펫만 뺀다
 */
export function swapIn<T extends { id: string }>(
  list: readonly T[],
  saved: T | undefined,
  skipId?: string,
): T[] {
  const at = skipId === undefined ? -1 : list.findIndex((p) => p.id === skipId);
  if (!saved) return list.filter((p) => p.id !== skipId);
  if (at < 0) return [saved, ...list];
  return list.map((p, i) => (i === at ? saved : p));
}

/**
 * 카드 순서 기억. prev 는 지금까지 보인 카드 열쇠(그림 파일 이름) 순서, keys 는 이번 목록(데이터 순서).
 * 이미 본 카드는 자리를 지키고(잠깐 목록에서 빠져도 자리를 기억한다), 처음 보는 카드만 앞에 붙는다
 */
export function keepOrder(prev: readonly string[], keys: readonly string[]): string[] {
  const fresh = keys.filter((k, i) => !prev.includes(k) && keys.indexOf(k) === i);
  return fresh.length === 0 ? [...prev] : [...fresh, ...prev];
}
