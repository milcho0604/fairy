// 집 그림 (SVG 글). 모양 넷 x 단계 다섯. 그림과 같은 숫자로 잡는 자리(hits), 문, Zzz, 편지 자리를 같이 낸다.
// 메인(집 창)과 패널(상점 미리 보기)이 같이 쓴다. 120 칸 기준으로 그리고 창 크기에 맞춰 늘린다.
// 집에서 쉬는 동안 보이는 집 안(앞벽을 걷어 낸 방, 침대, 자는 펫)과 문간에서 걸어 들어가는 펫 그림 자리도 여기서 그린다.
import {
  type DoorArt,
  doorSprite,
  letterSpot,
  type RoomScene,
  type RoomShape,
  roomPath,
  roomScene,
} from './house-room.ts';

export const HOUSE_STYLES = ['wood', 'mushroom', 'igloo', 'castle'] as const;
export type HouseStyle = (typeof HOUSE_STYLES)[number];
export const isHouseStyle = (v: unknown): v is HouseStyle => (HOUSE_STYLES as readonly unknown[]).includes(v);

/** 가장 높은 단계 */
export const HOUSE_LEVELS = 5;
/** 그림 칸 크기 */
export const ART = 120;

/** 잡는 자리 하나: 사각형 [x, y, w, h], 타원 [cx, cy, rx, ry], 다각형 [x, y, x, y, ...] */
export type HitShape = { rect: readonly number[] } | { ell: readonly number[] } | { poly: readonly number[] };

export interface HouseLayout {
  /** 마당, 울타리 (숨쉬기 들썩에 안 들어간다) */
  back: string;
  /** 집 몸 (body.home 숨쉬기 때 들썩인다) */
  body: string;
  hits: HitShape[];
  /** 문 가운데 x, 문턱 y, 둥근 문 꼭대기 y, 너비 (펫이 걸어 들어가는 자리) */
  door: DoorArt;
  /** 쉬는 동안 걷어 내 보여 주는 방 (앞벽) */
  room: RoomShape;
  /** 방 안 가구 자리 */
  scene: RoomScene;
  /** 방 그림 (body.home 일 때 보인다). 미리 보기에는 넣지 않는다 */
  roomSvg: string;
  /** 첫 z 글자 자리 (침대에서 자는 얼굴 오른쪽 위)와 글자 크기 비율 k. 다음 글자는 오른쪽 위로 오른다 */
  zzz: RoomScene['zzz'];
  /** 편지 표시 왼쪽 위 */
  letter: { x: number; y: number };
}

const GLASS = '#bfe3ff';
const LIT = '#ffd27a';
const GLOW = '#ffc861';
/** 열린 문 안 어둠 */
const DARK = '#3b2a21';

interface Ink {
  /** 테두리 */
  line: string;
  /** 문 */
  door: string;
}

