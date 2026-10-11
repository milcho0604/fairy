// 펫 성장 단계와 철마다 옷 (2026-10-11). 기본 펫(콩이, 냥이, 삐약이, 멍멍이, 토순이)만.
// 성장: 함께한 날과 친밀도로 아기 → 어린이 → 어른. 한 번 자라면 되돌아가지 않는다 (가장 많이 자란 단계를 저장).
// 아기는 조금 작고 머리가 살짝 크다. 차이는 작게 둔다 (다른 펫처럼 보이지 않게).
// 옷: 봄 꽃, 여름 밀짚모자, 가을 목도리, 겨울 털모자, 설날과 추석 댕기 리본, 크리스마스 산타 모자.
// 입체는 설계도에 부품(머리 위 top, 목 body 슬롯)을 더하고, 2D 는 draw.ts 가 같은 옷을 그린다. 손은 가리지 않는다.
// 모두 순수 함수다. 저장과 알림은 main/wear.ts, 그리기는 renderer.
import type { Blueprint, Part, Slot, Vec3 } from './pet3d/blueprint.ts';

// ---- 성장 ----

export const GROW_STAGES = ['baby', 'kid', 'adult'] as const;
export type GrowStage = (typeof GROW_STAGES)[number];
export const isGrowStage = (v: unknown): v is GrowStage => GROW_STAGES.includes(v as GrowStage);

/** 자라는 기준. 어린이: 7일 함께했거나 친밀도 100. 어른: 30일과 친밀도 300, 또는 60일 */
export const GROW_AT = {
  kid: { days: 7, affection: 100 },
  adult: { days: 30, affection: 300, daysAlone: 60 },
} as const;

/** 함께한 날(처음 만난 날이 1일째)과 친밀도로 정한 단계 */
export function stageFor(days: number, affection: number): GrowStage {
  if ((days >= GROW_AT.adult.days && affection >= GROW_AT.adult.affection) || days >= GROW_AT.adult.daysAlone)
    return 'adult';
  if (days >= GROW_AT.kid.days || affection >= GROW_AT.kid.affection) return 'kid';
  return 'baby';
}

/** 되돌아가지 않게: 저장한 단계와 지금 계산한 단계 중 더 자란 것 */
export function grownStage(saved: GrowStage | undefined, now: GrowStage): GrowStage {
  if (!saved) return now;
  return GROW_STAGES.indexOf(now) > GROW_STAGES.indexOf(saved) ? now : saved;
}

/** 다음 단계까지 남은 것 (설정 안내 한 줄). 어른이면 undefined */
export function nextGrow(
  stage: GrowStage,
  days: number,
  affection: number,
): { stage: GrowStage; days: number; affection: number } | undefined {
  if (stage === 'adult') return undefined;
  if (stage === 'baby')
    return {
      stage: 'kid',
      days: Math.max(0, GROW_AT.kid.days - days),
      affection: Math.max(0, GROW_AT.kid.affection - affection),
    };
  return {
    stage: 'adult',
    days: Math.max(0, GROW_AT.adult.days - days),
    affection: Math.max(0, GROW_AT.adult.affection - affection),
  };
}

/** 단계마다 크기 배율과 머리 배율 (어른이 지금까지의 모습 그대로) */
export const GROW_LOOK: Record<GrowStage, { scale: number; head: number }> = {
  baby: { scale: 0.86, head: 1.12 },
  kid: { scale: 0.93, head: 1.05 },
  adult: { scale: 1, head: 1 },
};

// ---- 철마다 옷 ----

export const OUTFITS = ['flower', 'straw', 'scarf', 'beanie', 'ribbon', 'santa'] as const;
export type Outfit = (typeof OUTFITS)[number];
export const isOutfit = (v: unknown): v is Outfit => OUTFITS.includes(v as Outfit);

