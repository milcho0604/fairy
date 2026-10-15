// Codex 펫 파일 (.codex-pet.zip) 가져오기의 규칙 (이슈 #88). Codex 앱이 쓰는 펫 묶음(pet.json + 그림 한 장)을
// 페어리의 2D 그림 세트(pet-sprites.ts)로 옮긴다. 형식은 openai/skills 의 hatch-pet 설명을 따랐다 (코드는 가져오지 않았다):
// 그림 1536x1872, 한 칸 192x208, 가로 8칸 세로 9줄, 줄마다 쓰는 장 수가 정해져 있고 안 쓰는 칸은 완전 투명.
// 여기는 줄 표, 자세 나누기, pet.json 읽기만 둔다 (Buffer 를 쓰지 않는다). zip 풀기와 그림 자르기는 main/codex-pet.ts
// 형식 설명과 나누기 표: docs/pet-format.md "Codex 펫 파일"

import type { SpriteName } from './pet-sprites.ts';
import { cleanPetName } from './settings.ts';

export const CODEX_ATLAS = { width: 1536, height: 1872, cols: 8, rows: 9, cellW: 192, cellH: 208 } as const;

/** 줄 순서와 줄마다 쓰는 장 수 (hatch-pet references/animation-rows.md) */
export const CODEX_ROWS = [
  { state: 'idle', frames: 6 },
  { state: 'running-right', frames: 8 },
  { state: 'running-left', frames: 8 },
  { state: 'waving', frames: 4 },
  { state: 'jumping', frames: 5 },
  { state: 'failed', frames: 8 },
  { state: 'waiting', frames: 6 },
  { state: 'running', frames: 6 },
  { state: 'review', frames: 6 },
] as const;
export type CodexState = (typeof CODEX_ROWS)[number]['state'];

/** zip 파일 상한. Codex 그림 한 장은 WebP 로 보통 1MB 아래, 압축 안 한 PNG 라도 12MB 쯤이다 */
export const CODEX_ZIP_MAX_BYTES = 16 * 1024 * 1024;
export const CODEX_ZIP_LIMITS = {
  /** 항목 수 (pet.json, 그림, 맥이 붙이는 __MACOSX 부스러기까지 넉넉히) */
  entries: 64,
  /** 한 항목을 풀었을 때 (그림을 RGBA 그대로 넣어도 11.5MB) */
  entryBytes: 16 * 1024 * 1024,
  /** 모든 항목을 풀었을 때 합 */
  totalBytes: 32 * 1024 * 1024,
} as const;
/** pet.json 상한 */
export const CODEX_MANIFEST_MAX_BYTES = 64 * 1024;
/** 설명 길이 상한 (글자) */
export const CODEX_DESCRIPTION_MAX = 200;

export interface CodexManifest {
  name: string;
  /** 가져오기 확인 창에 보이는 한 줄 (저장하지 않는다) */
  description?: string;
  /** zip 안 그림 파일 이름 (pet.json 과 같은 폴더) */
  sheet: string;
}

// 글자 제어 문자(Cc)와 서식 문자(Cf: 방향 바꾸기, 폭 없는 글자)는 뺀다 (pet-share.ts cleanAuthor 와 같다)
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

/** 설명: 글자만 (제어 문자를 빼고 빈칸을 하나로), CODEX_DESCRIPTION_MAX 글자에서 자른다 */
export function cleanDescription(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  const cut = [...s];
  return cut.length <= CODEX_DESCRIPTION_MAX
    ? s
    : `${cut
        .slice(0, CODEX_DESCRIPTION_MAX - 1)
        .join('')
        .trim()}…`;
}

/** 그림 파일 이름: 폴더 없이 이름만, PNG 나 WebP */
const SHEET_NAME = /^[\w][\w .-]{0,99}\.(webp|png)$/i;

/** pet.json 글을 읽는다. 이름은 displayName, 없으면 id. 깨졌거나 이름이 없으면 undefined */
export function parseCodexManifest(text: string): CodexManifest | undefined {
  if (text.length > CODEX_MANIFEST_MAX_BYTES) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const name = cleanPetName(r.displayName) ?? cleanPetName(r.id);
  if (!name) return undefined;
  const sheet = r.spritesheetPath === undefined ? 'spritesheet.webp' : r.spritesheetPath;
  if (typeof sheet !== 'string' || !SHEET_NAME.test(sheet) || sheet.includes('..')) return undefined;
  const description = cleanDescription(r.description);
  return { name, sheet, ...(description ? { description } : {}) };
}

/** 칸 자리 (줄, 칸) */
export type Cell = readonly [row: number, col: number];

/** n 장에서 k 장을 고르게 뽑는다 (앞에서부터, 순서 그대로). n 이 k 보다 적으면 다 */
export function evenPick(n: number, k: number): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: k }, (_, i) => Math.floor((i * n) / k));
}

/**
 * 칸마다 그림이 있는지(filled[줄][칸])로 우리 자세를 나눈다. 줄마다 쓰는 장 수 밖의 칸과 빈 칸은 보지 않는다.
 * 서기(idle 줄 첫 장)가 없으면 빈 결과. 빠진 자세는 그리는 쪽이 가까운 그림으로 채운다 (pet-sprites.ts fillSprites)
 */
export function codexSpriteCells(filled: readonly (readonly boolean[])[]): Partial<Record<SpriteName, Cell>> {
  const rowOf = (state: CodexState): Cell[] => {
    const r = CODEX_ROWS.findIndex((x) => x.state === state);
    const spec = CODEX_ROWS[r];
    if (!spec) return [];
    const cells: Cell[] = [];
    for (let c = 0; c < spec.frames; c++) if (filled[r]?.[c]) cells.push([r, c]);
    return cells;
  };
  /** 줄 가운데 장 (손 흔들기는 손을 든 장, 뛰기는 꼭대기) */
  const mid = (cells: Cell[]) => cells[Math.floor(cells.length / 2)];
  const out: Partial<Record<SpriteName, Cell>> = {};
  const put = (name: SpriteName, cell: Cell | undefined) => {
    if (cell) out[name] = cell;
  };
  const idle = rowOf('idle');
  if (!idle[0]) return {};
  put('idle', idle[0]);
  // 숨 쉬기, 깜빡이기 줄: 짧게 지나가는 세 번째 장(110ms)이 깜빡임이다. 장이 적으면 둘째 장
  if (idle.length > 1) put('blink', idle[Math.min(2, idle.length - 1)]);
  // 오른쪽으로 달리기 -> 걷기 여섯 장 (오른쪽 모습. 왼쪽으로 갈 때는 그리는 쪽이 뒤집는다)
  const run = rowOf('running-right');
  for (const [k, i] of evenPick(run.length, 6).entries()) put(`walk-${k}` as SpriteName, run[i]);
  put('wave', mid(rowOf('waving')));
  put('happy', mid(rowOf('jumping')));
  put('sulky', mid(rowOf('failed')));
  // 기다리기(사용자를 기다리며 조르는 모습)는 배고파 조르기와 가장 가깝다
  put('hungry', mid(rowOf('waiting')));
  // 살펴보기 줄 -> 말하기 두 장 (첫 장과 가운데 장을 번갈아)
  const review = rowOf('review');
  put('talk-0', review[0]);
  if (review.length > 1) put('talk-1', mid(review));
  return out;
}