/** 그림 모으기. 잡는 자리를 그림과 같은 숫자로 같이 적는다 */
class Art {
  back: string[] = [];
  body: string[] = [];
  hits: HitShape[] = [];
  door: DoorArt = { x: 52, bottom: 110, top: 68, w: 24 };
  /** 쉬는 동안 보여 줄 방 (앞벽). 모양마다 지붕 아래 벽 안쪽으로 정한다 */
  room: RoomShape = { kind: 'rect', x: 22, y: 57, w: 76, h: 53, r: 4 };
  ink: Ink;
  /** 그림 안 clipPath 이름 앞붙이 (모양-단계. 상점 미리 보기처럼 한 화면에 여러 집이 있어도 겹치지 않게) */
  id: string;
  constructor(ink: Ink, id: string) {
    this.ink = ink;
    this.id = id;
  }
  /** 문 틀 clipPath 이름 */
  get doorClip() {
    return `jjdw-${this.id}`;
  }
  add(svg: string, hit?: HitShape) {
    this.body.push(svg);
    if (hit) this.hits.push(hit);
  }
  addBack(svg: string, hit?: HitShape) {
    this.back.push(svg);
    if (hit) this.hits.push(hit);
  }
  rect(x: number, y: number, w: number, h: number, fill: string, rx = 0, sw = 2.5) {
    this.add(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${this.ink.line}" stroke-width="${sw}"/>`,
      { rect: [x, y, w, h] },
    );
  }
  poly(pts: readonly number[], fill: string, sw = 2.5) {
    this.add(
      `<path d="M${pts.join(' ')}Z" fill="${fill}" stroke="${this.ink.line}" stroke-width="${sw}" stroke-linejoin="round"/>`,
      { poly: pts },
    );
  }
  /** 아래가 살짝 볼록한 반타원 지붕 (버섯 갓, 이글루) */
  dome(cx: number, cy: number, rx: number, ry: number, fill: string, sag = 0) {
    const bottom = sag ? `Q${cx} ${cy + sag} ${cx - rx} ${cy}` : 'Z';
    this.add(
      `<path d="M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}${bottom}${sag ? 'Z' : ''}" fill="${fill}" stroke="${this.ink.line}" stroke-width="2.5" stroke-linejoin="round"/>`,
      { poly: domePoly(cx, cy, rx, ry, sag) },
    );
  }
  /**
   * 둥근 문. 쉬는 중이면 안이 불빛으로 밝다.
   * 문짝(leaf)은 body.open 이면 왼쪽 경첩 쪽으로 접혀 열리고 문 안 어둠이 보인다. 그 사이에 문간 펫 그림(walker)이
   * 문 틀 모양으로 잘려 있어 펫이 벽 뒤로 걸어 들어가는 것처럼 보인다 (play.ts HOUSE_CSS)
   */
  arch(cx: number, w: number, top: number, bottom = 110, color = this.ink.door) {
    const r = w / 2;
    const l = cx - r;
    const ir = r - 4;
    const d = `M${l} ${bottom}V${top + r}a${r} ${r} 0 0 1 ${w} 0V${bottom}Z`;
    this.door = { x: cx, bottom, top, w };
    const s = doorSprite(this.door);
    const n = (v: number) => Math.round(v * 10) / 10;
    this.add(
      `<clipPath id="${this.doorClip}"><path d="${d}"/></clipPath>` +
        `<path d="${d}" fill="${DARK}"/>` +
        `<ellipse cx="${cx}" cy="${bottom - 1.5}" rx="${r - 1}" ry="3" fill="${GLOW}" opacity=".45"/>` +
        `<g clip-path="url(#${this.doorClip})"><g class="walker"><g class="wkg"><image class="wk" x="${n(s.x)}" y="${n(s.y)}" width="${n(s.size)}" height="${n(s.size)}"/></g></g></g>` +
        `<g class="leaf"><path d="${d}" fill="${color}"/>` +
        `<path class="rest" d="M${l + 4} ${bottom}V${top + r + 1}a${ir} ${ir} 0 0 1 ${ir * 2} 0V${bottom}Z" fill="${GLOW}"/>` +
        `<circle cx="${cx + r - 5}" cy="${(top + r + bottom) / 2 + 2}" r="1.8" fill="${LIT}"/></g>` +
        `<path d="${d}" fill="none" stroke="${this.ink.line}" stroke-width="2"/>`,
    );
  }
  /** 네모 창: 유리, 쉬는 중 불빛, 창살 */
  win(x: number, y: number, w: number, h: number, glass = GLASS) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    this.add(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${glass}" stroke="${this.ink.line}" stroke-width="2"/>` +
        `<rect class="rest" x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" fill="${LIT}"/>` +
        `<path d="M${cx} ${y}v${h}M${x} ${cy}h${w}" stroke="${this.ink.line}" stroke-width="1.5"/>`,
    );
  }
  /** 위가 둥근 창 (성) */
  archWin(x: number, y: number, w: number, h: number, glass = GLASS) {
    const r = w / 2;
    const d = `M${x} ${y + h}V${y + r}a${r} ${r} 0 0 1 ${w} 0V${y + h}Z`;
    this.add(
      `<path d="${d}" fill="${glass}" stroke="${this.ink.line}" stroke-width="2"/>` +
        `<path class="rest" d="M${x + 1.5} ${y + h - 1.5}V${y + r}a${r - 1.5} ${r - 1.5} 0 0 1 ${w - 3} 0V${y + h - 1.5}Z" fill="${LIT}"/>` +
        `<path d="M${x + r} ${y + 1}v${h - 1}" stroke="${this.ink.line}" stroke-width="1.5"/>`,
    );
  }
  roundWin(cx: number, cy: number, r: number, glass = GLASS) {
    this.add(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${glass}" stroke="${this.ink.line}" stroke-width="2"/>` +
        `<circle class="rest" cx="${cx}" cy="${cy}" r="${r - 1.5}" fill="${LIT}"/>` +
        (r >= 5
          ? `<path d="M${cx - r} ${cy}h${r * 2}M${cx} ${cy - r}v${r * 2}" stroke="${this.ink.line}" stroke-width="1.3"/>`
          : ''),
    );
  }
  /** 창 아래 꽃 상자 */
  flowerBox(x: number, y: number, w: number) {
    const n = Math.max(2, Math.round(w / 7));
    let f = '';
    for (let i = 0; i < n; i++) {
      const fx = x + ((i + 0.5) * w) / n;
      f += `<circle cx="${fx}" cy="${y - 1.5}" r="2.6" fill="${i % 2 ? '#ffd166' : '#ff8fab'}"/>`;
    }
    this.add(
      `<g stroke="${this.ink.line}" stroke-width="1.2">${f}</g><rect x="${x - 1}" y="${y}" width="${w + 2}" height="5" rx="1.5" fill="#c4854a" stroke="${this.ink.line}" stroke-width="1.5"/>`,
    );
  }
  /** 굴뚝과 연기 (연기는 잡지 않는다) */
  chimney(x: number, y: number, w: number, h: number, fill: string) {
    this.rect(x, y, w, h, fill, 1, 2.2);
    this.add(
      `<rect x="${x - 2}" y="${y - 1}" width="${w + 4}" height="4" rx="1.5" fill="${fill}" stroke="${this.ink.line}" stroke-width="2"/>`,
    );
    const cx = x + w / 2;
    this.add(smoke(cx, y - 5));
  }
  /** 장대 끝 깃발 */
  flag(x: number, top: number, h: number, color = '#ef476f') {
    this.add(
      `<path d="M${x} ${top + 2}V${top + h}" stroke="${this.ink.line}" stroke-width="2" stroke-linecap="round"/>` +
        `<path d="M${x + 1} ${top + 2.5}q7 -1.5 13 2.5q-6 4 -13 5Z" fill="${color}" stroke="${this.ink.line}" stroke-width="1.5" stroke-linejoin="round"/>` +
        `<circle cx="${x}" cy="${top + 1.5}" r="2" fill="#ffd166" stroke="${this.ink.line}" stroke-width="1.2"/>`,
      { rect: [x - 2, top, 16, h] },
    );
  }
  /** 늘 켜 둔 등불 (5단계) */
  lantern(x: number, y: number) {
    const l = this.ink.line;
    this.add(
      `<circle cx="${x}" cy="${y + 6}" r="9" fill="${LIT}" opacity=".35"/>` +
        `<path d="M${x} ${y - 5}v4" stroke="${l}" stroke-width="1.5"/>` +
        `<rect x="${x - 4}" y="${y}" width="8" height="11" rx="3" fill="${LIT}" stroke="${l}" stroke-width="1.5"/>` +
        `<path d="M${x - 3} ${y}h6M${x - 3} ${y + 11}h6" stroke="${l}" stroke-width="2.2" stroke-linecap="round"/>`,
    );
  }
  /** 울타리 (집 뒤 마당) */
  fence(x1: number, x2: number, fill = '#fffaf0') {
    const l = this.ink.line;
    let p = '';
    for (let x = x1 + 1; x + 5 <= x2; x += 7)
      p += `<path d="M${x} 112V101l2.5 -3 2.5 3V112Z" fill="${fill}" stroke="${l}" stroke-width="1.4" stroke-linejoin="round"/>`;
    this.addBack(`<path d="M${x1} 104H${x2}M${x1} 109H${x2}" stroke="${l}" stroke-width="1.4"/>${p}`, {
      rect: [x1, 98, x2 - x1, 14],
    });
  }
  /** 마당: 잔디 띠. ground 는 띠 색 (눈집은 눈) */
  yard(ground = '#6bbf59') {
    this.addBack(`<path d="M3 115H117" stroke="${ground}" stroke-width="7" stroke-linecap="round"/>`, {
      rect: [0, 110, 120, 10],
    });
  }
  flower(x: number, y: number) {
    this.addBack(
      `<path d="M${x} ${y + 3}v7" stroke="#4f9a40" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="4.5" fill="#ff8fab"/><circle cx="${x}" cy="${y}" r="1.8" fill="#ffd166"/>`,
      { ell: [x, y + 2, 5, 7] },
    );
  }
  bush(x: number, y: number, r: number) {
    this.addBack(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#6bbf59" stroke="#4f9a40" stroke-width="1.5"/><circle cx="${x - r * 0.35}" cy="${y - r * 0.3}" r="${r * 0.25}" fill="#8fd47c"/>`,
      { ell: [x, y, r, r] },
    );
  }
  layout(style: HouseStyle): HouseLayout {
    const scene = roomScene(this.room);
    return {
      back: this.back.join(''),
      body: this.body.join(''),
      hits: this.hits,
      door: this.door,
      room: this.room,
      scene,
      roomSvg: roomSvg(`jjrm-${this.id}`, this.room, scene, style, this.ink.line),
      zzz: scene.zzz,
      letter: letterSpot(this.room, scene.zzz),
    };
  }
}

