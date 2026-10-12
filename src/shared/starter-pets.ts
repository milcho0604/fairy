// 그림으로 들어 있는 기본 캐릭터 (2026-10-10 사용자 요청): 밀크(긴 털 흰 고양이), 초코(곱슬 털 갈색 푸들).
// 앱의 AI 일러스트로 그리고 앱과 같은 배경 지우기(IS-Net, 가장자리 바탕색 빼기)로 오린 PNG 를 resources/pets/ 에 넣었다.
// 고르면 그림을 사용자 데이터 pets/ 에 복사해 지금 사진 펫으로 둔다. 그 뒤로는 사진 펫과 똑같다
// (포즈 없음, 얼굴 아이콘, 입체 피규어도 나중에 만들 수 있다). 코드로 그리는 기본 펫(PetKind)과는 따로다
import { dicts, t } from './i18n/index.ts';
import { isPetKind, type PetKind } from './settings.ts';

export const STARTER_IDS = ['milk', 'choco'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export const isStarterId = (v: unknown): v is StarterId => STARTER_IDS.includes(v as StarterId);

/** 이름과 화면 읽기 설명은 지금 말로 읽는다 (getter, PET_KINDS 처럼) */
export const STARTER_PETS: readonly { id: StarterId; readonly name: string; readonly desc: string }[] =
  STARTER_IDS.map((id) => ({
    id,
    get name() {
      return t(`common.starter.${id}`);
    },
    get desc() {
      return t(`common.starter.${id}.desc`);
    },
  }));

/**
 * 고른 그대로의 이름인지: 어느 말의 이름이든 (한국어로 고른 "초코" 는 영어로 바꿔도 손대지 않은 초코다.
 * 지금 말 이름하고만 견주면 말을 바꾼 뒤 보관함에 초코가 하나 더 생겼다)
 */
export function isStarterName(id: StarterId, name: string): boolean {
  const key = `common.starter.${id}` as const;
  return Object.values(dicts).some((d) => d[key] === name);
}

/** 앱에 든 그림 파일 이름 (resources/pets/ 안) */
export const starterResource = (id: StarterId): string => `${id}.png`;

/** 상한. 지금 그림은 300KB 안팎이다 (사진 펫 PNG 상한 4MB 보다 훨씬 작게) */
export const STARTER_MAX_BYTES = 2 * 1024 * 1024;

/** pets/ 에 복사할 파일 이름. 설정의 사진 펫 파일 이름 규칙(pet-*.png)을 따르고, 어느 캐릭터인지 이름에 남긴다 */
export const starterFileName = (id: StarterId, now: number): string =>
  `pet-${id}-${Math.max(0, Math.floor(now))}.png`;

const STARTER_FILE = /^pet-(milk|choco)-\d+\.png$/;

/** pets/ 파일이 어느 캐릭터의 복사본인지. 아니면 undefined (펫 만들기 그림은 pet-<숫자>) */
export function starterOf(file: string | null | undefined): StarterId | undefined {
  const m = typeof file === 'string' ? STARTER_FILE.exec(file) : null;
  return m && isStarterId(m[1]) ? m[1] : undefined;
}

/** 펫 고르기 요청 (설정 창, 첫 안내). 렌더러가 보낸 값을 믿지 않고 모양을 확인한다 */
export type PetChoice = { kind: PetKind } | { id: string } | { starter: StarterId };

/** 모르는 모양이면 undefined */
export function parsePetChoice(v: unknown): PetChoice | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const c = v as Record<string, unknown>;
  if (isPetKind(c.kind)) return { kind: c.kind };
  if (isStarterId(c.starter)) return { starter: c.starter };
  if (typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 64) return { id: c.id };
  return undefined;
}

/** 이미 그 캐릭터인지 (지금 펫 그림이 그 캐릭터의 복사본). 고르기 칸에 켜짐으로 보인다 */
export const isCurrentStarter = (petImage: string | null | undefined, id: StarterId): boolean =>
  starterOf(petImage) === id;

/** 사진 속 눈 하나: 가운데(x, y)와 가로, 세로 반지름. 그림 너비, 높이에 대한 비율 */
export interface PhotoEye {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** 사진 펫의 눈 자리와 감은 눈 선 색 (renderer photo-eyes.ts) */
export interface PhotoEyes {
  eyes: readonly PhotoEye[];
  ink: string;
  /** 눈꺼풀(덮개 털)에 섞을 빛과 정도. 어두운 털은 조금 밝게 해야 감은 눈이 뜬 눈과 구분된다 */
  lid?: { color: string; amount: number };
  /** 감은 눈 선 바로 아래 밝은 테두리 빛. 어두운 털에서 선이 묻히지 않게 */
  edge?: string;
}

/** 그림 픽셀 자리를 비율로 (그림 크기는 resources/pets/ 그림 그대로) */
const eyesAt = (
  w: number,
  h: number,
  more: Omit<PhotoEyes, 'eyes'>,
  ...px: [number, number, number, number][]
): PhotoEyes => ({
  ...more,
  eyes: px.map(([x, y, rx, ry]) => ({ x: x / w, y: y / h, rx: rx / w, ry: ry / h })),
});

/**
 * 밀크, 초코 그림의 눈 자리 (2026-10-12 사용자 보고: 초코가 자도 눈을 감지 않는다).
 * 사진은 얼굴을 다시 그릴 수 없어 잠, 졸음, 깜빡임에서 눈 위를 바로 위 털로 덮고 감은 눈 선을 긋는다.
 * 그림 안 어두운 눈동자 픽셀을 감싸 재고(밀크 303x512, 초코 340x512) 눈 테두리와 반사까지 덮게 넉넉히 잡았다
 */
export const STARTER_EYES: Record<StarterId, PhotoEyes> = {
  milk: eyesAt(303, 512, { ink: '#4a3a33' }, [105.5, 138, 19.8, 17.6], [178.5, 138, 19.8, 17.6]),
  // 초코는 눈도 털도 어두워 감은 눈이 뜬 눈과 비슷하게 보였다 (실제 펫 크기에서): 눈꺼풀을 밝게, 선은 더 어둡게, 선 아래 밝은 테두리
  choco: eyesAt(
    340,
    512,
    { ink: '#1a0b05', lid: { color: '#c48e66', amount: 0.55 }, edge: '#e8c09a' },
    [133, 129, 17.6, 16.5],
    [208, 128, 17.6, 16.5],
  ),
};