/**
 * 설날, 추석 (음력이라 해마다 다르다). 그날 앞뒤 이틀까지 리본. 표에 없는 해는 철 옷만 입는다.
 * 2025~2030 한국천문연구원 월력요항 기준
 */
const HOLIDAYS: readonly string[] = [
  '2025-01-29',
  '2025-10-06',
  '2026-02-17',
  '2026-09-25',
  '2027-02-07',
  '2027-09-15',
  '2028-01-27',
  '2028-10-03',
  '2029-02-13',
  '2029-09-22',
  '2030-02-03',
  '2030-09-12',
];

const dayMs = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** 오늘(YYYY-MM-DD) 입을 옷. 명절이 철보다 먼저다. 철은 북반구 (3~5월 봄, 6~8월 여름, 9~11월 가을, 12~2월 겨울) */
export function outfitFor(day: string): Outfit {
  const t = dayMs(day);
  if (HOLIDAYS.some((h) => Math.abs(dayMs(h) - t) <= 2 * 86_400_000)) return 'ribbon';
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (month === 12 && date >= 20 && date <= 26) return 'santa';
  if (month >= 3 && month <= 5) return 'flower';
  if (month >= 6 && month <= 8) return 'straw';
  if (month >= 9 && month <= 11) return 'scarf';
  return 'beanie';
}

/** 펫 화면에 보내는 모습 (PetStatus.wear). 옷을 끄면 outfit 이 없다 */
export interface WearLook {
  stage: GrowStage;
  outfit?: Outfit;
}

// ---- 입체: 설계도에 더하기 ----

/** 머리(얼굴이 몸에 있으면 몸)와 목 자리 */
interface Anchor {
  /** 머리 가운데와 반지름 */
  c: Vec3;
  r: Vec3;
  /** 목도리 높이와 그 높이의 몸 둘레 반지름 (x, z) */
  neckY: number;
  neck: [number, number];
  /** 머리 위에 이미 장식(콩이 새싹, 삐약이 깃털)이 있다: 방울은 달지 않는다 */
  topped: boolean;
  /** 꽃과 리본을 꽂는 겉면 (머리, 얼굴이 몸에 있으면 몸 그대로) */
  skin: { c: Vec3; r: Vec3 };
}

const volume = (p: Part) => p.size[0] * p.size[1] * p.size[2];
const biggest = (parts: readonly Part[], slot: Slot) =>
  parts.filter((p) => p.slot === slot && p.shape === 'sphere').sort((a, b) => volume(b) - volume(a))[0];

/** 타원체 p 를 높이 y 에서 자른 둘레 반지름 (x, z). 그 높이에 몸이 없으면 0 */
function ringAt(p: Part | undefined, y: number): [number, number] {
  if (!p) return [0, 0];
  const k = (y - p.at[1]) / p.size[1];
  if (Math.abs(k) >= 1) return [0, 0];
  const s = Math.sqrt(1 - k * k);
  return [p.size[0] * s, p.size[2] * s];
}

function anchorOf(bp: Blueprint): Anchor | undefined {
  const head = biggest(bp.parts, 'head');
  const body = biggest(bp.parts, 'body');
  const top = head ?? body;
  if (!top) return undefined;
  const topped = bp.parts.some((p) => p.slot === 'top');
  if (head) {
    const neckY = head.at[1] - head.size[1] * 0.8;
    const a = ringAt(body, neckY);
    const b = ringAt(head, neckY);
    return {
      c: head.at,
      r: head.size,
      neckY,
      neck: [Math.max(a[0], b[0], head.size[0] * 0.5), Math.max(a[1], b[1], head.size[2] * 0.5)],
      topped,
      skin: { c: head.at, r: head.size },
    };
  }
  // 얼굴이 몸에 있는 펫(콩이, 삐약이): 입 바로 아래에 두른다
  const neckY = Math.max(top.at[1] - top.size[1] * 0.7, bp.face.mouthY - 0.13);
  // 모자는 몸 전체가 아니라 머리 몫(위쪽)에 맞춘 작은 머리로 잰다. 몸 크기로 재면 챙이 펫보다 넓고 털모자가 눈을 덮었다
  const k = 0.72;
  const r: Vec3 = [top.size[0] * k, top.size[1] * k, top.size[2] * k];
  const c: Vec3 = [top.at[0], top.at[1] + top.size[1] - r[1], top.at[2]];
  return { c, r, neckY, neck: ringAt(top, neckY), topped, skin: { c: top.at, r: top.size } };
}

