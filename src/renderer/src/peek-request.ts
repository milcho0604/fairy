export async function settlePeekRequest(
  request: Promise<boolean>,
  wasReleased: () => boolean,
  onUnavailable: (released: boolean) => void,
  onAvailable: (released: boolean) => void,
) {
  let available = false;
  try {
    available = await request;
  } catch {
    // IPC 거절도 키우지 못한 경우와 같은 클릭 복구 경로로 보낸다.
  }
  const released = wasReleased();
  if (available) onAvailable(released);
  else onUnavailable(released);
}
