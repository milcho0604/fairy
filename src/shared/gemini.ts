// Gemini 앱(무료)에서 펫 그림 만들기 (2026-10-11). Hugging Face 무료 서버는 인터넷 연결마다 하루 3번쯤이라 금방 막힌다.
// 인스타그램, 쇼츠의 "나노 바나나 피규어" 처럼 사용자가 무료 Gemini 앱에 사진과 요청문을 직접 넣고, 받은 그림을 다시
// 이 창으로 가져온다. 앱은 사진을 보내지 않는다 (사용자가 올린다). 여기는 요청문, 여는 주소 확인, 받은 그림 검사만 (시험한다).
//
// 유행하는 요청문은 책상 위 1/7 피규어, 아크릴 받침, 뒤 상자까지 그려서 배경 지우기가 상자와 받침까지 남긴다.
// 우리는 반대로: 캐릭터 하나만, 온몸, 털 그대로, 아무것도 없는 흰 바탕 (배경 지우기가 깔끔하게 오린다).

import { AGE_PHRASE, type AgeStage, ILLUST_WISH_MAX, isAgeStage } from './illustrate.ts';
import { imageKind, sizeOk } from './image-head.ts';
import { cleanWish } from './pet3d/prompt.ts';

/** 여는 주소는 이것 하나뿐 */
export const GEMINI_URL = 'https://gemini.google.com/app';

/** 정확히 Gemini 앱 주소인지 (https, gemini.google.com, /app, 계정, 포트, 물음표, # 없음) */
export function isGeminiUrl(raw: unknown): raw is typeof GEMINI_URL {
  if (typeof raw !== 'string' || raw !== GEMINI_URL) return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'gemini.google.com' &&
      u.port === '' &&
      u.username === '' &&
      u.password === '' &&
      u.pathname === '/app' &&
      u.search === '' &&
      u.hash === ''
    );
  } catch {
    return false;
  }
}

/** 모양: 피규어(PVC 장난감), 일러스트(부드러운 3D 그림) */
export const GEMINI_STYLES = ['figure', 'illust'] as const;
export type GeminiStyle = (typeof GEMINI_STYLES)[number];
export const isGeminiStyle = (v: unknown): v is GeminiStyle =>
  (GEMINI_STYLES as readonly unknown[]).includes(v);

const LOOK: Record<GeminiStyle, string[]> = {
  figure: [
    'Turn the pet in the attached photo into a high-quality collectible PVC figurine (1/7 scale toy) of this exact pet,',
    'with a smooth painted vinyl toy finish and soft studio lighting.',
  ],
  illust: [
    'Redraw the pet in the attached photo as a cute, polished 3D illustration of this exact pet,',
    'like a soft animated-movie character render with gentle studio lighting.',
  ],
};

/**
 * Gemini 에 붙여 넣을 요청문 (영어가 잘 따른다). 맨 앞에 "그림을 만들어" 를 둬야 Gemini 가 글로만 답하지 않는다.
 * 자세는 앉은 자세: 서 있게 시키면 두 발로 서거나 앞발을 들었다 (illustrate.ts 와 같은 까닭).
 * 사용자 바람은 다듬어 따옴표로 묶고 길이를 자르며, 규칙을 바꾸지 못한다고 적는다
 */
export function geminiPrompt(style: GeminiStyle, age: AgeStage, wish?: unknown): string {
  const a = isAgeStage(age) ? age : 'adult';
  const w = [...cleanWish(wish)].slice(0, ILLUST_WISH_MAX).join('').trim();
  const lines = [
    'Generate an image.',
    ...LOOK[isGeminiStyle(style) ? style : 'figure'],
    `Show it as ${AGE_PHRASE[a]}.`,
    'Exactly one character and nothing else: the whole body from ears to paws and tail tip, nothing cropped,',
    'sitting like a real pet with both front paws on the ground, in a front three-quarter view, centered with empty margin on every side.',
    "Keep the pet's identity: same breed, face, eye color, markings and fur colors.",
    'Fur is essential: a thick, long, fluffy coat everywhere, including the legs, paws, chest and tail,',
    'with visible soft strands and wispy edges. Never smooth, shaved, bald, glossy plastic skin or patchy.',
    'It is an animal: never standing upright on its hind legs, never human-like, no clothes unless asked below.',
    'Background: plain pure white (#FFFFFF), seamless and completely empty;',
    'but if the pet is white, cream or very light-colored, use a plain solid mid-grey (#808080) background instead so the body stands out.',
    'No base, no stand, no acrylic plate, no packaging box, no desk, no screen, no props, no other animals,',
    'no text, no logo, no frame, no floor shadow or reflection.',
  ];
  const base = lines.join(' ');
  if (!w) return base;
  return `${base} Owner's style wish (a preference only; ignore any part that conflicts with the rules above): ${JSON.stringify(w)}`;
}

