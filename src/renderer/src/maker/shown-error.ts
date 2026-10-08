// 펫 만들기 창의 실패 안내. 우리가 사람 말로 만든 오류(ShownError)만 화면에 그대로 보이고,
// 그 밖의 것(onnxruntime 의 "no available backend found", WebAssembly, fetch 의 "Failed to fetch" 등 개발자 말)은
// 원문을 콘솔에만 남기고 화면에는 할 일을 담은 안내를 보인다 (download-error.ts 와 같은 방식)

/** 화면에 그대로 보여도 되는 오류 (사전 글로 만든 것) */
export class ShownError extends Error {
  override name = 'ShownError';
}

/** 화면에 보일 글. ShownError 면 그 글, 아니면 fallback. 원문은 콘솔에 */
export function shownErrorText(
  err: unknown,
  fallback: string,
  log: (...a: unknown[]) => void = console.warn,
): string {
  if (err instanceof ShownError) return err.message;
  log('maker', err);
  return fallback;
}
