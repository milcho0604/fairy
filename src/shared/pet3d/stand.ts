// 사진으로 만든 동물 페어리를 네 발로 선 피규어로 (밀크, 초코처럼). AI 가 만든 설계도(앉은 피규어)에서 색, 무늬,
// 눈, 코, 귀 모양(선 귀, 처진 귀), 꼬리 모양, 털 느낌을 가져와 밀크(고양이 몸), 초코(강아지 몸) 뼈대에 입힌다.
// 다시 AI 를 부르지 않는다 (돈, 시간이 들지 않고 언제든 되돌린다). 사용자가 설정에서 고를 때만 쓴다 (settings.petStands)
import type { Blueprint, Face, Part } from './blueprint.ts';
import { STARTER_BLUEPRINTS } from './starters.ts';

const first = (parts: readonly Part[], slot: Part['slot']) => parts.find((p) => p.slot === slot && !p.wear);

/** 가장 큰 부품 (부피) */
function biggest(parts: readonly Part[], slot: Part['slot']): Part | undefined {
  let best: Part | undefined;
  let vol = -1;
  for (const p of parts) {
    if (p.slot !== slot || p.wear) continue;
    const v = p.size[0] * p.size[1] * p.size[2];
    if (v > vol) {
      vol = v;
      best = p;
    }
  }
  return best;
}

