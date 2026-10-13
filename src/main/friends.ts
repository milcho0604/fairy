import { join } from 'node:path';
import { app, type BrowserWindow, screen } from 'electron';
import { friendTalk } from '../shared/companion.ts';
import { t } from '../shared/i18n/index.ts';
import { IPC, type PetImages, type PetStatus } from '../shared/ipc.ts';
import { MEET_CHANCE, MEET_COOLDOWN_MS, MEET_EVERY_MS, meetPlan } from '../shared/meet.ts';
import { voiced } from '../shared/persona-voice.ts';
import { type Blueprint, parseBlueprint } from '../shared/pet3d/blueprint.ts';
import { starterFigureOf } from '../shared/pet3d/starters.ts';
import { friendSpot } from '../shared/placement.ts';
import { HideReasons } from '../shared/presence.ts';
import { type Friend, pickedStand } from '../shared/settings.ts';
import { starterOf } from '../shared/starter-pets.ts';
import type { WearLook } from '../shared/wear.ts';
import { saverNow } from './battery.ts';
import { boostOn } from './boost.ts';
import { library } from './pet-library.ts';
import { createPetWindow, openPetWindowIn, type PetWindow } from './pet-window.ts';
import { readFileIn } from './safe-file.ts';
import { settings } from './settings.ts';
import { removeJson } from './store.ts';

/** 인사 (지금 말로, 고른 성격 말투로: 존댓말 비서면 존댓말, 이슈 #65) */
const hello = () => [
  voiced('pet.hello.1'),
  voiced('pet.hello.2'),
  voiced('pet.hello.3'),
  voiced('pet.hello.4'),
  voiced('pet.hello.5'),
];

/** pets/ 안 일반 파일만 읽는다 (링크를 따라 폴더 밖을 읽지 않게, safe-file.ts) */
const petFile = (file: string | undefined) => readFileIn(join(app.getPath('userData'), 'pets'), file);

/** 설계도 파일 상한 (maker.ts 와 같다). 넘으면 읽지 않고 사진으로 */
const MAX_MODEL_BYTES = 256 * 1024;

/** 처음 오는 친구 펫 크기 (pet-window 의 기본 크기, 배율 1) */
const FRIEND_SIZE = 160;

/** 만났을 때 수다를 떨 확률 (수다쟁이만) */
const FRIEND_TALK_CHANCE = 0.5;
/** 수다 말풍선 하나가 떠 있는 시간 */
const FRIEND_TALK_MS = 3200;
/** 마주 보기와 하트(2.6초)가 끝난 뒤에 말한다 (말풍선이 뜨면 하던 몸짓을 멈춘다) */
const AFTER_GREET_MS = 2700;

/** 친구의 입체 설계도. 없거나 깨졌거나 너무 크면 null (사진으로) */
function modelOf(file: string | undefined): Blueprint | null {
  const bytes = readFileIn(join(app.getPath('userData'), 'pets'), file, MAX_MODEL_BYTES);
  if (!bytes) return null;
  try {
    return parseBlueprint(JSON.parse(bytes.toString('utf8'))) ?? null;
  } catch {
    return null;
  }
}

/** 친구의 2.5D 깊이 그림 (data URL). 없으면 null */
function depthOf(file: string | undefined): string | null {
  const bytes = petFile(file);
  return bytes ? `data:image/png;base64,${bytes.toString('base64')}` : null;
}

function imageOf(f: Friend): PetImages {
  const none: PetImages = { main: null, model: null, depth: null, poses: {} };
  if (!f.image) return none;
  try {
    const ext = f.image.split('.').pop() ?? 'png';
    const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
    const bytes = petFile(f.image);
    if (!bytes) return none;
    const b64 = bytes.toString('base64');
    return {
      main: `data:${mime};base64,${b64}`,
      model: modelOf(f.model) ?? starterFigureOf(f.image, settings.get().petStands),
      depth: depthOf(f.depth),
      poses: {},
      ...(f.age ? { age: f.age } : {}),
      ...(starterOf(f.image) ? { starter: starterOf(f.image) } : {}),
    };
  } catch {
    return none;
  }
}

