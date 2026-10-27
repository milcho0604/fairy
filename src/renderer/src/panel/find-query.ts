/** 검색 응답을 그 응답을 만든 입력과 함께 보관해, 다른 입력의 결과로 재사용하지 않는다. */
export interface FindQuerySnapshot<T> {
  query: string;
  composing: boolean;
  result: T;
}

export function currentQueryResult<T>(
  snapshot: FindQuerySnapshot<T> | undefined,
  query: string,
  composing: boolean,
): T | undefined {
  return snapshot?.query === query && snapshot.composing === composing ? snapshot.result : undefined;
}
