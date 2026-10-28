// 2D 그림 세트 검사기 (2026-10-28, 테마 검증기): 그림 세트(.fairy 의 images.sprites, 또는 폴더의 <이름>.png)가 앱에서 어떻게 읽히는지
// 미리 알려 준다. 앱은 틀린 장을 조용히 버리지만(pet-share.ts cleanSprites, 갤러리는 버려지는 장이 있으면 받지 않는다)
// 만드는 사람은 "왜 내 그림이 안 나오지" 를 몰라서, 같은 규칙으로 까닭과 채워지는 자세를 적어 준다.
// 그림을 풀지 않고 머리말과 크기만 본다 (Buffer 를 쓰지 않는다). CLI 는 scripts/validate-pet.mjs, 규칙 설명은 docs/pet-format.md "그림 세트 검사".

import { imageKind, imageSize } from './image-head.ts';
import {
  fillSprites,
  SPRITE_BASE_NAMES,
  SPRITE_EXTRA_NAMES,
  SPRITE_MAX_BYTES,
  SPRITE_MAX_SIDE,
  SPRITE_NAMES,
  SPRITES_MAX_BYTES,
  type SpriteName,
  walkCount,
} from './pet-sprites.ts';

/** 그림 파일 하나의 머리말 정보 (CLI 가 바이트에서 읽어 넣는다) */
export interface SpriteFileInfo {
  bytes: number;
  /** 머리말로 본 형식 (png, webp, jpeg, 모르면 undefined) */
  kind?: string;
  w?: number;
  h?: number;
}

export type SpriteIssueCode =
  | 'noIdle'
  | 'unknownName'
  | 'notPng'
  | 'tooBig'
  | 'badSize'
  | 'sizeMismatch'
  | 'totalTooBig'
  | 'noWalk'
  | 'walkGap'
  | 'walkShort'
  | 'stillSet';

export interface SpriteIssue {
  /** error 는 앱이 그 장(idle 이면 세트 전체)을 버린다. warn 은 쓸 수는 있지만 어색해진다. info 는 알아 둘 것 */
  level: 'error' | 'warn' | 'info';
  code: SpriteIssueCode;
  /** 걸린 그림 이름 (세트 전체 문제면 없음) */
  name?: string;
  /** 글에 넣을 값 (크기, 장 수 같은) */
  v?: Record<string, number | string>;
}

export interface SpriteReport {
  /** error 가 하나도 없으면 true (앱이 이 세트를 그대로 쓴다) */
  ok: boolean;
  issues: SpriteIssue[];
  /** 읽히는 장 수 (아는 이름이고 규칙을 지킨 것) */
  frames: number;
  /** 걷기 한 주기 장 수 */
  walks: number;
  /** 없어서 다른 그림으로 채워지는 자세: 자세 이름 -> 채우는 그림의 자세 이름 */
  filled: Partial<Record<SpriteName, SpriteName>>;
}

/** 걷기가 이만큼보다 적으면 발걸음이 뚝뚝 끊겨 보인다 */
export const WALK_SMOOTH = 4;

/**
 * 그림 세트 검사. files 는 이름 -> 머리말 정보. 앱 규칙과 같다: 아는 이름만, PNG 만, 한 장 SPRITE_MAX_BYTES, 한 변 SPRITE_MAX_SIDE,
 * 모두 idle 과 같은 크기, 합 SPRITES_MAX_BYTES. idle 이 없거나 틀리면 세트 전체를 버린다
 */
