import { useEffect, useMemo, useState } from 'react';
import { defaultBlueprint } from '../../shared/pet3d/defaults.ts';
import type { PetKind, PetStyle } from '../../shared/settings.ts';
import { isCuteKind } from './cute2d.ts';
import { cuteArt, loadCuteArt } from './cute2d-art.ts';
import { CANVAS_SIZE, drawPet } from './draw.ts';
import { Pet3D } from './pet3d.ts';

// 기본 펫 몸 전체 그림 (쉬는 모습, 팔다리 포함). 화면 위 펫, 설정 썸네일과 같은 drawPet 그림이다.
// 이름 옆 얼굴(PetFace)은 머리만 잘라 팔다리가 없어서, 펫을 처음 소개하는 자리(시작 안내)는 이것을 쓴다

let shared3d: Pet3D | undefined;

/** 기본 펫 하나를 side(CSS px) 크기 PNG 로. 입체면 렌더러 하나를 다시 쓴다. 못 그리면 undefined */
export function basicPetShot(kind: PetKind, o: { use3d: boolean; style: PetStyle; side: number }) {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(o.side * dpr);
  c.height = Math.round(o.side * dpr);
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  let m3d: Pet3D | undefined;
  if (o.use3d) {
    shared3d ??= Pet3D.create(() => {
      shared3d = undefined;
    });
    if (shared3d?.ok) {
      shared3d.setStyle(o.style);
      shared3d.setBlueprint(defaultBlueprint(kind, o.style));
      // 복슬복슬 모습은 녹이기를 나눠 하는데, 한 장만 찍으니 지금 다 끝낸다 (털 없는 몸이 찍혔다)
      shared3d.finishFuse();
      m3d = shared3d;
    }
  }
  const scale = c.width / CANVAS_SIZE;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPet(ctx, { mood: 'idle', elapsed: 0, blink: -1, kind, viewSize: o.side, model3d: m3d });
  m3d?.clear();
  return c.toDataURL('image/png');
}

/** 기본 펫 몸 전체 그림 칸. 모습이 바뀔 때만 다시 그린다 */
export function PetShot(o: {
  kind: PetKind;
  use3d: boolean;
  style: PetStyle;
  side: number;
  className?: string;
}) {
  // 2D 손그림 냥이, 곰돌이는 그림이 풀린 뒤에 찍는다 (그동안은 빈 칸. 못 풀면 예전 코드 그림)
  const cute = !o.use3d && isCuteKind(o.kind) ? o.kind : undefined;
  const [ready, setReady] = useState(() => !cute || !!cuteArt(cute));
  useEffect(() => {
    if (!cute) return;
    let alive = true;
    void loadCuteArt(cute).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [cute]);
  const wait = !!cute && !ready && !cuteArt(cute);
  const url = useMemo(
    () => (wait ? undefined : basicPetShot(o.kind, { use3d: o.use3d, style: o.style, side: o.side })),
    [o.kind, o.use3d, o.style, o.side, wait],
  );
  return url ? (
    <img className={o.className} src={url} alt="" draggable={false} />
  ) : (
    <span className={o.className} aria-hidden="true" />
  );
}