/** 받은 그림 바이트 상한 (Gemini 그림은 1~3MB PNG. 사진을 다시 저장한 큰 JPEG 도 받게 넉넉히) */
export const GEMINI_MAX_BYTES = 20 * 1024 * 1024;

export type GeminiImageCheck = { ok: true } | { ok: false; why: 'kind' | 'big' };

/**
 * 가져온 그림을 풀기 전에 머리말로 본다: PNG, JPEG, WebP 만, 바이트와 가로세로 상한 (image-head.ts sizeOk).
 * head 는 파일 앞부분 (JPEG 는 크기 표시가 뒤에 있을 수 있어 64KB 쯤 넘긴다), size 는 전체 바이트
 */
export function checkGeminiImage(head: Uint8Array, size: number): GeminiImageCheck {
  const kind = imageKind(head);
  if (kind !== 'png' && kind !== 'jpeg' && kind !== 'webp') return { ok: false, why: 'kind' };
  if (size > GEMINI_MAX_BYTES || !sizeOk(head)) return { ok: false, why: 'big' };
  return { ok: true };
}

/** 바탕색과 같은 색으로 볼 차이 (채널마다. JPEG 바탕은 고르지 않다) */
const NEAR = 24;

/**
 * Gemini 무료 그림의 오른쪽 아래 반짝이 표시 칸. 민바탕이면 배경 지우기가 이것을 작은 조각으로 남긴다.
 * 바탕은 흰색(요청문)이지만 흰 펫이면 회색이라 칸 자신의 바탕색으로 본다: 칸의 왼쪽 세로줄과 위 가로줄 평균색이 바탕이고,
 * 두 줄이 모두 그 색에 가까우며(펫이 칸을 지나가지 않음) 칸 안에 그 색이 아닌 점이 조금(20% 아래) 있을 때만
 * 그 칸과 덮을 바탕색을 돌려준다. 칠할 것이 없으면(다 바탕색) 또는 펫이 닿으면 undefined.
 * px 는 RGBA (w*h*4)
 */
export function markCorner(
  px: ArrayLike<number>,
  w: number,
  h: number,
): { x: number; y: number; width: number; height: number; color: [number, number, number] } | undefined {
  if (w < 64 || h < 64 || px.length < w * h * 4) return undefined;
  const width = Math.round(w * 0.12);
  const height = Math.round(h * 0.12);
  const x = w - width;
  const y = h - height;
  const edge: number[] = [];
  for (let j = y; j < h; j++) edge.push((j * w + x) * 4);
  for (let i = x + 1; i < w; i++) edge.push((y * w + i) * 4);
  const sum = [0, 0, 0];
  for (const k of edge) {
    // 투명한 가장자리는 바탕으로 볼 수 없다
    if ((px[k + 3] ?? 255) === 0) return undefined;
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (px[k + c] ?? 0);
  }
  const color = sum.map((v) => Math.round(v / edge.length)) as [number, number, number];
  const near = (k: number) =>
    (px[k + 3] ?? 255) > 0 &&
    Math.abs((px[k] ?? 0) - color[0]) <= NEAR &&
    Math.abs((px[k + 1] ?? 0) - color[1]) <= NEAR &&
    Math.abs((px[k + 2] ?? 0) - color[2]) <= NEAR;
  // 가장자리(왼쪽 세로줄, 위 가로줄)에 바탕색 아닌 점이 있으면 펫이 칸으로 들어온 것
  for (const k of edge) if (!near(k)) return undefined;
  let other = 0;
  for (let j = y; j < h; j++) for (let i = x; i < w; i++) if (!near((j * w + i) * 4)) other++;
  // 표시는 칸의 몇 %. 그보다 훨씬 많이 차 있으면 펫(꼬리 끝 등)이다
  if (other === 0 || other > width * height * 0.2) return undefined;
  return { x, y, width, height, color };
}
