import type { Blueprint, Gait } from '../../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../../shared/pet3d/defaults.ts';
import { canStand } from '../../../shared/pet3d/stand.ts';
import { type GaitPick, pickedGait, pickedStand, type Settings } from '../../../shared/settings.ts';
import { shapeOf } from '../pet3d-gait.ts';

/** 설정 창 걸음새 칸이 보여 줄 것 (GaitPicker). 펫 화면이 실제로 걷는 걸음새와 같게 맞춘다 */
export interface GaitView {
  /** 고를 수 있는 몸 모양. 없으면 고르기를 흐리게 둔다 (다리 없는 사진 펫, 네 발로 선 몸) */
  shape?: Gait;
  /** 네 발로 선 몸(밀크, 초코 피규어, 네 발로 서기를 켠 사진 펫): 고를 수 없고 늘 네 발로 걷는다 */
  stands: boolean;
  /** 이 몸에 저장된 걸음새. 자동이면 undefined */
  picked?: Gait;
  /** 켜져 보일 단추. 아무것도 아니면 undefined (다리 없는 사진 펫) */
  on?: GaitPick;
}

type GaitSettings = Pick<Settings, 'petImage' | 'petModel' | 'petKind' | 'petGaits' | 'petStands' | 'pet3d'>;

/**
 * 걸음새 칸의 상태. figure 는 지금 펫의 입체 설계도 (사진 펫이 피규어로 보일 때만, 밀크와 초코는 피규어를 켰을 때만).
 * 네 발로 선 몸은 고른 값을 펫 화면이 쓰지 않고 늘 네 발로 걸으니 (pet.ts pickedBlueprint) 흐린 채 "네 발"을 켜 둔다.
 * 예전에는 아무 단추도 켜지 않아 "네 발"을 눌러도 안 골라지는 것처럼 보였다 (#28)
 */
export function gaitView(s: GaitSettings, figure: Blueprint | undefined): GaitView {
  const stands = !!figure && s.pet3d && (!!figure.stance || (pickedStand(s) && canStand(figure)));
  // 몸 모양: 기본 펫은 기본 설계도, 사진 펫은 그 설계도 (고른 값을 덮기 전)
  const shape: Gait | undefined = !s.petImage
    ? shapeOf(DEFAULT_BLUEPRINTS[s.petKind])
    : figure && s.pet3d && !stands
      ? shapeOf(figure)
      : undefined;
  const picked = shape ? pickedGait(s) : undefined;
  const on: GaitPick | undefined = stands ? 'quadruped' : shape ? (picked ?? 'auto') : undefined;
  return { shape, stands, picked, on };
}