const P = (part: Omit<Part, 'wear'>): Part => ({ ...part, wear: true });

/**
 * 옷 부품. puff 는 털 길이만큼 바깥으로 (복슬복슬, 실사 털에 묻히지 않게).
 * 모자는 머리 위(top 슬롯: 머리와 같이 움직인다), 목도리는 몸(body 슬롯)
 */
export function outfitParts(bp: Blueprint, outfit: Outfit, puff = 0): Part[] {
  const a = anchorOf(bp);
  if (!a) return [];
  const [cx, cy, cz] = a.c;
  const [rx, ry, rz] = a.r;
  const ringR = (y: number): [number, number] => {
    const k = Math.min(0.95, Math.abs((y - cy) / ry));
    const s = Math.sqrt(1 - k * k);
    return [rx * s + puff, rz * s + puff];
  };
  switch (outfit) {
    case 'beanie':
    case 'santa': {
      const red = outfit === 'santa';
      const rimY = cy + ry * 0.48;
      const [hx, hz] = ringR(rimY);
      const knit = red ? '#d94a3f' : '#7fb0dc';
      const trim = red ? '#ffffff' : '#f6ecd9';
      const parts: Part[] = [
        P({
          slot: 'top',
          shape: 'sphere',
          at: [cx, cy + ry * 0.44, cz - rz * 0.02],
          size: [rx * 0.9 + puff, ry * 0.66 + puff, rz * 0.92 + puff],
          color: knit,
          finish: 'soft',
        }),
        // 접은 단: 머리 둘레를 감싸는 고리 (TorusGeometry 바깥 반지름이 1.32 배)
        P({
          slot: 'top',
          shape: 'torus',
          at: [cx, rimY, cz],
          size: [(hx + 0.03) / 1.32, (hz + 0.03) / 1.32, 0.2],
          rot: [90, 0, 0],
          color: trim,
          finish: 'soft',
        }),
      ];
      if (red) {
        // 산타 모자 끝: 옆으로 처진 원뿔과 방울
        parts.push(
          P({
            slot: 'top',
            shape: 'cone',
            at: [cx + rx * 0.3, cy + ry * 1.12 + puff, cz - rz * 0.05],
            size: [rx * 0.36, ry * 0.34, rz * 0.36],
            rot: [0, 0, -48],
            color: knit,
            finish: 'soft',
          }),
          P({
            slot: 'top',
            shape: 'sphere',
            at: [cx + rx * 0.62, cy + ry * 1.2 + puff, cz - rz * 0.05],
            size: [0.06, 0.06, 0.06],
            color: trim,
            finish: 'soft',
          }),
        );
      } else if (!a.topped)
        parts.push(
          P({
            slot: 'top',
            shape: 'sphere',
            at: [cx, cy + ry * 1.12 + puff, cz - rz * 0.04],
            size: [0.075, 0.07, 0.075],
            color: trim,
            finish: 'soft',
          }),
        );
      return parts;
    }
    case 'straw': {
      const brimY = cy + ry * 0.66 + puff * 0.6;
      return [
        P({
          slot: 'top',
          shape: 'cylinder',
          at: [cx, brimY, cz - rz * 0.04],
          size: [rx * 1.28 + puff, 0.014, rz * 1.24 + puff],
          rot: [-6, 0, 0],
          color: '#efcf86',
          finish: 'soft',
        }),
        P({
          slot: 'top',
          shape: 'cylinder',
          at: [cx, brimY + 0.075, cz - rz * 0.06],
          size: [rx * 0.52, 0.075, rz * 0.52],
          rot: [-6, 0, 0],
          taper: 0.86,
          color: '#f2d695',
          finish: 'soft',
        }),
        P({
          slot: 'top',
          shape: 'cylinder',
          at: [cx, brimY + 0.03, cz - rz * 0.055],
          size: [rx * 0.535, 0.026, rz * 0.535],
          rot: [-6, 0, 0],
          color: '#e2504c',
        }),
      ];
    }
    case 'flower':
    case 'ribbon': {
      // 머리 오른쪽 위 앞 겉면 (귀가 있으면 귀 앞쪽 아래). 타원체 방향을 맞춰 겉면에 얹고 털 길이만큼 바깥으로
      const [dx, dy, dz] = [0.66, 0.6, 0.42];
      const n = Math.hypot(dx, dy, dz);
      const { c: sc, r: sr } = a.skin;
      const at: Vec3 = [
        sc[0] + (sr[0] + puff * 0.6) * (dx / n),
        sc[1] + (sr[1] + puff * 0.6) * (dy / n),
        sc[2] + (sr[2] + puff * 0.6) * (dz / n),
      ];
      if (outfit === 'ribbon')
        return [
          P({
            slot: 'top',
            shape: 'bow',
            at,
            size: [0.13, 0.1, 0.06],
            rot: [0, 18, -20],
            color: '#e0413b',
            finish: 'soft',
          }),
          P({
            slot: 'top',
            shape: 'sphere',
            at: [at[0] + 0.004, at[1] + 0.004, at[2] + 0.03],
            size: [0.03, 0.028, 0.02],
            color: '#f4c54a',
            finish: 'shiny',
          }),
        ];
      const petals: Part[] = [0, 1, 2, 3, 4].map((i) => {
        const t = (i / 5) * Math.PI * 2 + 0.3;
        return P({
          slot: 'top',
          shape: 'sphere',
          at: [at[0] + Math.cos(t) * 0.056, at[1] + Math.sin(t) * 0.056, at[2]],
          size: [0.042, 0.042, 0.02],
          color: '#ff9ec2',
          finish: 'soft',
        });
      });
      return [
        P({
          slot: 'top',
          shape: 'sphere',
          at: [at[0] - 0.05, at[1] - 0.06, at[2] - 0.012],
          size: [0.04, 0.018, 0.022],
          rot: [0, 0, 35],
          color: '#7cc46a',
          finish: 'soft',
        }),
        ...petals,
        P({
          slot: 'top',
          shape: 'sphere',
          at: [at[0], at[1], at[2] + 0.014],
          size: [0.03, 0.03, 0.018],
          color: '#ffd45c',
          finish: 'shiny',
        }),
      ];
    }
    case 'scarf': {
      const [nx, nz] = a.neck;
      const y = a.neckY;
      const r = 0.042;
      // 목을 한 바퀴 감은 굵은 뜨개 관 (끝이 앞에서 조금 겹친다). 고리 모양(torus)은 굵기와 둘레를 따로 못 정해
      // 튜브처럼 부풀어 보였다
      const ring: Vec3[] = Array.from({ length: 12 }, (_, i) => {
        const t = Math.PI / 2 - 0.35 + (i / 11) * (Math.PI * 2 + 0.5);
        return [
          Math.cos(t) * (nx + 0.012 + puff),
          y + Math.sin(i * 1.3) * 0.006,
          Math.sin(t) * (nz + 0.012 + puff),
        ];
      });
      return [
        P({
          slot: 'body',
          shape: 'tube',
          at: [0, y, 0],
          size: [r, r, r],
          path: ring,
          color: '#e8784a',
          finish: 'soft',
        }),
        // 앞에서 매듭과 늘어진 끝 (몸 오른쪽 앞, 팔과 겹치지 않는 가운데 쪽)
        P({
          slot: 'body',
          shape: 'sphere',
          at: [nx * 0.34, y - 0.012, nz + r + puff],
          size: [0.048, 0.044, 0.034],
          color: '#de6a3c',
          finish: 'soft',
        }),
        P({
          slot: 'body',
          shape: 'box',
          at: [nx * 0.42, y - 0.105, nz + r * 0.7 + puff],
          size: [0.042, 0.08, 0.014],
          rot: [-10, 0, -8],
          round: 0.7,
          color: '#e8784a',
          finish: 'soft',
          pattern: { type: 'stripes', color: '#f7d9a8', dir: 'y', scale: 1.2, amount: 0.4 },
        }),
      ];
    }
  }
}

