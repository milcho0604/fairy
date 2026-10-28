// 친구 2부(이슈 #141): 내 펫에서 서버에 올릴 "펫 카드"를 만들고, 받은 카드를 이 컴퓨터에서 그릴 모습으로 바꾼다.
// 카드에는 앱에 든 기본 펫(코드로 그리는 8종, 밀크와 초코)의 종류와 이름만 싣는다. 사용자가 직접 가져온 그림, 사진,
// AI 로 만든 그림, 펫 파일은 싣지 않는다: 그런 펫은 기본 펫 모양의 대역으로 가고 이름만 따라간다.
import { checkNickname } from './account-profile.ts';
import { CARD_KINDS, type CardSpecies, type PetCard } from './pet-card.ts';
import { isPetKind, type PetKind, pickedStand, type Settings } from './settings.ts';
import { isStarterId, type StarterId, starterOf } from './starter-pets.ts';

type CardFacts = Pick<Settings, 'petName' | 'petKind' | 'petImage' | 'petModel' | 'petStands' | 'petSprites'>;

/** 이 펫은 앱에 든 그림이 아니다 (직접 가져온 그림, 사진, 만든 그림, 펫 파일): 친구 화면에는 대역으로 간다 */
export const isCustomPet = (s: Pick<Settings, 'petImage' | 'petSprites'>): boolean =>
  (!!s.petImage && !starterOf(s.petImage)) || (!s.petImage && !!s.petSprites);

/** 서버에 올릴 내 펫 카드 */
export function cardOf(s: CardFacts): PetCard {
  const name = checkNickname(s.petName);
  const starter = isCustomPet(s) ? undefined : starterOf(s.petImage);
  const kind: PetKind = isPetKind(s.petKind) ? s.petKind : 'kong';
  const species: CardSpecies = starter ? `starter:${starter}` : `kind:${kind}`;
  return {
    species,
    name: name.ok ? name.value : null,
    stand: starter ? pickedStand(s) : false,
  };
}

/** 받은 카드를 그릴 모습. 모르는 종류(받는 앱이 더 낡았다)는 대역: 기본 펫 콩이 */
export interface VisitorLook {
  kind: PetKind;
  starter?: StarterId;
  /** 이 앱이 아는 종류다 (false 면 대역) */
  known: boolean;
}

export const STAND_IN: PetKind = 'kong';

export function lookOf(species: string): VisitorLook {
  const [group, id] = species.split(':');
  if (group === 'kind' && (CARD_KINDS as readonly string[]).includes(id ?? '') && isPetKind(id))
    return { kind: id, known: true };
  // 밀크는 고양이, 초코는 푸들이라 걷는 모양의 기본 몸을 맞춰 둔다 (그림이 있으니 몸 모양은 걸음새에만 쓰인다)
  if (group === 'starter' && isStarterId(id))
    return { kind: id === 'milk' ? 'cat' : 'dog', starter: id, known: true };
  return { kind: STAND_IN, known: false };
}