/** 반타원 지붕의 잡는 자리 (윗반 둘레를 18 조각으로, 아래는 볼록한 만큼 반쯤) */
function domePoly(cx: number, cy: number, rx: number, ry: number, sag: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI * (1 - i / 18);
    pts.push(Math.round((cx + rx * Math.cos(a)) * 10) / 10, Math.round((cy - ry * Math.sin(a)) * 10) / 10);
  }
  if (sag) pts.push(cx, cy + sag / 2);
  return pts;
}

function smoke(x: number, y: number): string {
  return `<g fill="#fff" stroke="#c4ccd6" stroke-width="1.4"><circle cx="${x}" cy="${y}" r="3.2"/><circle cx="${x + 2.5}" cy="${y - 6.5}" r="2.6"/><circle cx="${x + 6}" cy="${y - 12}" r="2"/></g>`;
}

/** 지붕 판자 결 (나무집 지붕에 가는 줄) */
function shingles(a: Art, peak: [number, number], eave: number, left: number, right: number) {
  const [px, py] = peak;
  let d = '';
  for (let y = py + 10; y < eave - 3; y += 8) {
    const k = (y - py) / (eave - py);
    d += `M${px - (px - left) * k + 4} ${y}H${px + (right - px) * k - 4}`;
  }
  a.add(`<path d="${d}" stroke="#000" stroke-opacity=".12" stroke-width="1.6"/>`);
}

// ---- 나무집 ----
function wood(a: Art, level: number) {
  const roof = ['#c4854a', '#d9603b', '#4f7cac', '#3f9c8a', '#7a6cc4'][level - 1] ?? '#c4854a';
  const wall = ['#fff4e6', '#ffe8cc', '#f1f5fb', '#fff1dc', '#fffaf0'][level - 1] ?? '#fff4e6';
  if (level >= 3) a.yard();
  if (level <= 3) {
    if (level === 3) {
      a.flower(12, 104);
      a.bush(106, 104, 7);
      a.chimney(30, 26, 9, 14, '#d98b6a');
    }
    a.rect(22, 52, 76, 58, wall, 4);
    a.poly([12, 56, 60, 18, 108, 56], roof);
    shingles(a, [60, 18], 56, 12, 108);
    a.roundWin(60, 41, 6);
    a.arch(52, 24, 68);
    if (level >= 2) a.win(70, 62, 18, 16);
    if (level >= 3) a.flowerBox(70, 80, 18);
    return;
  }
  if (level === 4) {
    a.fence(2, 22);
    a.fence(98, 118);
    a.flower(8, 106);
    a.chimney(28, 20, 9, 12, '#d98b6a');
    a.rect(22, 44, 76, 66, wall, 4);
    a.poly([12, 48, 60, 10, 108, 48], roof);
    shingles(a, [60, 10], 48, 12, 108);
    a.roundWin(60, 33, 5);
    // 2층: 가운데 발코니 문, 양옆 창
    a.win(52, 52, 16, 20);
    a.win(29, 54, 14, 13);
    a.win(77, 54, 14, 13);
    a.add(`<path d="M22 78H98" stroke="${a.ink.line}" stroke-width="2" stroke-opacity=".5"/>`);
    balcony(a, 44, 76, 32);
    a.arch(42, 22, 82);
    a.win(70, 84, 18, 14);
    a.flowerBox(70, 99, 18);
    a.room = { kind: 'rect', x: 22, y: 49, w: 76, h: 61, r: 4 };
    return;
  }
  // 5단계: 저택. 왼쪽 탑, 오른쪽 굴뚝, 문 양옆 등불
  a.fence(100, 118);
  a.flower(110, 104);
  // 굴뚝 연기와 깃발 끝이 그림 위 가장자리(0)에 닿아 잘리지 않게 위쪽 여백을 남긴다
  a.chimney(76, 20, 9, 11, '#d98b6a');
  a.rect(30, 48, 72, 62, wall, 4);
  a.poly([22, 52, 66, 14, 110, 52], roof);
  shingles(a, [66, 14], 52, 22, 110);
  a.roundWin(66, 36, 5);
  a.win(42, 58, 14, 13);
  a.win(84, 58, 14, 13);
  a.win(59, 55, 14, 17);
  balcony(a, 52, 76, 28);
  a.arch(66, 24, 84);
  a.lantern(48, 84);
  a.lantern(84, 84);
  // 탑
  a.rect(6, 42, 26, 68, wall, 3);
  a.poly([2, 45, 19, 12, 36, 45], roof);
  a.flag(19, 2, 11);
  a.roundWin(19, 58, 5);
  a.win(13, 76, 12, 15);
  a.room = { kind: 'rect', x: 32, y: 53, w: 70, h: 57, r: 4 };
}

