// 친구 페어리를 기본 페어리로 (사용자 요청 2026-10-12). 고른 친구가 기본 페어리가 되고, 지금 기본 페어리는 그 친구 자리로 간다.
// 서로 바꾸기라 몇 번을 해도 잃는 것이 없다: 이름, 모습(모양, 사진, 입체 설계도, 깊이 그림, 나이, 포즈, 이름표, 2D 그림 세트), 걸음새가 같이 간다.
// 친구 자리(id, 순서)는 그대로 둔다: 친구 창이 제자리에서 모습만 바뀌고, 설정 창 친구 줄도 흔들리지 않는다 (#23 카드 뒤섞임처럼).
// 네 발로 서기(petStands)는 몸 열쇠(설계도 파일, starter:<이름>)로 적혀 있어 따로 옮기지 않아도 몸을 따라간다.
// 삐짐, 친밀도, 기억(petMemory)은 모습이 아니라 사용자와 기본 페어리 사이의 것이라 기본 자리에 남는다.
import { bodyKey, type Friend, type Settings, type SettingsPatch } from './settings.ts';

/** 기본 페어리로 바꾸는 설정 조각. 그런 친구가 없으면 undefined */
export function friendSwap(s: Settings, id: string): SettingsPatch | undefined {
  const at = s.friends.findIndex((f) => f.id === id);
  const f = s.friends[at];
  if (!f) return undefined;
  // 지금 기본 페어리의 걸음새 (몸마다 따로 적힌 값). 다리 없는 사진 몸이면 없다
  const mainKey = bodyKey(s);
  const mainGait = mainKey ? s.petGaits[mainKey] : undefined;
  const photo = s.petImage;
  const poses = Object.fromEntries(Object.entries(s.petPoses).filter(([, v]) => !!v));
  const back: Friend = {
    id: f.id,
    name: s.petName,
    kind: s.petKind,
    ...(photo ? { image: photo } : {}),
    ...(photo && s.petModel ? { model: s.petModel } : {}),
    ...(photo && s.petDepth ? { depth: s.petDepth } : {}),
    ...(mainGait ? { gait: mainGait } : {}),
    ...(photo && s.petAge ? { age: s.petAge } : {}),
    ...(photo && Object.keys(poses).length > 0 ? { poses } : {}),
    ...(photo && s.petMeta ? { meta: s.petMeta } : {}),
    ...(photo && s.petSprites ? { sprites: s.petSprites } : {}),
  };
  // 친구의 걸음새는 새 몸 열쇠로. 자동(없음)이면 그 몸에 남은 옛 값을 지운다
  const nextKey = bodyKey({ petImage: f.image, petModel: f.model, petKind: f.kind });
  let petGaits = s.petGaits;
  if (nextKey) {
    const { [nextKey]: _, ...rest } = petGaits;
    petGaits = f.gait ? { ...rest, [nextKey]: f.gait } : rest;
  }
  return {
    friends: s.friends.map((x, i) => (i === at ? back : x)),
    // 친구 이름은 사용자가 지은 이름이다 (모습을 바꿔도 따라가지 않게)
    petName: f.name,
    petNameEdited: true,
    petKind: f.kind,
    petImage: f.image ?? null,
    petModel: f.model ?? null,
    petDepth: f.depth ?? null,
    petAge: f.age ?? null,
    petMeta: f.meta ?? null,
    petSprites: f.sprites ?? null,
    petPoses: {
      happy: f.poses?.happy ?? null,
      sleepy: f.poses?.sleepy ?? null,
      hungry: f.poses?.hungry ?? null,
    },
    petGaits,
  };
}
