// 작은 패널의 쪽지함은 탭이 아니라 덮개다. 메인이 탭 바꾸기를 요청하면 덮개를 열지, 닫을지 정한다.
// 큰 창(home)은 쪽지함이 탭이라 덮개가 없고, 그대로 둔다.
export function mailOverlayAfterTabRequest(kind: string, next: string, open: boolean): boolean {
  if (kind !== 'panel') return open;
  return next === 'mail';
}