/** 발코니 난간 (x, 바닥 y, 너비) */
function balcony(a: Art, x: number, y: number, w: number) {
  const l = a.ink.line;
  let posts = '';
  for (let px = x + 4; px < x + w - 1; px += 5) posts += `M${px} ${y - 7}V${y}`;
  a.add(
    `<path d="${posts}" stroke="${l}" stroke-width="1.5"/><path d="M${x} ${y - 8}H${x + w}" stroke="${l}" stroke-width="2.2" stroke-linecap="round"/><rect x="${x - 2}" y="${y}" width="${w + 4}" height="4" rx="1.5" fill="#c4854a" stroke="${l}" stroke-width="1.5"/>`,
  );
}

// ---- 버섯집 ----
function capDots(a: Art, dots: readonly number[]) {
  let s = '';
  for (let i = 0; i < dots.length; i += 3)
    s += `<circle cx="${dots[i]}" cy="${dots[i + 1]}" r="${dots[i + 2]}"/>`;
  a.add(`<g fill="#fff" opacity=".92">${s}</g>`);
}

function mushroom(a: Art, level: number) {
  const cap = '#e8505b';
  const stem = '#fff4e6';
  if (level >= 3) a.yard();
  if (level <= 3) {
    if (level === 3) {
      a.flower(12, 104);
      babyShroom(a, 106, 100, 9);
      a.chimney(30, 20, 8, 16, '#a7b0bd');
    }
    a.rect(36, 62, 48, 48, stem, 8);
    a.dome(60, 66, 48, 44, cap, 8);
    capDots(a, [34, 50, 6, 60, 34, 7, 86, 50, 5.5, 47, 60, 3, 76, 38, 3.5, 98, 62, 2.5]);
    a.arch(52, 20, 82);
    if (level === 1) a.roundWin(72, 84, 4.5);
    else a.roundWin(72, 84, 7);
    if (level >= 3) a.flowerBox(64, 94, 16);
    // 방 바로 위가 갓 아래 띠(가운데가 70 까지 처진 테두리)라 Zzz 는 그 아래에
    a.room = { kind: 'rect', x: 36, y: 71.5, w: 48, h: 38.5, r: 8, ceiling: 74 };
    return;
  }
  if (level === 4) {
    a.fence(2, 30);
    a.flower(8, 106);
    babyShroom(a, 106, 98, 11);
    a.rect(34, 52, 52, 58, stem, 8);
    a.dome(60, 54, 52, 44, cap, 9);
    capDots(a, [30, 40, 6.5, 58, 22, 7.5, 88, 38, 6, 44, 50, 3, 74, 46, 3.5, 102, 52, 3]);
    a.roundWin(48, 72, 6);
    a.roundWin(72, 72, 6);
    balcony(a, 40, 84, 40);
    a.arch(50, 20, 90);
    a.roundWin(74, 99, 5);
    a.room = { kind: 'rect', x: 34, y: 60, w: 52, h: 50, r: 8 };
    return;
  }
  // 5단계: 큰 버섯과 왼쪽 버섯 탑, 깃발, 등불
  a.fence(96, 118);
  a.flower(110, 104);
  a.rect(42, 54, 50, 56, stem, 8);
  a.dome(68, 56, 48, 42, cap, 9);
  capDots(a, [40, 42, 6, 66, 26, 7.5, 94, 40, 6.5, 52, 52, 3, 80, 50, 3.5, 108, 54, 3]);
  a.roundWin(56, 70, 6);
  a.roundWin(80, 70, 6);
  a.arch(67, 22, 86);
  a.lantern(51, 86);
  a.lantern(84, 86);
  // 탑
  a.rect(9, 48, 20, 62, stem, 6);
  a.dome(19, 48, 17, 15, cap, 4);
  capDots(a, [12, 42, 3, 23, 37, 3.5, 30, 44, 2]);
  a.flag(19, 17, 16);
  a.roundWin(19, 66, 5);
  a.roundWin(19, 88, 4.5);
  a.room = { kind: 'rect', x: 42, y: 62, w: 50, h: 48, r: 8 };
}

/** 마당 꼬마 버섯 */
function babyShroom(a: Art, x: number, y: number, r: number) {
  const l = a.ink.line;
  a.addBack(
    `<rect x="${x - r * 0.4}" y="${y}" width="${r * 0.8}" height="${112 - y}" rx="2" fill="#fff4e6" stroke="${l}" stroke-width="1.6"/>` +
      `<path d="M${x - r} ${y + 1}A${r} ${r * 0.85} 0 0 1 ${x + r} ${y + 1}Z" fill="#e8505b" stroke="${l}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<circle cx="${x - r * 0.4}" cy="${y - r * 0.35}" r="${r * 0.18}" fill="#fff"/><circle cx="${x + r * 0.3}" cy="${y - r * 0.55}" r="${r * 0.14}" fill="#fff"/>`,
    { rect: [x - r, y - r * 0.85, r * 2, 112 - y + r * 0.85] },
  );
}

// ---- 눈집 (이글루) ----
const SNOW = '#f7fbff';
const ICE = '#d6efff';

/** 이글루 얼음 벽돌 줄 */
function iceRows(a: Art, cx: number, cy: number, rx: number, ry: number) {
  let d = '';
  let row = 0;
  for (let y = cy - 13; y > cy - ry + 6; y -= 13, row++) {
    const half = rx * Math.sqrt(1 - ((cy - y) / ry) ** 2);
    d += `M${(cx - half + 2).toFixed(1)} ${y}H${(cx + half - 2).toFixed(1)}`;
    // 세로 이음매 (줄마다 엇갈린다)
    const step = 14;
    for (let x = cx - half + (row % 2 ? step : step / 2); x < cx + half - 4; x += step)
      d += `M${x.toFixed(1)} ${y}v13`;
  }
  a.add(`<path d="${d}" stroke="#a9c8e0" stroke-width="1.4" stroke-linecap="round"/>`);
}

/** 이글루 굴 문 (앞으로 나온 반원 굴, 안은 어둡다) */
function tunnel(a: Art, cx: number, w: number, top: number) {
  const r = w / 2;
  a.add(
    `<path d="M${cx - r} 110V${top + r}a${r} ${r} 0 0 1 ${w} 0V110Z" fill="${SNOW}" stroke="${a.ink.line}" stroke-width="2.5"/>`,
    { rect: [cx - r, top, w, 110 - top] },
  );
  a.arch(cx, w - 12, top + 7);
}

