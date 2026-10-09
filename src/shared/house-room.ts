// 집 안 (집에서 쉬기). 쉬는 동안 집 앞벽을 걷어 낸 단면(방)으로 침대에서 자는 펫을 보여 준다.
// 방 자리, 침대와 베개 위 얼굴 자리, 문간에서 걸어 들어가는 펫 그림 자리, 펫 창과 그 그림을 맞추는 계산만 (화면 없이 시험한다).
// 숫자는 집 그림 칸(120) 기준이다 (house-art.ts ART).
import { isFaceUrl } from './face.ts';
import type { Rect } from './geometry.ts';

/**
 * 방 모양. rect 는 네모 벽(나무집, 성, 버섯 줄기), r 은 아래 두 모서리 둥글기(버섯 줄기).
 * dome 은 반타원 벽(눈집): 가운데 cx, 바닥 floor, 반지름 rx, ry
 */
export type RoomShape =
  /** ceiling: Zzz 가 이 높이(그림 칸 y) 위로 올라가지 않는다. 방 바로 위에 지붕 띠가 있는 집 (버섯집 갓) */
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number; ceiling?: number }
  | { kind: 'dome'; cx: number; floor: number; rx: number; ry: number };

/** 문: 가운데 x, 문턱 y, 둥근 문 꼭대기 y, 너비 */
export interface DoorArt {
  x: number;
  bottom: number;
  top: number;
  w: number;
}

/** 그림 칸 정사각형 (펫 그림 자리) */
export interface ArtSquare {
  x: number;
  y: number;
  size: number;
}

