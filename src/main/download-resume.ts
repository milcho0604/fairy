// 큰 파일(몇 GB) 이어 받기의 순수 계산 (download.ts 가 쓴다, download-resume.test.ts).
// 멈추거나 끊겨도 .part 를 남겨 다음에 Range 로 그 뒤부터 받는다. 서버가 이어 받기를 안 받아 주면 처음부터

/** 이어 받을 시작 바이트. 받다 만 .part 가 있고 전체보다 작을 때만, 아니면 0 (처음부터) */
export function rangeFrom(partSize: number, total: number): number {
  return Number.isFinite(partSize) && partSize > 0 && partSize < total ? Math.floor(partSize) : 0;
}

/**
 * 서버 답이 이어 받기를 받아 줬는지: 206 이고 Content-Range 시작이 우리가 부탁한 자리와 같을 때만.
 * 200 이면 처음부터 다 보내는 것이라 .part 를 새로 쓴다
 */
export function resumeAccepted(
  status: number,
  contentRange: string | null | undefined,
  from: number,
): boolean {
  if (from <= 0 || status !== 206) return false;
  const m = /^bytes\s+(\d+)-\d*\/(\d+|\*)$/i.exec((contentRange ?? '').trim());
  return !!m && Number(m[1]) === from;
}

/**
 * 이어 받는 .part 이름. 받을 파일의 해시 앞 8자를 넣어 그 판에 묶는다: 고정한 판(해시)을 바꾸면 옛 판의 반쪽에
 * 새 판의 뒤쪽이 이어 붙어 몇 GB 를 받고 나서야 해시가 틀리는 일이 없게 (옛 이름은 그냥 남은 찌꺼기로 지운다)
 */
export const partPath = (path: string, sha256: string) => `${path}.${sha256.slice(0, 8)}.part`;

/** .part 가 이미 끝까지 받아졌는지 (해시만 맞으면 다시 받지 않고 제자리로 옮긴다) */
export const partComplete = (partSize: number, total: number) =>
  Number.isFinite(partSize) && total > 0 && partSize === total;

/**
 * 서버 답을 어떻게 쓸지. resume 이어 붙이기, fresh 처음부터 새로 쓰기, retry Range 없이 다시 부탁하기.
 * 206 인데 Content-Range 시작이 부탁한 자리와 다르면 몸통은 파일 일부일 뿐이라 통째 파일로 쓰면 안 된다
 * (해시가 틀려 처음부터 다시 받게 된다) → 받지 않고 Range 없이 다시
 */
export function rangeVerdict(
  status: number,
  contentRange: string | null | undefined,
  from: number,
): 'resume' | 'fresh' | 'retry' {
  if (from > 0 && status === 206) return resumeAccepted(status, contentRange, from) ? 'resume' : 'retry';
  // Range 를 안 보냈는데 206(일부)이면 역시 통째 파일이 아니다
  if (from <= 0 && status === 206) return 'retry';
  return 'fresh';
}

/** 바이트가 이만큼 안 오면 멈춘 것으로 본다 (받기 시작 전 서버 답을 기다리는 동안도) */
export const STALL_MS = 30_000;

/**
 * 받기 멈춤 감시 (버그잡이 4). 예전에는 연결이 살아 있는 채 바이트만 끊기면(와이파이 바꿈, 잠든 프록시) 진행률이
 * 그 자리에 멈춘 채 끝나지 않았다. kick 은 바이트가 올 때마다, stop 은 끝날 때. 멈추면 onStall 을 한 번 부른다
 */
export function createStallWatch(ms: number, onStall: () => void) {
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      onStall();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  };
  arm();
  return {
    kick() {
      if (!stalled) arm();
    },
    stop() {
      clearTimeout(timer);
    },
    get stalled() {
      return stalled;
    },
  };
}

/**
 * 받다 만 .part 를 지울지. 이어 받는 파일은 멈추거나 끊기거나 그만둬도 남겨 다음에 그 뒤부터 받는다.
 * 목록 크기를 넘어 멈춘 것(hash)과 이어 받지 않는 파일은 지운다
 */
export function partRemovable(resume: boolean, reason: string): boolean {
  return !resume || reason === 'hash';
}
