import { useSyncExternalStore } from 'react';
import type { FaceBridge } from '../../shared/ipc.ts';

// 이름 옆 펫 얼굴. 펫 화면이 지금 모습(기본 펫 2D나 3D, 사진, 입체 피규어, 2.5D 판)으로 그린 그림을
// 메인에서 받아 쓴다 (shared/face.ts). 펫을 바꾸면 열린 창도 바로 바뀐다.

const bridge = (window as { jjakkungFace?: FaceBridge }).jjakkungFace;
let face: string | null = null;
const listeners = new Set<() => void>();
function set(url: string | null) {
  if (!url || url === face) return;
  face = url;
  for (const l of listeners) l();
}
void bridge?.get().then(set, () => {});
bridge?.onChange(set);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 아직 얼굴을 못 받았으면 같은 자리를 비워 둔다 (다른 펫 얼굴을 잠깐이라도 보이지 않게) */
export function PetFace() {
  const url = useSyncExternalStore(subscribe, () => face);
  return url ? (
    <img className="face" src={url} alt="" draggable={false} />
  ) : (
    <span className="face" aria-hidden="true" />
  );
}

/** 얼굴 그림 주소 그대로 (주간 회고 카드처럼 캔버스에 그릴 때). 아직 못 받았으면 null */
export function useFaceUrl(): string | null {
  return useSyncExternalStore(subscribe, () => face);
}