function igloo(a: Art, level: number) {
  if (level >= 3) a.yard('#d4e9f7');
  if (level <= 3) {
    const ry = [52, 58, 58][level - 1] ?? 58;
    const rx = level === 1 ? 42 : 46;
    if (level === 3) {
      snowman(a, 9, 104);
      pine(a, 110, 112, 20);
      a.chimney(32, 42, 7, 14, '#a7b0bd');
    }
    a.dome(58, 110, rx, ry, SNOW);
    iceRows(a, 58, 110, rx, ry);
    tunnel(a, 46, 30, 80);
    a.roundWin(80, 82, level === 1 ? 4.5 : 7, ICE);
    a.room = { kind: 'dome', cx: 58, floor: 110, rx, ry };
    return;
  }
  if (level === 4) {
    snowman(a, 8, 104);
    pine(a, 111, 112, 20);
    a.chimney(38, 26, 7, 14, '#a7b0bd');
    a.dome(60, 76, 32, 38, SNOW);
    iceRows(a, 60, 76, 32, 38);
    a.roundWin(60, 56, 6, ICE);
    balcony(a, 38, 76, 44);
    a.dome(60, 110, 45, 40, SNOW);
    iceRows(a, 60, 110, 45, 40);
    tunnel(a, 44, 28, 84);
    a.roundWin(82, 92, 6, ICE);
    a.room = { kind: 'dome', cx: 60, floor: 110, rx: 45, ry: 40 };
    return;
  }
  // 5단계: 얼음 궁전. 가운데 큰 이글루, 양옆 얼음 탑, 깃발, 등불
  const tower = (x: number, w: number, top: number, peak: number) => {
    a.rect(x, top, w, 110 - top, ICE, 2);
    a.add(
      `<path d="M${x + 4} ${top + 12}h${w - 8}M${x + 4} ${top + 26}h${w - 8}M${x + 4} ${top + 40}h${w - 8}" stroke="#a9c8e0" stroke-width="1.4" stroke-linecap="round"/>`,
    );
    a.poly([x - 4, top + 3, x + w / 2, peak, x + w + 4, top + 3], '#9fd0f2');
  };
  tower(92, 20, 62, 38);
  tower(8, 22, 46, 14);
  a.flag(19, 2, 13, '#5aa9e6');
  a.archWin(14, 62, 10, 14, ICE);
  a.roundWin(102, 80, 4.5, ICE);
  a.dome(62, 110, 42, 60, SNOW);
  iceRows(a, 62, 110, 42, 60);
  a.roundWin(62, 66, 6, ICE);
  tunnel(a, 62, 30, 80);
  a.lantern(40, 84);
  a.lantern(84, 84);
  a.room = { kind: 'dome', cx: 62, floor: 110, rx: 42, ry: 60 };
}

function snowman(a: Art, x: number, y: number) {
  const l = a.ink.line;
  a.addBack(
    `<circle cx="${x}" cy="${y + 2}" r="6" fill="${SNOW}" stroke="${l}" stroke-width="1.6"/><circle cx="${x}" cy="${y - 7}" r="4.2" fill="${SNOW}" stroke="${l}" stroke-width="1.6"/><path d="M${x} ${y - 6.5}l3.5 1-3.5 1Z" fill="#ff9f43"/><circle cx="${x - 1.4}" cy="${y - 8.4}" r=".8" fill="${l}"/>`,
    { ell: [x, y - 2, 6, 11] },
  );
}

