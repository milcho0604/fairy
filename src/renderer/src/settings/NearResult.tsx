// 누른 단추 옆에 남기는 결과 한 줄. 창 맨 위 안내(2초 뒤 사라짐)는 단추에서 멀어 놓치기 쉬워, 쿠폰, 이벤트, 계정 동작은
// 단추 바로 아래에 결과를 두고 다음에 누르거나 잠시(20초) 지나면 거둔다. 글은 만드는 식(() => t(...))으로 받아 그릴 때마다 만든다:
// 그 사이 언어를 바꿔도 새 말로 보인다.
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const KEEP_MS = 20_000;

export type Say = (message: () => string, error?: boolean) => void;

/** [결과 줄, 남기기(글 만드는 식, 실패면 true), 거두기] */
export function useNear(): [ReactNode, Say, () => void] {
  const [r, setR] = useState<{ message: () => string; error: boolean }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setR(undefined);
  }, []);
  const say = useCallback<Say>((message, error = false) => {
    clearTimeout(timer.current);
    setR({ message, error });
    timer.current = setTimeout(() => setR(undefined), KEEP_MS);
  }, []);
  const node = r ? (
    <small className={`near-result${r.error ? ' error' : ''}`} role="status" aria-live="polite">
      {r.message()}
    </small>
  ) : null;
  return [node, say, clear];
}
