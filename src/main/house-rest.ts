import { screen } from 'electron';
import type { BubbleKind } from '../shared/chatter.ts';
import {
  doorPoint,
  nextRest,
  type RestEvent,
  type RestPhase,
  restBackKey,
  restBlock,
  restWake,
} from '../shared/house-rest.ts';
import { t } from '../shared/i18n/index.ts';
import type { PetWindow } from './pet-window.ts';
import type { House } from './play.ts';

export interface HouseRestOptions {
  pet: PetWindow;
  house: House;
  petName: () => string;
  /** 공놀이, 산책, 숨바꼭질 중 */
  playing: () => boolean;
  log?: (tag: string, ...rest: unknown[]) => void;
}

export type HouseRest = ReturnType<typeof createHouseRest>;

/**
 * 집에서 쉬기. 집 우클릭 "{이름} 집에서 쉬게 하기" 로 펫이 집 앞까지 걸어가(바닥이 아니면 깡충) 문으로 쏙 들어간다.
 * 안에 있는 동안 집에 불이 켜지고 Zzz 가 오른다. 집을 누르거나, 우클릭 "밖으로 부르기", 메뉴 막대 보이기,
 * 숨기기 단축키, 밥 주기, 놀기로 부르면 문에서 커지며 나온다. 일정 알림이 오면 스스로 나와서 알린다.
 * 상태는 저장하지 않는다: 다시 켜면 펫은 문간에 서 있다.
 */
export function createHouseRest({ pet, house, petName, playing, log }: HouseRestOptions) {
  let phase: RestPhase = 'out';
  let since = 0;
  /** 들어가기 차례 번호. 가는 중에 부르고 바로 다시 보내면 앞 차례가 늦게 깨어나 뒤 차례를 가로채지 않게 */
  let run = 0;

  function move(event: RestEvent): boolean {
    const next = nextRest(phase, event);
    if (!next) return false;
    log?.('rest', phase, event, next);
    phase = next;
    // 나오기 시작하면 불을 끄고 Zzz 와 편지를 거둔다 (깨어났다)
    house.setResting(next === 'inside');
    return true;
  }

  const block = () =>
    restBlock({
      hasHouse: !!house.bounds(),
      hidden: pet.isHidden('user') || pet.isHidden('presentation'),
      playing: playing(),
      phase,
    });

  /** 집 앞까지 가서 들어간다. 들어갔으면 true */
  async function start(): Promise<boolean> {
    if (block() || !move('go')) return false;
    const mine = ++run;
    const live = () => phase === 'going' && run === mine;
    // 걷는 동안 말풍선이 뜨면 걷기가 끊겨서, 말을 먼저 하고 닫힌 뒤 걷는다 (산책 시작과 같다)
    await pet.say({ kind: 'answer', text: t('pet.home.goIn'), ttlMs: 1800 });
    if (!live()) return false;
    const ok = await walkToDoor(live);
    if (!live()) return false;
    const hb = house.bounds();
    if (!ok || !hb) {
      move('cancel');
      return false;
    }
    const entered = await pet.enterDoor(doorPoint(hb, house.doorArt()));
    // 들어가는 0.5초 사이에 부르면 들어갔다 바로 나온다
    if (!live()) {
      if (entered) await comeOut(false);
      return false;
    }
    if (!entered) {
      move('cancel');
      return false;
    }
    move('enter');
    since = Date.now();
    return true;
  }

  /** 집 앞(문간)으로. 같은 모니터 바닥이면 걸어가고, 아니면(창 위, 다른 모니터) 깡충 뛰어간다 */
  async function walkToDoor(live: () => boolean): Promise<boolean> {
    const hb = house.bounds();
    const p = pet.bounds();
    const door = house.door(p.width);
    if (!hb || !door) return false;
    const area = screen.getDisplayMatching(hb).workArea;
    const floor = area.y + area.height - p.height;
    const onFloor =
      screen.getDisplayMatching(p).id === screen.getDisplayMatching(hb).id && Math.abs(p.y - floor) <= 8;
    const x = door.x - p.width / 2;
    if (onFloor) {
      if (await pet.walkTo(x, 170)) return true;
      // 졸리거나 배고프면 화면이 걷기를 마다해 바로 끊긴다. 끌리거나 말풍선이 떠서 끊긴 게 아니면 깡충 뛰어간다
      if (!live() || !pet.isIdle()) return false;
    }
    return pet.jumpTo(x, floor);
  }

  /** 집에서 나온다. greet 이면 쉰 시간에 맞는 한마디 */
  async function comeOut(greet: boolean): Promise<void> {
    const hb = house.bounds();
    const p = pet.bounds();
    const door = hb
      ? doorPoint(hb, house.doorArt())
      : { x: Math.round(p.x + p.width / 2), y: p.y + p.height };
    const stand = house.door(p.width);
    const at = hb && stand ? { x: stand.x - p.width / 2, y: hb.y + hb.height - p.height } : p;
    await pet.leaveDoor(door, at);
    move('exit');
    if (greet) void pet.say({ kind: 'answer', text: t(restBackKey(Date.now() - since)), ttlMs: 3500 });
  }

  /**
   * 부른다. 안에 있으면 나오고(greet 이면 한마디), 가는 중이면 그 자리에서 그만둔다.
   * 나왔으면(또는 원래 밖이면) true
   */
  async function call(greet = true): Promise<boolean> {
    if (phase === 'going') {
      // 그 자리에 선다 (제자리 걷기는 걷던 것을 멈추기만 한다)
      run++;
      void pet.walkTo(pet.bounds().x);
      return move('call');
    }
    if (phase === 'leaving') return false;
    if (phase !== 'inside' || !move('call')) return phase === 'out';
    await comeOut(greet);
    return true;
  }

  return {
    start,
    call,
    phase: () => phase,
    /** 집 안 (나오는 중 포함). 숨긴 것처럼 보이지 않는다 */
    inside: () => phase === 'inside' || phase === 'leaving',
    /** 쉬는 중에 말이 왔다 (pet-window onRestHeld) */
    held(kind: BubbleKind, important: boolean) {
      const what = restWake(kind, important);
      if (what === 'come-out') void call(false);
      else if (what === 'mail' && phase === 'inside') house.setMail(true);
    },
    /** 집이 없어졌다 (단계 0). 안에 있었으면 그 자리에 나온다 */
    houseGone() {
      if (phase === 'inside') void call(false);
      else if (phase === 'going') {
        run++;
        move('cancel');
      }
    },
    /** 집 우클릭 맨 위 항목 */
    menuItem(): Electron.MenuItemConstructorOptions {
      const name = petName();
      if (phase === 'inside') return { label: t('pet.house.callOut', { name }), click: () => void call() };
      if (phase === 'going') return { label: t('pet.house.going'), enabled: false };
      if (phase === 'leaving') return { label: t('pet.house.leaving'), enabled: false };
      const why = block();
      if (why === 'playing') return { label: t('pet.house.restPlaying'), enabled: false };
      return { label: t('pet.house.rest', { name }), enabled: !why, click: () => void start() };
    },
  };
}
