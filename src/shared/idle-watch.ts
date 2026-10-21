// 소식이 끊기면 알려 주는 감시기. 패널 크기 끌기가 끝 알림 없이 끊겼을 때(화면 새로 고침, 충돌, 포인터 유실)
// "끄는 중" 표시를 풀기 위해 쓴다. 끌기 중에는 크기 소식이 계속 오니 poke 를 부르면 기한이 다시 시작한다.

export interface IdleWatch {
  /** 기한을 처음부터 다시 센다 (감시 중이 아니면 감시를 시작한다) */
  poke(): void;
  /** 감시를 멈춘다. 기한이 지나도 onIdle 은 부르지 않는다 */
  stop(): void;
  /** 감시 중인가 */
  active(): boolean;
}

export function createIdleWatch(ms: number, onIdle: () => void): IdleWatch {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    poke() {
      stop();
      timer = setTimeout(() => {
        timer = undefined;
        onIdle();
      }, ms);
    },
    stop,
    active: () => timer !== undefined,
  };
}
