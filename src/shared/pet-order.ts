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

/**
 * 모습 칸 카드 나누기. 밀크, 초코 복사본은 아직 사진 카드로 보인 적이 없으면 그 캐릭터 칸이 맡는다:
 * 지금 펫이면 starterCur, 보관함에 있으면 starterSaved (그 칸을 누르면 어차피 그 복사본을 꺼낸다, fromStarter).
 * 그래서 이름 바꾼 밀크를 두고 다른 펫을 골라도 새 카드가 앞에 생기지 않는다. 사진 카드로 보인 복사본은 제자리를 지킨다
 */
export function pickerCards(o: {
  cur: string | null | undefined;
  library: readonly string[];
  prev: readonly string[];
  starterOf: (k: string) => string | undefined;
}): { order: string[]; photo: string[]; starterCur: boolean; starterSaved: Record<string, string> } {
  const hidden = (k: string) => !!o.starterOf(k) && !o.prev.includes(k);
  const starterCur = !!o.cur && hidden(o.cur);
  const taken = new Set(starterCur && o.cur ? [o.starterOf(o.cur)] : []);
  const starterSaved: Record<string, string> = {};
  for (const k of o.library) {
    const id = o.starterOf(k);
    if (k === o.cur || !id || !hidden(k) || taken.has(id)) continue;
    taken.add(id);
    starterSaved[id] = k;
  }
  const inStarter = new Set(Object.values(starterSaved));
  const keys = [...(o.cur && !starterCur ? [o.cur] : []), ...o.library].filter(
    (k, i, a) => a.indexOf(k) === i && !(starterCur && k === o.cur) && !inStarter.has(k),
  );
  const order = keepOrder(o.prev, keys);
  return { order, photo: order.filter((k) => keys.includes(k)), starterCur, starterSaved };
}