function pine(a: Art, x: number, bottom: number, h: number) {
  const l = a.ink.line;
  a.addBack(
    `<path d="M${x} ${bottom - h}l${h * 0.36} ${h * 0.75}h${-h * 0.72}Z" fill="#5fae7a" stroke="${l}" stroke-width="1.6" stroke-linejoin="round"/><path d="M${x - 2} ${bottom - h * 0.25}h4v${h * 0.25 - 2}h-4Z" fill="#a0724e"/><path d="M${x - h * 0.15} ${bottom - h * 0.75}q${h * 0.15} 3 ${h * 0.3} 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
    { poly: [x, bottom - h, x + h * 0.38, bottom, x - h * 0.38, bottom] },
  );
}

// ---- 성 ----
const STONE = '#ece6f3';
const CONE = '#f08aa8';

/** 성벽 위 톱니 (x 부터 너비 w, 위 y) */
function battlement(a: Art, x: number, w: number, y: number) {
  const n = Math.max(3, Math.round(w / 12));
  const mw = w / (n * 2 - 1);
  const pts: number[] = [x, y + 8];
  for (let i = 0; i < n; i++) {
    const mx = x + i * 2 * mw;
    pts.push(mx, y, mx + mw, y);
    if (i < n - 1) pts.push(mx + mw, y + 5, mx + 2 * mw, y + 5);
  }
  pts.push(x + w, y + 8);
  a.add(
    `<path d="M${pts.join(' ')}Z" fill="${STONE}" stroke="${a.ink.line}" stroke-width="2.2" stroke-linejoin="round"/>`,
    { rect: [x, y, w, 8] },
  );
}

/** 돌 벽돌 무늬 몇 개 */
function bricks(a: Art, list: readonly number[]) {
  let d = '';
  for (let i = 0; i < list.length; i += 2) d += `M${list[i]} ${list[i + 1]}h7`;
  a.add(`<path d="${d}" stroke="#b9aecb" stroke-width="1.6" stroke-linecap="round"/>`);
}

function turret(a: Art, x: number, w: number, top: number, peak: number) {
  a.rect(x, top, w, 110 - top, STONE, 2);
  a.poly([x - 4, top + 3, x + w / 2, peak, x + w + 4, top + 3], CONE);
}

function castle(a: Art, level: number) {
  if (level >= 3) a.yard();
  if (level <= 3) {
    if (level === 3) {
      a.flower(12, 104);
      a.bush(106, 104, 7);
      turret(a, 30, 14, 34, 14);
    }
    a.rect(32, 52, 56, 58, STONE, 2);
    battlement(a, 30, 60, 44);
    bricks(a, [38, 62, 70, 70, 40, 92, 76, 100]);
    a.arch(54, 22, 80, 110, '#a0724e');
    if (level === 1) a.archWin(73, 62, 7, 13);
    else a.archWin(70, 60, 12, 17);
    if (level >= 2) a.archWin(38, 60, 9, 13);
    if (level >= 3) a.flowerBox(69, 80, 14);
    a.room = { kind: 'rect', x: 32, y: 53, w: 56, h: 57 };
    return;
  }
  if (level === 4) {
    a.fence(102, 118);
    a.flower(110, 104);
    a.flower(8, 106);
    a.rect(28, 46, 64, 64, STONE, 2);
    battlement(a, 26, 68, 38);
    bricks(a, [36, 56, 64, 64, 44, 96, 78, 100]);
    turret(a, 14, 16, 30, 8);
    turret(a, 90, 16, 30, 8);
    a.archWin(18, 46, 8, 12);
    a.archWin(94, 46, 8, 12);
    a.archWin(40, 52, 10, 15);
    a.archWin(70, 52, 10, 15);
    balcony(a, 46, 76, 28);
    a.archWin(54, 60, 12, 16);
    a.arch(46, 22, 84, 110, '#a0724e');
    a.archWin(70, 86, 10, 13);
    a.flowerBox(69, 100, 12);
    a.room = { kind: 'rect', x: 31.5, y: 47, w: 57, h: 63 };
    return;
  }
  // 5단계: 큰 성. 가운데 탑에 깃발, 양옆 탑, 성문 양옆 등불
  turret(a, 6, 22, 52, 26);
  turret(a, 92, 22, 52, 26);
  a.rect(40, 30, 40, 50, STONE, 2);
  a.poly([34, 33, 60, 10, 86, 33], CONE);
  a.flag(60, 2, 9, '#ffd166');
  a.archWin(54, 40, 12, 16);
  a.rect(24, 66, 72, 44, STONE, 2);
  battlement(a, 22, 76, 58);
  bricks(a, [30, 76, 84, 80, 34, 100, 82, 98]);
  a.archWin(13, 66, 8, 12);
  a.archWin(99, 66, 8, 12);
  a.arch(60, 26, 78, 110, '#a0724e');
  // 성문 널빤지 줄. 문이 열리면 문짝과 같이 걷힌다
  a.add(
    `<path class="bars" d="M53 92V110M60 87V110M67 92V110M49 98H71" stroke="${a.ink.line}" stroke-width="1.3" stroke-opacity=".55"/>`,
  );
  a.lantern(38, 82);
  a.lantern(82, 82);
  a.room = { kind: 'rect', x: 24, y: 67, w: 72, h: 43 };
}

const INK: Record<HouseStyle, Ink> = {
  wood: { line: '#8a6a4a', door: '#8a6a4a' },
  mushroom: { line: '#8a6a4a', door: '#9b6b4a' },
  igloo: { line: '#7f9cb8', door: '#5d7896' },
  castle: { line: '#7a6a86', door: '#a0724e' },
};
const DRAW: Record<HouseStyle, (a: Art, level: number) => void> = { wood, mushroom, igloo, castle };

// ---- 집 안 (쉬는 동안 앞벽을 걷어 낸 방) ----

interface RoomInk {
  /** 벽지와 무늬 */
  wall: string;
  pattern: string;
  /** 바닥과 깔개 (없으면 안 깐다) */
  floor: string;
  rug?: string;
  /** 이불과 줄무늬, 침대 나무 */
  blanket: string;
  stripe: string;
  bed: string;
}

const ROOM: Record<HouseStyle, RoomInk> = {
  wood: {
    wall: '#f7e3c4',
    pattern: '#eccb9a',
    floor: '#c58f5e',
    blanket: '#7fa8e3',
    stripe: '#5d86c9',
    bed: '#b07a4f',
  },
  mushroom: {
    wall: '#fde6e0',
    pattern: '#f6c3ba',
    floor: '#b78a62',
    rug: '#8fd47c',
    blanket: '#f6b73c',
    stripe: '#e8505b',
    bed: '#a8784f',
  },
  igloo: {
    wall: '#e3f3ff',
    pattern: '#b6d7ef',
    floor: '#cfe6f6',
    rug: '#ffffff',
    blanket: '#9b8cf0',
    stripe: '#7d6be0',
    bed: '#8eb6d6',
  },
  castle: {
    wall: '#ebe3f3',
    pattern: '#cdbfe0',
    floor: '#a98fc0',
    rug: '#c0395b',
    blanket: '#d94f70',
    stripe: '#ffd166',
    bed: '#8a5a3c',
  },
};
/** 밤 방 그늘 (스탠드 불빛만 밝다) */
const NIGHT = '#1e2150';
const SKY = '#2d3b78';

/** 벽지 무늬: 나무집 세로 줄, 버섯집 물방울, 눈집 얼음 벽돌, 성 돌 벽돌 */
function wallPattern(
  c: RoomInk,
  b: { x: number; y: number; w: number; h: number },
  style: HouseStyle,
): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  let d = '';
  if (style === 'wood') {
    for (let x = b.x + 5; x < b.x + b.w; x += 7) d += `M${n(x)} ${n(b.y)}v${n(b.h)}`;
    return `<path d="${d}" stroke="${c.pattern}" stroke-width="2.2"/>`;
  }
  if (style === 'mushroom') {
    let dots = '';
    let row = 0;
    for (let y = b.y + 5; y < b.y + b.h - 6; y += 8, row++)
      for (let x = b.x + (row % 2 ? 8 : 4); x < b.x + b.w; x += 8)
        dots += `<circle cx="${n(x)}" cy="${n(y)}" r="1.4"/>`;
    return `<g fill="${c.pattern}">${dots}</g>`;
  }
  let row = 0;
  const step = style === 'igloo' ? 9 : 8;
  for (let y = b.y + b.h - 6; y > b.y; y -= step, row++) {
    d += `M${n(b.x)} ${n(y)}h${n(b.w)}`;
    for (let x = b.x + (row % 2 ? 6 : 12); x < b.x + b.w; x += 12) d += `M${n(x)} ${n(y)}v${-step}`;
  }
  return `<path d="${d}" stroke="${c.pattern}" stroke-width="1.2"/>`;
}

/**
 * 방 그림: 벽지, 바닥, (넓으면) 밤하늘 창, 밤 그늘, 스탠드 불빛, 침대, 베개 위 자는 얼굴(펫 화면이 그린 그림,
 * image.slp 의 href 는 메인이 넣는다), 이불, 벽 단면 테두리. 숨쉬기는 body.b 일 때 이불이 부풀고 얼굴이 살짝 오른다
 */
function roomSvg(id: string, room: RoomShape, sc: RoomScene, style: HouseStyle, line: string): string {
  const c = ROOM[style];
  const n = (v: number) => Math.round(v * 10) / 10;
  const d = roomPath(room);
  const all =
    room.kind === 'dome'
      ? { x: room.cx - room.rx, y: room.floor - room.ry, w: room.rx * 2, h: room.ry }
      : { x: room.x, y: room.y, w: room.w, h: room.h };
  const { bed, head, blanket: bk, lamp } = sc;
  const f = bed.floor;
  const out: string[] = [];
  out.push(
    `<rect x="${n(all.x)}" y="${n(all.y)}" width="${n(all.w)}" height="${n(all.h)}" fill="${c.wall}"/>`,
  );
  out.push(wallPattern(c, all, style));
  // 바닥 (나무집은 널빤지 이음)
  out.push(`<rect x="${n(all.x)}" y="${n(f - 5)}" width="${n(all.w)}" height="5" fill="${c.floor}"/>`);
  out.push(
    `<path d="M${n(all.x)} ${n(f - 5)}h${n(all.w)}" stroke="${line}" stroke-width="1" stroke-opacity=".5"/>`,
  );
  if (c.rug)
    out.push(
      `<ellipse cx="${n(bed.x + bed.w / 2)}" cy="${n(f - 2.5)}" rx="${n(bed.w * 0.62)}" ry="2.6" fill="${c.rug}" opacity=".9"/>`,
    );
  if (sc.window) {
    const w = sc.window;
    out.push(
      `<rect x="${n(w.x)}" y="${n(w.y)}" width="${w.w}" height="${w.h}" rx="1.5" fill="${SKY}"/>` +
        `<circle cx="${n(w.x + w.w * 0.68)}" cy="${n(w.y + w.h * 0.36)}" r="2.6" fill="#ffe9a8"/>` +
        `<circle cx="${n(w.x + w.w * 0.78)}" cy="${n(w.y + w.h * 0.28)}" r="2.2" fill="${SKY}"/>` +
        `<circle cx="${n(w.x + w.w * 0.24)}" cy="${n(w.y + w.h * 0.3)}" r=".7" fill="#fff"/>` +
        `<circle cx="${n(w.x + w.w * 0.36)}" cy="${n(w.y + w.h * 0.72)}" r=".55" fill="#fff"/>` +
        `<path d="M${n(w.x + w.w / 2)} ${n(w.y)}v${w.h}M${n(w.x)} ${n(w.y + w.h / 2)}h${w.w}" stroke="${line}" stroke-width="1"/>` +
        `<rect x="${n(w.x)}" y="${n(w.y)}" width="${w.w}" height="${w.h}" rx="1.5" fill="none" stroke="${line}" stroke-width="1.4"/>`,
    );
  }
  // 밤: 방을 어둡게 하고 스탠드 둘레만 밝힌다
  out.push(
    `<rect x="${n(all.x)}" y="${n(all.y)}" width="${n(all.w)}" height="${n(all.h)}" fill="${NIGHT}" opacity=".2"/>`,
  );
  out.push(
    `<circle cx="${n(lamp.x)}" cy="${n(lamp.y)}" r="17" fill="${LIT}" opacity=".28"/><circle cx="${n(lamp.x)}" cy="${n(lamp.y)}" r="9" fill="${LIT}" opacity=".4"/>`,
  );
  if (lamp.table !== undefined) {
    const tx = lamp.table;
    out.push(
      `<path d="M${n(tx + 1.5)} ${n(f)}V${n(f - 12)}M${n(tx + 7.5)} ${n(f)}V${n(f - 12)}" stroke="${c.bed}" stroke-width="1.6"/>` +
        `<rect x="${n(tx)}" y="${n(f - 14)}" width="9" height="3" rx="1" fill="${c.bed}" stroke="${line}" stroke-width="1"/>` +
        `<path d="M${n(lamp.x)} ${n(f - 14)}v-4" stroke="${line}" stroke-width="1.2"/>` +
        `<path d="M${n(lamp.x - 3.5)} ${n(lamp.y + 3)}l1.6 -6h3.8l1.6 6Z" fill="${LIT}" stroke="${line}" stroke-width="1" stroke-linejoin="round"/>`,
    );
  } else {
    // 벽 등: 머리판 위 벽에 붙은 작은 등
    out.push(
      `<path d="M${n(lamp.x - 2)} ${n(lamp.y - 4)}h3v3" fill="none" stroke="${line}" stroke-width="1.1"/>` +
        `<path d="M${n(lamp.x - 2.6)} ${n(lamp.y + 2)}l1 -4h3.2l1 4Z" fill="${LIT}" stroke="${line}" stroke-width="1" stroke-linejoin="round"/>`,
    );
  }
  // 침대: 머리판, 발판, 매트리스
  const r = (v: number) => Math.min(3, v);
  out.push(
    `<rect x="${n(bed.x)}" y="${n(sc.headboard)}" width="4.5" height="${n(f - sc.headboard)}" rx="${r(2.2)}" fill="${c.bed}" stroke="${line}" stroke-width="1.3"/>` +
      `<rect x="${n(bed.x + bed.w - 4.5)}" y="${n(sc.footboard)}" width="4.5" height="${n(f - sc.footboard)}" rx="${r(2.2)}" fill="${c.bed}" stroke="${line}" stroke-width="1.3"/>` +
      `<rect x="${n(bed.x + 3)}" y="${n(bed.top)}" width="${n(bed.w - 6)}" height="5" rx="2" fill="#fffaf2" stroke="${line}" stroke-width="1.1"/>`,
  );
  // 베개와 얼굴 (얼굴은 숨쉬기에 살짝 오른다)
  out.push(
    `<ellipse cx="${n(head.x + head.size / 2)}" cy="${n(bed.top - 0.5)}" rx="${n(head.size * 0.56)}" ry="${n(Math.max(2.5, head.size * 0.17))}" fill="#fff" stroke="${line}" stroke-width="1.1"/>`,
  );
  out.push(
    `<image class="slp" x="${n(head.x)}" y="${n(head.y)}" width="${n(head.size)}" height="${n(head.size)}"/>`,
  );
  // 이불: 턱 밑에서 볼록하게 발판까지. 접은 홑청 띠와 줄무늬
  const x0 = bk.x0;
  const x1 = bk.x1;
  const base = bed.top + 5;
  const hump = `M${n(x0)} ${n(base)}V${n(bed.top + 1)}C${n(x0)} ${n(bk.top)} ${n(x0 + (x1 - x0) * 0.45)} ${n(bk.top - 1)} ${n(x0 + (x1 - x0) * 0.62)} ${n(bk.top + 1)}S${n(x1)} ${n(bed.top - 1)} ${n(x1)} ${n(bed.top + 1)}V${n(base)}Z`;
  out.push(
    `<g class="blk"><path d="${hump}" fill="${c.blanket}" stroke="${line}" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M${n(x0 + (x1 - x0) * 0.5)} ${n(bk.top + 1)}V${n(base)}M${n(x0 + (x1 - x0) * 0.75)} ${n(bk.top + 3)}V${n(base)}" stroke="${c.stripe}" stroke-width="2.2" opacity=".75"/>` +
      `<path d="M${n(x0 + 0.8)} ${n(base)}V${n(bed.top + 1)}C${n(x0 + 0.8)} ${n(bk.top + 2)} ${n(x0 + 3)} ${n(bk.top + 1)} ${n(x0 + 4.5)} ${n(bk.top + 1.5)}V${n(base)}Z" fill="#fffaf2"/></g>`,
  );
  // 침대 옆판과 다리 (이불 아래 끝을 덮는다)
  out.push(
    `<rect x="${n(bed.x + 2)}" y="${n(base - 1)}" width="${n(bed.w - 4)}" height="${n(Math.max(3, f - base - 2))}" rx="1.5" fill="${c.bed}" stroke="${line}" stroke-width="1.2"/>`,
  );
  // 벽 단면: 걷어 낸 벽 두께 띠와 테두리
  return (
    `<g class="room"><clipPath id="${id}"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#${id})">${out.join('')}<path d="${d}" fill="none" stroke="${c.wall}" stroke-width="5"/></g>` +
    `<path d="${d}" fill="none" stroke="${line}" stroke-width="2.5" stroke-linejoin="round"/></g>`
  );
}