export function checkSpriteSet(files: Record<string, SpriteFileInfo | undefined>): SpriteReport {
  const issues: SpriteIssue[] = [];
  const known = new Set<string>(SPRITE_NAMES);
  for (const name of Object.keys(files))
    if (!known.has(name)) issues.push({ level: 'warn', code: 'unknownName', name });
  const idle = files.idle;
  if (!idle) issues.push({ level: 'error', code: 'noIdle' });
  const live: Partial<Record<SpriteName, true>> = {};
  let total = 0;
  for (const name of SPRITE_NAMES) {
    const f = files[name];
    if (!f) continue;
    total += f.bytes;
    const bad = (code: SpriteIssueCode, v?: SpriteIssue['v']) =>
      issues.push({ level: 'error', code, name, ...(v ? { v } : {}) });
    if (f.kind !== 'png') {
      bad('notPng');
      continue;
    }
    if (f.bytes > SPRITE_MAX_BYTES) {
      bad('tooBig', { kb: Math.round(f.bytes / 1024), max: SPRITE_MAX_BYTES / 1024 });
      continue;
    }
    if (!f.w || !f.h || f.w > SPRITE_MAX_SIDE || f.h > SPRITE_MAX_SIDE) {
      bad('badSize', { w: f.w ?? 0, h: f.h ?? 0, max: SPRITE_MAX_SIDE });
      continue;
    }
    if (idle?.w && idle.h && name !== 'idle' && (f.w !== idle.w || f.h !== idle.h)) {
      bad('sizeMismatch', { w: f.w, h: f.h, idleW: idle.w, idleH: idle.h });
      continue;
    }
    live[name] = true;
  }
  if (total > SPRITES_MAX_BYTES)
    issues.push({
      level: 'error',
      code: 'totalTooBig',
      v: { mb: +(total / 1024 / 1024).toFixed(1), max: SPRITES_MAX_BYTES / 1024 / 1024 },
    });
  const idleOk = !!live.idle && total <= SPRITES_MAX_BYTES;
  const walks = idleOk ? walkCount(live) : 0;
  if (idleOk) {
    if (walks === 0) issues.push({ level: 'warn', code: 'noWalk' });
    else if (walks < WALK_SMOOTH)
      issues.push({ level: 'info', code: 'walkShort', v: { walks, smooth: WALK_SMOOTH } });
    // walk-0 부터 이어지지 않은 장은 걷기 한 주기에 들지 않는다 (예: walk-0, walk-2 면 walk-2 는 안 쓰인다)
    const stray = SPRITE_NAMES.filter((n) => n.startsWith('walk-') && live[n] && Number(n.slice(5)) >= walks);
    for (const name of stray) issues.push({ level: 'warn', code: 'walkGap', name, v: { walks } });
    if (Object.keys(live).length === 1) issues.push({ level: 'info', code: 'stillSet' });
  }
  const filled: SpriteReport['filled'] = {};
  if (idleOk) {
    // 그림 대신 자세 이름을 넣어 채운 결과를 보면 어느 자세 그림이 쓰이는지 알 수 있다
    const own = Object.fromEntries(SPRITE_NAMES.filter((n) => live[n]).map((n) => [n, n])) as Partial<
      Record<SpriteName, SpriteName>
    >;
    const names = fillSprites(own);
    for (const name of SPRITE_NAMES) if (!live[name] && names) filled[name] = names[name];
  }
  const level = { error: 0, warn: 1, info: 2 } as const;
  issues.sort((a, b) => level[a.level] - level[b.level]);
  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    frames: idleOk ? Object.keys(live).length : 0,
    walks,
    filled,
  };
}

