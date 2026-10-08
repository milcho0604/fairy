// 펫 얼굴 그림 (채팅, 패널, 빠른 입력, 시작 안내의 이름 옆 얼굴).
// 펫 화면이 지금 모습(기본 펫 2D나 3D, 사진, 입체 피규어, 2.5D 판) 그대로 한 번 그려 메인에 주고,
// 메인은 기억했다가 얼굴을 쓰는 창에 나눠 준다. 창마다 three.js 렌더러를 새로 만들지 않는다.

/** 얼굴 그림 한 변(px). 가장 크게 쓰는 곳(시작 안내 96px)을 레티나 2배로 */
export const FACE_PX = 192;

/** 얼굴 그림 상한. 192px PNG 는 보통 20~60KB 다 */
export const FACE_MAX_CHARS = 400_000;

const PREFIX = 'data:image/png;base64,';

/** 펫 화면이 보낸 얼굴이 받아도 되는 PNG data URL 인지 (형식, 크기, base64 글자) */
export function isFaceUrl(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > PREFIX.length &&
    v.length <= FACE_MAX_CHARS &&
    v.startsWith(PREFIX) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(v.slice(PREFIX.length))
  );
}
