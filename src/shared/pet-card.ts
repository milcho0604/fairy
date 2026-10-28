// 친구 2부(이슈 #141): 서버에 올리는 "펫 카드". 앱과 서버가 함께 쓰는 순수 규칙이라 아무것도 가져오지 않는다
// (server/scripts/sync-shared.mjs 가 서버로 복사한다. settings.ts 는 i18n 을 끌어와 가져오지 않고 목록을 복사해 두며,
// 같은 목록인지는 pet-card.test.ts 가 묶는다).
// 서버가 가져가는 파일끼리는 서로 가져오지 않는다 (앱은 .ts 확장자를, 서버는 확장자 없이 가져온다). 이름 검사는 account-profile.ts 의
// checkNickname 을 부르는 쪽이 넘긴다.
// 카드에는 앱에 든 기본 펫의 종류 id, 네 발로 서기 여부, 이름만 담는다. 사진, 직접 만든 그림, 펫 파일은 싣지 않는다.

/** 코드로 그리는 기본 펫 (settings.ts PET_KIND_IDS 와 같다) */
export const CARD_KINDS = ['kong', 'cat', 'chick', 'dog', 'bunny', 'hamster', 'penguin', 'bear'] as const;
/** 앱에 그림으로 든 기본 캐릭터 (starter-pets.ts STARTER_IDS 와 같다) */
export const CARD_STARTERS = ['milk', 'choco'] as const;

/** 카드의 종류: kind:<기본 펫> 또는 starter:<밀크, 초코> */
export type CardSpecies = `kind:${(typeof CARD_KINDS)[number]}` | `starter:${(typeof CARD_STARTERS)[number]}`;

export const CARD_SPECIES: readonly CardSpecies[] = [
  ...CARD_KINDS.map((k) => `kind:${k}` as const),
  ...CARD_STARTERS.map((s) => `starter:${s}` as const),
];

export const isCardSpecies = (v: unknown): v is CardSpecies =>
  typeof v === 'string' && (CARD_SPECIES as readonly string[]).includes(v);

export interface PetCard {
  species: CardSpecies;
  /** 닉네임 규칙(2~12자)에 맞는 이름. 없으면 null */
  name: string | null;
  /** 네 발로 선 피규어로 본다 */
  stand: boolean;
}

/** 이름 검사 (account-profile.ts checkNickname 모양) */
export type NameCheck = (raw: unknown) => { ok: true; value: string } | { ok: false };

/** 올리는 몸 검사. 허용 칸은 species, name, stand 뿐이다 (그 밖의 칸, 모르는 종류, 규칙에 안 맞는 이름은 undefined) */
export function parseCard(body: unknown, checkName: NameCheck): PetCard | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== 'species' && k !== 'name' && k !== 'stand') return undefined;
  if (!isCardSpecies(b.species)) return undefined;
  if (b.stand !== undefined && typeof b.stand !== 'boolean') return undefined;
  let name: string | null = null;
  if (b.name !== undefined && b.name !== null) {
    const c = checkName(b.name);
    if (!c.ok) return undefined;
    name = c.value;
  }
  return { species: b.species, name, stand: b.stand === true };
}
