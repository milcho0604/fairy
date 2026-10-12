// 누르면 저장하는 단추를 빠르게 두 번 눌러도 한 번만 (버그잡이 b). 답 아래 "메모로"를 두 번 누르면(더블클릭)
// 같은 메모가 둘, "할 일로"는 같은 할 일이 두 벌 생겼다. 저장은 몇 ms 만에 끝나 두 번째 누름이 올 때는
// 이미 끝나 있으므로, 끝난 뒤에도 holdMs 동안(단추 대신 "메모에 남김"이 보이는 동안) 누름을 버린다.

/** 앞 호출이 끝나고 holdMs 가 지나기 전에 온 호출은 버린다 (undefined) */
export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>, holdMs = 0) {
  let busy = false;
  return async (...args: A): Promise<R | undefined> => {
    if (busy) return undefined;
    busy = true;
    try {
      return await fn(...args);
    } finally {
      if (holdMs > 0)
        setTimeout(() => {
          busy = false;
        }, holdMs);
      else busy = false;
    }
  };
}