const KO: Record<SpriteIssueCode, (i: SpriteIssue) => string> = {
  noIdle: () => '서기(idle) 그림이 없어요. 없으면 그림 세트를 통째로 버려요.',
  unknownName: (i) => `${i.name}: 모르는 이름이라 건너뛰어요 (이름 목록은 docs/pet-format.md).`,
  notPng: (i) => `${i.name}: PNG 가 아니에요 (SVG, GIF, WebP, JPEG 는 받지 않아요). 이 장은 버려요.`,
  tooBig: (i) => `${i.name}: ${i.v?.kb}KB 라 한 장 상한 ${i.v?.max}KB 를 넘어요. 이 장은 버려요.`,
  badSize: (i) =>
    `${i.name}: 크기(${i.v?.w}x${i.v?.h})를 못 읽었거나 한 변 ${i.v?.max}px 를 넘어요. 이 장은 버려요.`,
  sizeMismatch: (i) =>
    `${i.name}: ${i.v?.w}x${i.v?.h} 인데 서기는 ${i.v?.idleW}x${i.v?.idleH} 예요. 모든 장이 서기와 같은 크기여야 해요. 이 장은 버려요.`,
  totalTooBig: (i) => `그림 합이 ${i.v?.mb}MB 라 상한 ${i.v?.max}MB 를 넘어요. 세트를 통째로 버려요.`,
  noWalk: () => '걷기 그림(walk-0 부터)이 없어요. 걸을 때 서기 그림이 그대로 흔들려요.',
  walkGap: (i) =>
    `${i.name}: 걷기는 walk-0 부터 빠짐없이 이어진 ${i.v?.walks}장만 써요. 이 장은 쓰이지 않아요.`,
  walkShort: (i) =>
    `걷기가 ${i.v?.walks}장이라 발걸음이 조금 끊겨 보여요 (${i.v?.smooth}장 이상이면 부드러워요).`,
  stillSet: () => '서기 그림뿐이에요. 다른 자세는 모두 서기 그림으로 채워져요.',
};
const EN: Record<SpriteIssueCode, (i: SpriteIssue) => string> = {
  noIdle: () => 'No idle (standing) picture. Without it the whole sprite set is dropped.',
  unknownName: (i) => `${i.name}: unknown name, skipped (see docs/pet-format.md for the names).`,
  notPng: (i) => `${i.name}: not a PNG (SVG, GIF, WebP and JPEG are refused). This picture is dropped.`,
  tooBig: (i) =>
    `${i.name}: ${i.v?.kb} KB is over the ${i.v?.max} KB per-picture limit. This picture is dropped.`,
  badSize: (i) =>
    `${i.name}: size (${i.v?.w}x${i.v?.h}) unreadable or over ${i.v?.max}px per side. This picture is dropped.`,
  sizeMismatch: (i) =>
    `${i.name}: ${i.v?.w}x${i.v?.h} but idle is ${i.v?.idleW}x${i.v?.idleH}. Every picture must be the same size as idle. This picture is dropped.`,
  totalTooBig: (i) =>
    `Pictures total ${i.v?.mb} MB, over the ${i.v?.max} MB limit. The whole set is dropped.`,
  noWalk: () => 'No walk pictures (from walk-0). The idle picture just wobbles when walking.',
  walkGap: (i) =>
    `${i.name}: the walk cycle only uses the ${i.v?.walks} consecutive picture(s) from walk-0. This one is never shown.`,
  walkShort: (i) =>
    `Only ${i.v?.walks} walk picture(s), so steps look a little choppy (${i.v?.smooth} or more is smoother).`,
  stillSet: () => 'Only the idle picture. Every other pose is filled with it.',
};

/** 사람이 읽는 한 줄 (ko, en) */
export function describeSpriteIssue(i: SpriteIssue, lang: 'ko' | 'en' = 'ko'): string {
  return (lang === 'ko' ? KO : EN)[i.code](i);
}

/** 기본 손그림에 있는 자세 이름과 그림 세트만의 추가 자세 (docs 와 CLI 안내용) */
export const SPRITE_POSE_GROUPS = { base: SPRITE_BASE_NAMES, extra: SPRITE_EXTRA_NAMES } as const;

/** 그림 바이트의 머리말 정보 */
export function spriteInfoOf(bytes: Uint8Array): SpriteFileInfo {
  const size = imageSize(bytes);
  const kind = imageKind(bytes);
  return { bytes: bytes.length, ...(kind ? { kind } : {}), ...(size ? { w: size.w, h: size.h } : {}) };
}

/** data URL 의 base64 를 바이트로. data URL 이 아니거나 깨졌으면 undefined */
function dataUrlBytes(url: unknown): Uint8Array | undefined {
  if (typeof url !== 'string') return undefined;
  const m = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return undefined;
  try {
    const bin = atob(m[1] ?? '');
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/**
 * .fairy 글(JSON)에서 그림 세트 정보를 뽑는다. 판 2 의 images.sprites. 읽을 수 없는 글이면 { error }, 세트가 없으면 빈 칸 목록.
 * data URL 이 아닌 값은 형식을 모르는 파일로 센다 (notPng)
 */
export function spriteInfosOfFairy(text: string): Record<string, SpriteFileInfo> | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { error: 'not JSON' };
  }
  const sprites = (raw as { images?: { sprites?: unknown } } | null)?.images?.sprites;
  if (sprites === undefined) return {};
  if (typeof sprites !== 'object' || sprites === null || Array.isArray(sprites))
    return { error: 'images.sprites is not an object' };
  const out: Record<string, SpriteFileInfo> = {};
  for (const [name, url] of Object.entries(sprites)) {
    const bytes = dataUrlBytes(url);
    out[name] = bytes ? spriteInfoOf(bytes) : { bytes: typeof url === 'string' ? url.length : 0 };
  }
  return out;
}
