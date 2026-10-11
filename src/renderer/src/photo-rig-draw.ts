// 뼈대가 있는 그림 펫 그리기 (photo-rig.ts 의 그물을 2D 캔버스에). 세모마다 그림을 무늬(pattern)로 깔고 그 세모가 옮겨 간
// 자리로 아핀 변환해 채운다. 세모 경계가 반투명하게 갈라져 보이지 않게 세모를 화면 픽셀 반쯤 넓혀 칠한다.
// 쉬는 자세면 그물 없이 그림을 그대로 그린다 (가만히 있을 때 드는 값이 예전과 같다).
import {
  boneMatrices,
  buildMesh,
  isRestPose,
  type RigDef,
  type RigMesh,
  type RigPose,
  skin,
  triangleAffine,
} from './photo-rig.ts';

/** 세모를 넓히는 폭 (화면 픽셀) */
const SEAM_PAD = 0.6;

export class RiggedPhoto {
  private mesh: RigMesh | undefined;
  private pos: Float32Array | undefined;
  private pattern: { ctx: CanvasRenderingContext2D; p: CanvasPattern } | undefined;
  private readonly m = new DOMMatrix();

  readonly image: HTMLImageElement;
  readonly def: RigDef;

  private constructor(image: HTMLImageElement, def: RigDef) {
    this.image = image;
    this.def = def;
  }

  /** 그림 크기가 뼈대와 같을 때만 (다른 그림이면 undefined: 예전처럼 한 장으로 그린다) */
  static make(image: HTMLImageElement, def: RigDef | undefined): RiggedPhoto | undefined {
    if (!def || image.naturalWidth !== def.w || image.naturalHeight !== def.h) return undefined;
    return new RiggedPhoto(image, def);
  }

  has(id: RigDef['bones'][number]['id']): boolean {
    return this.def.bones.some((b) => b.id === id);
  }

  /** 그물을 처음 쓸 때 깐다 (그림의 투명한 칸은 뺀다) */
  private meshOf(): RigMesh | undefined {
    if (this.mesh) return this.mesh;
    const { w, h } = this.def;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return undefined;
    g.drawImage(this.image, 0, 0);
    const data = g.getImageData(0, 0, w, h).data;
    this.mesh = buildMesh(this.def, (x, y) =>
      x < 0 || y < 0 || x >= w || y >= h ? 0 : (data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] ?? 0),
    );
    this.pos = new Float32Array(this.mesh.rest.length);
    return this.mesh;
  }

  /**
   * 지금 변환에서 그림 왼쪽 위가 (0, 0), 그림 1px 이 1 인 자리에 그린다. 쉬는 자세면 그림을 그대로.
   * 그물을 못 깔면(캔버스를 못 얻음) 그림을 그대로 그린다
   */
  draw(ctx: CanvasRenderingContext2D, pose: RigPose): void {
    const mesh = isRestPose(pose) ? undefined : this.meshOf();
    if (!mesh || !this.pos) {
      ctx.drawImage(this.image, 0, 0);
      return;
    }
    if (this.pattern?.ctx !== ctx) {
      const p = ctx.createPattern(this.image, 'no-repeat');
      if (!p) {
        ctx.drawImage(this.image, 0, 0);
        return;
      }
      this.pattern = { ctx, p };
    }
    const pattern = this.pattern.p;
    const pos = skin(mesh, boneMatrices(this.def, pose), this.pos);
    const t = ctx.getTransform();
    const pad = SEAM_PAD / Math.max(1e-6, Math.hypot(t.a, t.b));
    const { rest, tris } = mesh;
    const m = this.m;
    for (let i = 0; i < tris.length; i += 3) {
      const i0 = (tris[i] as number) * 2;
      const i1 = (tris[i + 1] as number) * 2;
      const i2 = (tris[i + 2] as number) * 2;
      const x0 = pos[i0] as number;
      const y0 = pos[i0 + 1] as number;
      const x1 = pos[i1] as number;
      const y1 = pos[i1 + 1] as number;
      const x2 = pos[i2] as number;
      const y2 = pos[i2 + 1] as number;
      const a = triangleAffine(
        [
          rest[i0] as number,
          rest[i0 + 1] as number,
          rest[i1] as number,
          rest[i1 + 1] as number,
          rest[i2] as number,
          rest[i2 + 1] as number,
        ],
        [x0, y0, x1, y1, x2, y2],
      );
      if (!a) continue;
      m.a = a[0];
      m.b = a[1];
      m.c = a[2];
      m.d = a[3];
      m.e = a[4];
      m.f = a[5];
      pattern.setTransform(m);
      ctx.fillStyle = pattern;
      // 가운데에서 바깥으로 pad 만큼 넓힌 세모
      const cx = (x0 + x1 + x2) / 3;
      const cy = (y0 + y1 + y2) / 3;
      ctx.beginPath();
      grow(ctx, x0, y0, cx, cy, pad, true);
      grow(ctx, x1, y1, cx, cy, pad, false);
      grow(ctx, x2, y2, cx, cy, pad, false);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function grow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
  pad: number,
  first: boolean,
) {
  const dx = x - cx;
  const dy = y - cy;
  const k = 1 + pad / Math.max(1e-6, Math.hypot(dx, dy));
  if (first) ctx.moveTo(cx + dx * k, cy + dy * k);
  else ctx.lineTo(cx + dx * k, cy + dy * k);
}