/** 성장 단계로 머리를 키운다 (머리 밑을 축으로. 얼굴이 머리에 있으면 눈과 입도 같이). 얼굴이 몸에 있으면 눈만 조금 크게 */
export function growBlueprint(bp: Blueprint, stage: GrowStage): Blueprint {
  const h = GROW_LOOK[stage].head;
  if (h === 1) return bp;
  const head = biggest(bp.parts, 'head');
  if (!head) return { ...bp, face: { ...bp.face, eyeSize: bp.face.eyeSize * h } };
  const pivot: Vec3 = [head.at[0], head.at[1] - head.size[1] * 0.6, head.at[2]];
  const inHead = (s: Slot) => s === 'head' || s === 'earL' || s === 'earR' || s === 'top';
  const move = (v: Vec3): Vec3 => [
    pivot[0] + (v[0] - pivot[0]) * h,
    pivot[1] + (v[1] - pivot[1]) * h,
    pivot[2] + (v[2] - pivot[2]) * h,
  ];
  const parts = bp.parts.map((p) =>
    inHead(p.slot)
      ? {
          ...p,
          at: move(p.at),
          size: [p.size[0] * h, p.size[1] * h, p.size[2] * h] as Vec3,
          ...(p.path ? { path: p.path.map(move) } : {}),
        }
      : p,
  );
  const f = bp.face;
  const y = (v: number) => pivot[1] + (v - pivot[1]) * h;
  const face =
    f.slot === 'head'
      ? {
          ...f,
          eyeY: y(f.eyeY),
          mouthY: y(f.mouthY),
          eyeGap: f.eyeGap * h,
          eyeSize: f.eyeSize * h,
          ...(f.nose?.y !== undefined ? { nose: { ...f.nose, y: y(f.nose.y) } } : {}),
          ...(f.brows?.y !== undefined ? { brows: { ...f.brows, y: y(f.brows.y) } } : {}),
        }
      : { ...f, eyeSize: f.eyeSize * h };
  return { ...bp, parts, face };
}

/** 기본 펫 설계도에 성장과 옷을 입힌다. 같은 값이면 부르는 쪽이 같은 결과를 다시 쓰게 늘 새 것을 만든다 */
export function dressBlueprint(bp: Blueprint, look: WearLook | undefined, puff = 0): Blueprint {
  if (!look) return bp;
  const grown = growBlueprint(bp, look.stage);
  if (!look.outfit) return grown;
  // 개 목줄은 목도리 밑으로 숨는다 (둘이 겹쳐 보이지 않게): 목도리를 두를 때만 뺀다
  const base =
    look.outfit === 'scarf'
      ? grown.parts.filter((p) => !(p.slot === 'body' && p.shape === 'cylinder' && p.color === '#e2504c'))
      : grown.parts;
  const tag =
    look.outfit === 'scarf' ? base.filter((p) => !(p.slot === 'body' && p.color === '#f2c14e')) : base;
  return { ...grown, parts: [...tag, ...outfitParts(grown, look.outfit, puff)] };
}