/** 방 테두리 SVG 길 (clipPath 와 단면 테두리에 같이 쓴다) */
export function roomPath(room: RoomShape): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  if (room.kind === 'dome') {
    const { cx, floor, rx, ry } = room;
    return `M${n(cx - rx)} ${n(floor)}A${n(rx)} ${n(ry)} 0 0 1 ${n(cx + rx)} ${n(floor)}Z`;
  }
  const { x, y, w, h } = room;
  const r = Math.min(room.r ?? 0, w / 2, h / 2);
  if (!r) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h - r)}Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}Z`;
}

/** 점이 방 안인지 (그림 칸) */
export function inRoom(room: RoomShape, x: number, y: number): boolean {
  if (room.kind === 'dome') {
    if (y > room.floor) return false;
    return ((x - room.cx) / room.rx) ** 2 + ((room.floor - y) / room.ry) ** 2 <= 1;
  }
  return x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h;
}

/**
 * 가구를 놓을 네모 자리. 네모 방은 그대로, 반타원 방은 바닥에서 위로 ry 의 0.78 까지 중
 * 가장 높은 가구(머리판) 높이에서도 벽 안에 드는 너비
 */
export function roomBox(room: RoomShape): { x: number; y: number; w: number; h: number } {
  if (room.kind === 'rect') return { x: room.x, y: room.y, w: room.w, h: room.h };
  const h = room.ry * 0.78;
  const half = room.rx * Math.sqrt(1 - 0.62 ** 2);
  return { x: room.cx - half, y: room.floor - h, w: half * 2, h };
}

/** 방 안 그림 자리 (그림 칸) */
export interface RoomScene {
  /** 침대: 왼쪽 x, 너비, 매트리스 윗면 y, 바닥 y */
  bed: { x: number; w: number; top: number; floor: number };
  /** 머리판 꼭대기 y, 발판 꼭대기 y */
  headboard: number;
  footboard: number;
  /** 베개에 누운 얼굴 그림 (자는 얼굴, 정사각형) */
  head: ArtSquare;
  /** 이불: 왼쪽 x(턱 밑), 오른쪽 x, 볼록한 꼭대기 y */
  blanket: { x0: number; x1: number; top: number };
  /** 스탠드 불 자리와 탁자(있으면 탁자 왼쪽 x). 탁자가 없으면 벽 등 */
  lamp: { x: number; y: number; table?: number };
  /** 뒷벽 창 (밤하늘). 자리가 없으면 없다 */
  window?: { x: number; y: number; w: number; h: number };
  /**
   * 첫 z 글자 자리 (얼굴 오른쪽 위)와 글자 크기 비율 k (1 이면 z 10, z 12.5, Z 15, 높이 31).
   * 방 위가 좁으면(버섯집) 줄여서 지붕(갓)에 덜 겹치게. 그래도 0.7 아래로는 줄이지 않는다 (작은 집에서 안 읽힌다).
   * rise 는 글자가 올라가는 높이 비율 (1 이면 9, 19). 방에 ceiling 이 있으면 그 아래에 들게 낮추고 눕힌다
   */
  zzz: { x: number; y: number; k: number; rise?: number };
}

/** 침대 너비 한계 (그림 칸) */
const BED_MAX = 58;
const BED_MIN = 24;
/** 탁자 스탠드 너비. 방이 이보다 좁으면 벽 등으로 */
const TABLE_W = 9;
const TABLE_ROOM = 58;

/**
 * 방 안 가구 자리. 침대는 옆에서 본 모습: 왼쪽 머리판, 베개 위에 펫 얼굴, 턱 밑부터 발판까지 이불.
 * 방이 넓으면 머리맡에 탁자 스탠드, 좁으면 머리판 위 벽 등. 위가 남으면 뒷벽에 밤하늘 창
 */
export function roomScene(room: RoomShape): RoomScene {
  const b = roomBox(room);
  const floor = b.y + b.h;
  const table = b.w >= TABLE_ROOM;
  const side = table ? TABLE_W + 2 : 0;
  // 머리판 꼭대기가 방 위로 4칸은 남게 (침대 높이는 너비의 0.56)
  const byHeight = (b.h - 6) / 0.56;
  const bw = Math.max(BED_MIN, Math.min(BED_MAX, b.w - side - 6, b.w * 0.8, byHeight));
  const x0 = b.x + (b.w - bw - side) / 2;
  const bedX = x0 + side;
  const top = floor - bw * 0.26;
  const hs = bw * 0.44;
  const headCx = bedX + 4 + hs * 0.5;
  const headBottom = top + hs * 0.1;
  const head = { x: headCx - hs / 2, y: headBottom - hs, size: hs };
  const headboard = floor - bw * 0.56;
  const footboard = floor - bw * 0.36;
  const blanket = { x0: headCx + hs * 0.2, x1: bedX + bw - 3, top: top - bw * 0.15 };
  const lamp = table
    ? { x: x0 + TABLE_W / 2, y: floor - 21, table: x0 }
    : { x: bedX + 2, y: Math.max(b.y + 5, headboard - 7) };
  const zy = Math.max(37, head.y + 2);
  const k = Math.round(Math.min(1, Math.max(0.7, (zy - b.y + 2) / 31)) * 100) / 100;
  const zzz = fitCeiling(
    { x: Math.min(93, Math.max(2, headCx + hs * 0.3)), y: zy, k, rise: 1 },
    room.kind === 'rect' ? room.ceiling : undefined,
    blanket.top - 2,
    b.x + b.w - 2,
  );
  // 뒷벽 창: 머리판 위로 18칸 넘게 남으면 위쪽에. Zzz 와 등에 겹치지 않는 쪽 (오른쪽 먼저)
  const free = headboard - b.y;
  const wy = b.y + Math.max(4, (free - 14) / 2);
  const zzzBox = zzzRect(zzz);
  const lampBox = { x: lamp.x - 5, y: lamp.y - 6, w: 10, h: 11 };
  const win =
    free >= 18 && b.w >= 40
      ? [b.x + b.w - 18, b.x + 5]
          .map((x) => ({ x, y: wy, w: 13, h: 11 }))
          .find((w) => !overlaps(w, zzzBox) && !overlaps(w, lampBox))
      : undefined;
  return {
    bed: { x: bedX, w: bw, top, floor },
    headboard,
    footboard,
    head,
    blanket,
    lamp,
    ...(win ? { window: win } : {}),
    zzz,
  };
}

/**
 * 편지 표시(24x17 봉투, 오른쪽 위에 반지름 4.5 빨간 점) 왼쪽 위 자리. 방 위 모서리에 걸쳐 집에 붙어 있게.
 * 오른쪽 모서리 먼저, Zzz(zzz 가 있으면)와 겹치면 왼쪽, 그래도 겹치면 Zzz 바로 왼쪽. 빨간 점과 들썩임(위로 3)까지 그림 칸(120) 안에
 */
export function letterSpot(room: RoomShape, zzz?: RoomScene['zzz']): { x: number; y: number } {
  const top = room.kind === 'dome' ? room.floor - room.ry * 0.72 - 6 : room.y - 4;
  const [l, r] =
    room.kind === 'dome'
      ? [room.cx - room.rx * 0.72 - 6, room.cx + room.rx * 0.72 - 18]
      : [room.x - 4, room.x + room.w - 20];
  const fit = (x: number) => ({
    x: Math.round(Math.min(120 - 30, Math.max(1, x))),
    y: Math.round(Math.min(90, Math.max(10, top))),
  });
  const right = fit(r);
  if (!zzz) return right;
  const zb = zzzRect(zzz);
  const box = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - 5, w: 29, h: 22 });
  // 오른쪽, 왼쪽, Zzz 바로 왼쪽 순으로 겹치지 않는 첫 자리
  const pick = [right, fit(l), fit(Math.min(l, zb.x - 30))].find((p) => !overlaps(box(p), zb));
  return pick ?? right;
}

/** Zzz 세 글자를 덮는 상자 (첫 z 왼쪽 아래부터 Z 오른쪽 위까지) */
export function zzzRect(z: RoomScene['zzz']): { x: number; y: number; w: number; h: number } {
  const up = (12 + 19 * (z.rise ?? 1)) * z.k;
  return { x: z.x - 1, y: z.y - up, w: 28 * z.k, h: up + 2 };
}

/**
 * 지붕 띠(ceiling) 아래에 Zzz 가 다 들게: 먼저 이불 위(lowest)까지 내리고(얼굴 옆으로 비켜 오른쪽으로 조금),
 * 그래도 넘치면 글자가 올라가는 높이를 줄여 눕힌다 (0.4 까지). Z 꼭대기는 글자 크기의 0.73 쯤
 */
function fitCeiling(
  z: { x: number; y: number; k: number; rise: number },
  ceiling: number | undefined,
  lowest: number,
  right: number,
): RoomScene['zzz'] {
  const cap = 15 * 0.74 * z.k;
  const top = (y: number, rise: number) => y - 19 * rise * z.k - cap;
  if (ceiling === undefined || top(z.y, 1) >= ceiling) return z;
  const y = Math.max(z.y, Math.min(lowest, ceiling + 19 * z.k + cap));
  const rise = Math.floor(Math.min(1, Math.max(0.4, (y - ceiling - cap) / (19 * z.k))) * 100) / 100;
  const x = Math.min(right - 25 * z.k, z.x + (y - z.y) * 0.6);
  return { x, y, k: z.k, rise };
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 문간에 선 펫 그림 자리 (몸 전체, 정사각형). 문 높이의 0.86 이고 문 너비보다 조금 넓을 수 있다
 * (넓은 펫은 문틀에 양옆이 살짝 가린다). 아래는 문턱에 닿는다
 */
export function doorSprite(door: DoorArt): ArtSquare {
  const size = Math.min((door.bottom - door.top) * 0.86, door.w * 1.15);
  return { x: door.x - size / 2, y: door.bottom - size, size };
}

/** 그림 칸 정사각형을 화면 좌표로 (집 창 house) */
export function artToScreen(house: Rect, sq: ArtSquare, art = 120): Rect {
  const k = house.width / art;
  return {
    x: Math.round(house.x + sq.x * k),
    y: Math.round(house.y + sq.y * k),
    width: Math.max(1, Math.round(sq.size * k)),
    height: Math.max(1, Math.round(sq.size * k)),
  };
}

/**
 * 펫 그림이 펫 캔버스에서 자른 자리 (캔버스 한 변에 대한 비율). 펫 그림은 이 정사각형을 잘라 만든다
 */
export interface SpriteBox {
  x: number;
  y: number;
  side: number;
}

/**
 * 화면 sprite 자리에 펫 그림과 똑같이 보이려면 펫 창(펫 사각형)이 있어야 할 자리.
 * 펫 창이 집 창 그림으로 넘겨줄 때(들어가기)와 넘겨받을 때(나오기) 펫이 튀지 않게
 */
export function spriteToPet(sprite: Rect, box: SpriteBox): Rect {
  const size = Math.max(4, Math.round(sprite.width / box.side));
  return {
    x: Math.round(sprite.x - box.x * size),
    y: Math.round(sprite.y - box.y * size),
    width: size,
    height: size,
  };
}

/** 펫 화면이 그린 집 안 그림: 깬 몸 전체(문 드나들기), 자는 얼굴(침대), 깬 몸을 자른 자리 */
export interface HouseSprites {
  awake: string;
  sleep: string;
  box: SpriteBox;
}

/** 펫 화면이 보낸 집 안 그림 검사. 받을 수 없으면 undefined */
export function parseSprites(raw: unknown): HouseSprites | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const box = r.box as Record<string, unknown> | undefined;
  if (!isFaceUrl(r.awake) || !isFaceUrl(r.sleep) || !box || typeof box !== 'object') return undefined;
  const { x, y, side } = box;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof side !== 'number') return undefined;
  if (![x, y, side].every(Number.isFinite) || side <= 0.05 || side > 2 || Math.abs(x) > 1 || Math.abs(y) > 1)
    return undefined;
  return { awake: r.awake, sleep: r.sleep, box: { x, y, side } };
}

/** 그림을 아직 못 받았을 때 깬 몸이 캔버스에서 차지한다고 볼 자리 */
export const DEFAULT_BOX: SpriteBox = { x: 0.12, y: 0.16, side: 0.76 };