/**
 * 친구 펫 (v2 여러 마리): 설정의 친구마다 펫 창을 하나씩 띄운다. 돌아다니기, 창 위 앉기, 던지기, 쓰다듬기는 똑같고,
 * 할 일, 채팅, 패널은 기본 펫이 맡는다. 우클릭 메뉴는 짧게(쓰다듬기, 숨기기, 집에 보내기).
 */
export function createFriends(o: {
  mainPet: () => PetWindow;
  /** 지금 친구 놀이를 해도 되는지 (집중, 놀이, 숨바꼭질 중이 아니고 사용자가 자리에 있다) */
  canMeet: () => boolean;
  /** 친구도 같은 철 옷을 입는다 (main/wear.ts friendLook). 없으면 옷 없이 */
  wear?: () => WearLook;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const live = new Map<string, { pet: PetWindow; friend: Friend }>();
  /** 지금 친구들이 숨은 까닭 (숨긴 동안 새로 온 친구도 숨어서 온다) */
  const hiddenFor = new HideReasons();

  // ---- 친구 펫끼리 놀기 ----
  // 가끔 친구 하나가 기본 펫 옆으로 걸어가 서로 마주 보고 하트를 띄운다. 둘 다 한가할 때만.
  let lastMeet = 0;
  let meeting = false;
  async function meetTick(force = false) {
    const now = Date.now();
    if (meeting || live.size === 0) return;
    if (!force && (now - lastMeet < MEET_COOLDOWN_MS || Math.random() > MEET_CHANCE)) return;
    const main = o.mainPet();
    if (!o.canMeet() || !main.isIdle()) return;
    const idle = [...live.values()].filter((l) => l.pet.isIdle());
    const l = idle[Math.floor(Math.random() * idle.length)];
    if (!l) return;
    const a = main.bounds();
    const b = l.pet.bounds();
    const display = screen.getDisplayMatching(a);
    const same = display.id === screen.getDisplayMatching(b).id;
    const plan = meetPlan(a, b, same, display.workArea);
    if (!plan) return;
    meeting = true;
    lastMeet = now;
    o.log('friends', '만나러 감', l.friend.id);
    try {
      if (!(await l.pet.walkTo(plan.x))) return;
      // 걷는 사이 기본 펫이 움직였거나 바빠졌으면 그만
      if (!main.isIdle() || !l.pet.isIdle() || Math.abs(main.bounds().x - a.x) > 8) return;
      main.greet(plan.mainDir);
      l.pet.greet(plan.friendDir);
      chat(main, l, force);
    } finally {
      meeting = false;
    }
  }

  /**
   * 마주 보고 하트를 띄운 뒤 가끔 짧게 주고받는다 (수다쟁이만, 혼잣말과 같은 빈도 상한).
   * 기본 펫이 먼저 말하고, 그 말풍선이 저절로 닫히면 친구가 대답한다 (두 말풍선이 겹치지 않게)
   */
  let lastTalk: number | undefined;
  function chat(main: PetWindow, l: { pet: PetWindow; friend: Friend }, force = false) {
    if (settings.get().chatter !== 'chatty' || (!force && Math.random() > FRIEND_TALK_CHANCE)) return;
    const pair = friendTalk(Math.random, lastTalk);
    const vars = { name: settings.get().petName, friend: l.friend.name };
    setTimeout(() => {
      if (!live.has(l.friend.id) || !main.isIdle() || !l.pet.isIdle()) return;
      lastTalk = pair.index;
      o.log('friends', '수다', pair.index);
      void main.say({ kind: 'idle-talk', text: t(pair.a, vars), ttlMs: FRIEND_TALK_MS }).then((a) => {
        // 그사이 숨기거나(발표 포함) 조용히로 바꿨으면 대답하지 않는다 ('answer' 는 숨김 동안 붙잡아 뒀다가 엉뚱할 때 띄운다)
        if (a !== 'timeout' || !live.has(l.friend.id) || settings.get().chatter !== 'chatty') return;
        if (main.isHidden() || l.pet.isHidden()) return;
        void l.pet.say({ kind: 'answer', text: t(pair.b, vars), ttlMs: FRIEND_TALK_MS });
      });
    }, AFTER_GREET_MS).unref();
  }
  const meetTimer = setInterval(() => void meetTick(), MEET_EVERY_MS);
  meetTimer.unref();

  function status(f: Friend): PetStatus {
    return {
      hungry: false,
      focus: false,
      sulk: 0,
      kind: f.kind,
      pet3d: settings.get().pet3d,
      style: settings.get().petStyle,
      cushion: false,
      flower: false,
      sounds: false,
      boost: boostOn(),
      saver: saverNow(),
      ...(f.gait ? { gait: f.gait } : {}),
      // 네 발로 선 피규어 (기본 페어리였을 때 고른 값이 몸을 따라온다, friend-swap.ts)
      ...(pickedStand({
        petImage: f.image,
        petModel: f.model,
        petKind: f.kind,
        petStands: settings.get().petStands,
      })
        ? { stand: true }
        : {}),
      ...(o.wear ? { wear: o.wear() } : {}),
    };
  }

  /** 창을 여는 중인 친구 (기본 펫 화면에서 여는 데 잠깐 걸린다) */
  const opening = new Set<string>();

  /**
   * 친구 창을 기본 펫 화면 프로세스에서 연다 (openPetWindowIn: 친구 하나에 렌더러 하나가 늘지 않는다).
   * 못 열면 따로 만든다. 여는 사이 집에 보냈거나 이미 있으면 닫는다
   */
  function open(f: Friend, index: number) {
    if (opening.has(f.id)) return;
    opening.add(f.id);
    void openPetWindowIn(o.mainPet().win.webContents).then((win) => {
      opening.delete(f.id);
      const now = settings.get().friends.find((x) => x.id === f.id);
      if (!now || live.has(f.id)) {
        win?.destroy();
        return;
      }
      if (!win) o.log('friends', '따로 엶', f.id);
      build(now, index, win);
    });
  }

  function build(f: Friend, index: number, win: BrowserWindow | undefined) {
    const main = o.mainPet().bounds();
    const pet: PetWindow = createPetWindow({
      ...(win ? { win } : {}),
      id: f.id,
      // 기본 펫과 같은 바닥에, 왼쪽에 자리가 없으면 오른쪽에 (처음 올 때만. 옮긴 뒤에는 저장한 자리)
      initial: friendSpot(main, index, FRIEND_SIZE, screen.getDisplayMatching(main).workArea),
      petName: () => live.get(f.id)?.friend.name ?? f.name,
      log: o.log,
      actions: {
        click: () => {
          pet.react();
          const lines = hello();
          const line = lines[Math.floor(Math.random() * lines.length)] ?? lines[0];
          void pet.say({
            kind: 'answer',
            text: `${live.get(f.id)?.friend.name ?? f.name}: ${line}`,
            ttlMs: 3000,
          });
        },
        petted: () => pet.react(),
        // 친구는 대화, 같이 보기, 할 일을 맡지 않는다
        openChat: () => {},
        lookTogether: () => {},
        openSettings: () => {},
        quickAdd: () => {},
        feed: () => {},
        makePet: () => {},
        focusRunning: () => false,
        toggleFocus: () => {},
        play: () => {},
        toy: () => undefined,
        openShop: () => {},
      },
      menu: () => {
        const name = live.get(f.id)?.friend.name ?? f.name;
        return [
          {
            label: t('pet.friend.hide', { name }),
            click: () => pet.setHidden('user', true, false),
          },
          { label: t('pet.menu.reload'), click: () => pet.reload() },
          { type: 'separator' },
          // 잘못 눌러 보내지 않게 한 번 더 고른다 (하위 메뉴). 사진 친구는 그림도 지워져 되살릴 수 없다고 알린다
          {
            label: t('pet.friend.sendHome', { name }),
            submenu: [
              ...((live.get(f.id)?.friend ?? f).image
                ? [{ label: t('pet.friend.sendHomePhoto'), enabled: false }]
                : []),
              {
                label: t('pet.friend.sendHomeSure'),
                click: () => settings.set({ friends: settings.get().friends.filter((x) => x.id !== f.id) }),
              },
            ],
          },
        ];
      },
    });
    pet.win.webContents.on('did-finish-load', () => {
      const now = live.get(f.id)?.friend ?? f;
      pet.win.webContents.send(IPC.status, status(now));
      pet.win.webContents.send(IPC.image, imageOf(now));
    });
    // 숨긴 동안(숨기기, 발표 중) 데려온 친구는 혼자 보이지 않고 같이 숨어 있다가 같이 나온다
    for (const reason of hiddenFor.list()) pet.setHidden(reason, true, false);
    live.set(f.id, { pet, friend: f });
    o.log('friends', '왔어', f.id);
  }

  /** 설정의 친구 목록에 맞춰 창을 만들고 닫는다 */
  function sync() {
    const want = settings.get().friends;
    for (const [id, l] of live) {
      if (!want.some((f) => f.id === id)) {
        l.pet.win.destroy();
        live.delete(id);
        library.cleanup([
          l.friend.image,
          l.friend.model,
          l.friend.depth,
          ...Object.values(l.friend.poses ?? {}),
        ]);
        // 그 친구의 위치 파일도 지운다 (pet-window 의 pet-position-<id>). 남으면 쌓이기만 한다
        removeJson(`pet-position-${id}`);
        o.log('friends', '갔어', id);
      }
    }
    want.forEach((f, i) => {
      const l = live.get(f.id);
      if (!l) open(f, i);
      else if (JSON.stringify(l.friend) !== JSON.stringify(f)) {
        l.friend = f;
        if (!l.pet.win.isDestroyed()) {
          l.pet.win.webContents.send(IPC.status, status(f));
          l.pet.win.webContents.send(IPC.image, imageOf(f));
        }
      }
    });
  }

  /** 기본 펫이 숨으면(발표, 숨기기) 친구도 같이 */
  function setHidden(reason: 'user' | 'presentation', on: boolean) {
    hiddenFor.set(reason, on);
    for (const { pet } of live.values()) pet.setHidden(reason, on, false);
  }

  /** 모든 친구에게 상태를 다시 보낸다 (입체로 보기 설정이 바뀌었을 때) */
  function resendStatus() {
    for (const { pet, friend } of live.values()) {
      if (!pet.win.isDestroyed()) pet.win.webContents.send(IPC.status, status(friend));
    }
  }

  /** 모든 친구 화면을 다시 불러온다 (메뉴 막대의 펫 새로고침) */
  function reloadAll() {
    for (const { pet } of live.values()) pet.reload();
  }

  return {
    sync,
    setHidden,
    /** 지금 떠 있는 친구 펫 창들 (같이 보기: 같은 쪽을 보고, 찍는 순간 같이 가린다) */
    pets: () => [...live.values()].map((l) => l.pet),
    /** 친구 펫 창과 이름 (술래잡기) */
    mates: () => [...live.values()].map((l) => ({ pet: l.pet, name: l.friend.name })),
    resendStatus,
    reloadAll,
    /** 개발용: 바로 만나 보기 (확률, 쉬는 시간 무시) */
    debugMeet: () => meetTick(true),
    stop: () => clearInterval(meetTimer),
    get count() {
      return live.size;
    },
  };
}