const cache = new Map<string, HouseLayout>();

/** 모양과 단계의 그림과 자리. 이상한 값은 기본 모양, 끝 단계로 */
export function houseLayout(style: HouseStyle, level: number): HouseLayout {
  const s = isHouseStyle(style) ? style : 'wood';
  const lv = Math.min(Math.max(Math.round(level) || 1, 1), HOUSE_LEVELS);
  const key = `${s}:${lv}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const a = new Art(INK[s], `${s}-${lv}`);
  DRAW[s](a, lv);
  const out = a.layout(s);
  cache.set(key, out);
  return out;
}

/**
 * 집 SVG. still 이면 쉬는 중 불빛, 집 안, Zzz, 편지 없이 (상점 미리 보기).
 * 집 창에서는 body 의 class(home, mail, z1~z3, b, open, wk-at, wk-in)로 보이고 숨긴다 (play.ts HOUSE_CSS)
 */
export function houseSvg(style: HouseStyle, level: number, opts: { still?: boolean } = {}): string {
  const l = houseLayout(style, level);
  const body = opts.still ? l.body.replace(/<[^>]*class="rest"[^>]*\/>/g, '') : l.body;
  const { x, y, k, rise = 1 } = l.zzz;
  const n = (v: number) => Math.round(v * 10) / 10;
  const zzz = opts.still
    ? ''
    : `<g class="rest zzz" fill="#7d8fd0" stroke="#fff" stroke-width="2.2" paint-order="stroke" font-family="sans-serif" font-weight="800"><text x="${n(x)}" y="${n(y)}" font-size="${n(10 * k)}">z</text><text x="${n(x + 7 * k)}" y="${n(y - 9 * k * rise)}" font-size="${n(12.5 * k)}">z</text><text x="${n(x + 13 * k)}" y="${n(y - 19 * k * rise)}" font-size="${n(15 * k)}">Z</text></g>`;
  const mail = opts.still
    ? ''
    : `<g transform="translate(${l.letter.x - 4} ${l.letter.y - 10})"><g class="letter"><rect x="4" y="10" width="24" height="17" rx="3" fill="#fff" stroke="#e87a90" stroke-width="2.2"/><path d="M5 12l11 8 11-8" fill="none" stroke="#e87a90" stroke-width="2.2" stroke-linejoin="round"/><circle cx="27" cy="10" r="4.5" fill="#ef476f"/></g></g>`;
  const room = opts.still ? '' : l.roomSvg;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART} ${ART}">${l.back}<g class="hb">${body}</g>${room}${zzz}${mail}</svg>`;
}

