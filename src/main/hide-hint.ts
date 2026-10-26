// 숨은 펫을 다시 부르는 길 (사용자 보고: 숨긴 뒤 단축키를 까먹으면 다시 나오게 하기 어렵다).
// 맥은 메뉴 막대가 붐비면(노치) 아이콘이 가려지고, 이미 떠 있는 앱을 Spotlight 나 Finder 로 다시 열면
// second-instance 가 아니라 'activate' 가 온다. 둘 다 같은 "다시 나오기"로 묶는다.
// 이 파일은 electron 을 들이지 않아 단위 시험으로 바로 돌린다.

/** 숨기기 안내 알림은 처음 몇 번만 (매번 뜨면 숨길 때마다 알림이 와 성가시다) */
export const HIDE_HINT_TIMES = 3;
export type HideHintDelivery = 'notification' | 'tray' | 'none';

/** 알림을 껐거나 지원되지 않으면 첫 숨김만 앱 안에서 안내한다. */
export function hideHintDelivery(shown: number, osNotify: boolean, supported: boolean): HideHintDelivery {
  if (shown >= HIDE_HINT_TIMES) return 'none';
  if (osNotify && supported) return 'notification';
  return shown === 0 ? 'tray' : 'none';
}

export type HideHint = { key: 'pet.hideHint'; keys: string } | { key: 'pet.hideHintNoKey' };

/**
 * 숨길 때 보일 안내. 안 보일 때는 undefined.
 * 단축키를 꺼 두었어도 "앱을 다시 열면 돌아온다"는 길은 늘 있어서 안내는 나온다.
 */
export function hideHintFor(o: {
  shown: number;
  /** 사람이 읽는 단축키 (예: ⌃⌥⇧P). 빈 문자열이면 단축키 없음 */
  keys: string;
  osNotify: boolean;
  supported: boolean;
}): HideHint | undefined {
  if (o.shown >= HIDE_HINT_TIMES || !o.osNotify || !o.supported) return undefined;
  return o.keys ? { key: 'pet.hideHint', keys: o.keys } : { key: 'pet.hideHintNoKey' };
}

/** electron 의 app (EventEmitter). 시험은 node:events 의 EventEmitter */
type Emitter = Pick<NodeJS.EventEmitter, 'on'>;

/**
 * 앱을 다시 열었을 때 숨은 펫을 부른다.
 * 윈도우와 리눅스: 다시 실행하면 second-instance (주소나 .jjpet 파일을 넘긴 것이면 그것만 처리).
 * 맥: 이미 떠 있는 앱을 다시 열면 activate. 창이 앞으로 오는 것만으로는 오지 않는다(applicationShouldHandleReopen).
 */
export function watchReopen(
  app: Emitter,
  platform: NodeJS.Platform,
  h: { takeArgv: (argv: string[], cwd: string) => boolean; bringBack: (why: string) => void },
): void {
  app.on('second-instance', (_e: unknown, argv: string[], cwd: string) => {
    if (h.takeArgv(argv, cwd)) return;
    h.bringBack('second-instance');
  });
  if (platform === 'darwin') app.on('activate', () => h.bringBack('activate'));
}
