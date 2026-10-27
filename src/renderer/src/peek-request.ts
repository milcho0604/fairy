export type PeekRequestStatus = 'holding' | 'released' | 'cancelled';

export async function settlePeekRequest(
  request: () => Promise<boolean>,
  getStatus: () => PeekRequestStatus,
  onUnavailable: (restoreClick: boolean) => void,
  onAvailable: (shouldEnd: boolean) => void,
) {
  let available = false;
  try {
    available = await request();
  } catch {
    // IPC 동기 예외나 Promise 거절도 키우지 못한 경우와 같은 경로로 보낸다.
  }
  const status = getStatus();
  if (available) onAvailable(status !== 'holding');
  else onUnavailable(status === 'released');
}