/** 그림 칸 점 (x, y) 이 잡는 자리 안인지. pad 만큼 너그럽게 */
export function hitsAt(hits: readonly HitShape[], x: number, y: number, pad = 3): boolean {
  return hits.some((h) => {
    if ('rect' in h) {
      const [rx, ry, w, hh] = h.rect as [number, number, number, number];
      return x >= rx - pad && x <= rx + w + pad && y >= ry - pad && y <= ry + hh + pad;
    }
    if ('ell' in h) {
      const [cx, cy, ex, ey] = h.ell as [number, number, number, number];
      return ((x - cx) / (ex + pad)) ** 2 + ((y - cy) / (ey + pad)) ** 2 <= 1;
    }
    return inPoly(h.poly, x, y) || nearPoly(h.poly, x, y, pad);
  });
}

function inPoly(p: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2] ?? 0;
    const yi = p[i * 2 + 1] ?? 0;
    const xj = p[j * 2] ?? 0;
    const yj = p[j * 2 + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearPoly(p: readonly number[], x: number, y: number, pad: number): boolean {
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = p[j * 2] ?? 0;
    const ay = p[j * 2 + 1] ?? 0;
    const bx = p[i * 2] ?? 0;
    const by = p[i * 2 + 1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - (ax + dx * k), y - (ay + dy * k)) <= pad) return true;
  }
  return false;
}