/** 색을 k 만큼 흰색(k>0) 또는 검정(k<0) 쪽으로 */
export function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return hex;
  const n = Number.parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)),
  );
  return `#${ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}

/** 고양이 몸인지 (고양이 입, 수염, 세모 귀). 아니면 강아지 몸 */
export function catLike(bp: Blueprint): boolean {
  if (bp.face.mouth === 'cat' || bp.face.whiskers) return true;
  const ear = first(bp.parts, 'earL') ?? first(bp.parts, 'earR');
  return ear?.shape === 'cone';
}

/**
 * 네 발로 선 피규어로 만들 수 있는 동물인지: 귀나 꼬리가 있고 얼굴이 있는 네 발(또는 동물 모양) 설계도.
 * 이미 네 발로 선 몸이거나, 귀와 꼬리가 다 없는 것(인형, 사람, 새)은 아니다
 */
export function canStand(bp: Blueprint): boolean {
  if (bp.stance) return false;
  if (bp.parts.some((p) => !p.wear && (p.slot === 'wingL' || p.slot === 'wingR'))) return false;
  if (bp.face.mouth === 'beak') return false;
  const ears = bp.parts.some((p) => !p.wear && (p.slot === 'earL' || p.slot === 'earR'));
  const tail = bp.parts.some((p) => !p.wear && p.slot === 'tail');
  return ears && (tail || bp.gait === 'quadruped');
}

/** 처진 귀인지 (귀 가운데가 머리 가운데보다 낮다, 또는 세모가 아닌 아래로 긴 귀) */
function floppyEars(bp: Blueprint): boolean {
  const ear = first(bp.parts, 'earL') ?? first(bp.parts, 'earR');
  const head = biggest(bp.parts, 'head');
  if (!ear) return false;
  if (ear.shape === 'cone') return false;
  return !head || ear.at[1] < head.at[1] || ear.size[1] > ear.size[0] * 1.3;
}

/**
 * 네 발로 선 설계도. 고양이 몸은 밀크, 강아지 몸은 초코 뼈대를 쓰고 귀는 원래 귀 모양(선 귀, 처진 귀)을 따른다.
 * 만들 수 없으면 undefined (canStand)
 */
export function standingBlueprint(bp: Blueprint): Blueprint | undefined {
  if (!canStand(bp)) return undefined;
  const cat = catLike(bp);
  const base = cat ? STARTER_BLUEPRINTS.milk : STARTER_BLUEPRINTS.choco;
  const floppy = floppyEars(bp);
  const other = cat ? STARTER_BLUEPRINTS.choco : STARTER_BLUEPRINTS.milk;
  const bodyP = biggest(bp.parts, 'body');
  const headP = biggest(bp.parts, 'head') ?? bodyP;
  const body = bodyP?.color ?? base.parts[0]?.color ?? '#cccccc';
  const head = headP?.color ?? body;
  const earP = first(bp.parts, 'earL') ?? first(bp.parts, 'earR');
  const legP = first(bp.parts, 'legL') ?? first(bp.parts, 'legR');
  const tailP = biggest(bp.parts, 'tail');
  const finish = bodyP?.finish ?? 'fuzzy';
  // 머리에 붙은 작은 밝은 부품(주둥이)이 있으면 그 색
  const muzzle =
    bp.parts.find(
      (p) => p.slot === 'head' && p !== headP && !p.wear && p.size[0] < (headP?.size[0] ?? 1) * 0.6,
    )?.color ?? shade(head, 0.12);
  const recolor = (p: Part, base0: Part[]): Part => {
    const i = base0.indexOf(p);
    const role =
      p.slot === 'body'
        ? i === base0.findIndex((q) => q.slot === 'body')
          ? 'body'
          : 'chest'
        : p.slot === 'head'
          ? p.size[0] < 0.1
            ? 'muzzle'
            : 'head'
          : p.slot.startsWith('ear')
            ? 'ear'
            : p.slot.startsWith('leg')
              ? p.knee && p.at[1] < 0.06
                ? 'paw'
                : 'leg'
              : 'tail';
    const color =
      role === 'body'
        ? body
        : role === 'chest'
          ? ((first(bp.parts, 'body') !== bodyP ? first(bp.parts, 'body')?.color : undefined) ??
            shade(body, 0.08))
          : role === 'head'
            ? head
            : role === 'muzzle'
              ? muzzle
              : role === 'ear'
                ? (earP?.color ?? head)
                : role === 'paw'
                  ? (legP?.color ?? shade(body, 0.06))
                  : role === 'leg'
                    ? body
                    : (tailP?.color ?? body);
    const out: Part = { ...p, color, finish: p.finish === 'shiny' ? 'shiny' : finish };
    // 몸, 머리 무늬는 그대로 옮긴다 (점박이, 줄무늬, 흰 배)
    if (role === 'body' && bodyP?.pattern) out.pattern = bodyP.pattern;
    else if (role === 'head' && headP?.pattern) out.pattern = headP.pattern;
    else delete out.pattern;
    if (role === 'ear') {
      if (earP?.inner) out.inner = earP.inner;
      else if (out.inner) out.inner = shade(color, 0.35);
    }
    return out;
  };
  const baseParts = base.parts;
  // 귀는 원래 모양 쪽 뼈대에서 (처진 귀 고양이, 선 귀 강아지)
  const earFrom = floppy === !cat ? baseParts : other.parts;
  const parts: Part[] = [
    ...baseParts.filter((p) => !p.slot.startsWith('ear')).map((p) => recolor(p, baseParts)),
    ...earFrom.filter((p) => p.slot.startsWith('ear')).map((p) => recolor(p, earFrom)),
  ];
  // 꼬리: 사진 피규어가 관 꼬리면 긴 꼬리(밀크), 아니면 짧은 꼬리(초코)
  const longTail = tailP?.shape === 'tube' || (tailP ? tailP.size[1] > 0.12 : cat);
  if (longTail !== cat) {
    const tails = other.parts.filter((p) => p.slot === 'tail').map((p) => recolor(p, other.parts));
    parts.splice(0, parts.length, ...parts.filter((p) => p.slot !== 'tail'), ...tails);
  }
  const f = bp.face;
  const face: Face = {
    ...base.face,
    ...(f.eyeColor ? { eyeColor: f.eyeColor } : {}),
    ...(f.pupil ? { pupil: f.pupil } : {}),
    ...(f.catchlight ? { catchlight: f.catchlight } : {}),
    ...(f.eyeShape ? { eyeShape: f.eyeShape } : {}),
    ...(f.eyes ? { eyes: f.eyes } : {}),
    ...(f.lashes ? { lashes: f.lashes } : {}),
    ...(f.brows ? { brows: { ...f.brows, y: undefined } } : {}),
    // 볼 터치는 고양이 뼈대만 (강아지 옆모습에서 주둥이 앞에 떠 보인다)
    ...(f.blush && base.face.blush ? { blush: f.blush } : {}),
    ...(f.whiskers ? { whiskers: f.whiskers } : {}),
    ...(f.fluff ? { fluff: body } : {}),
  };
  if (face.brows) delete face.brows.y;
  if (f.nose?.color && base.face.nose) face.nose = { ...base.face.nose, color: f.nose.color };
  return {
    v: 2,
    stance: 'stand',
    gait: 'quadruped',
    fur: bp.fur ?? base.fur ?? { length: 0.5 },
    ...(bp.motion ? { motion: bp.motion } : base.motion ? { motion: base.motion } : {}),
    parts,
    face,
  };
}
