import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { t } from '../shared/i18n/index.ts';
import { IPC, type PetImages, type PetStatus } from '../shared/ipc.ts';
import type { Friend } from '../shared/settings.ts';
import { createPetWindow, type PetWindow } from './pet-window.ts';
import { settings } from './settings.ts';

/** 인사 (지금 말로) */
const hello = () => [
  t('pet.hello.1'),
  t('pet.hello.2'),
  t('pet.hello.3'),
  t('pet.hello.4'),
  t('pet.hello.5'),
];

function imageOf(f: Friend): PetImages {
  if (!f.image) return { main: null, poses: {} };
  try {
    const ext = f.image.split('.').pop() ?? 'png';
    const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
    const b64 = readFileSync(join(app.getPath('userData'), 'pets', f.image)).toString('base64');
    return { main: `data:${mime};base64,${b64}`, poses: {} };
  } catch {
    return { main: null, poses: {} };
  }
}

/**
 * 친구 펫 (v2 여러 마리): 설정의 친구마다 펫 창을 하나씩 띄운다. 돌아다니기, 창 위 앉기, 던지기, 쓰다듬기는 똑같고,
 * 할 일, 채팅, 패널은 기본 펫이 맡는다. 우클릭 메뉴는 짧게(쓰다듬기, 숨기기, 집에 보내기).
 */
export function createFriends(o: {
  mainPet: () => PetWindow;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const live = new Map<string, { pet: PetWindow; friend: Friend }>();

  function status(f: Friend): PetStatus {
    return { hungry: false, focus: false, sulk: 0, kind: f.kind, cushion: false };
  }

  function open(f: Friend, index: number) {
    const main = o.mainPet().bounds();
    const pet: PetWindow = createPetWindow({
      id: f.id,
      initial: { x: main.x - (index + 1) * 140, y: main.y },
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
          { type: 'separator' },
          {
            label: t('pet.friend.sendHome', { name }),
            click: () => settings.set({ friends: settings.get().friends.filter((x) => x.id !== f.id) }),
          },
        ];
      },
    });
    pet.win.webContents.on('did-finish-load', () => {
      const now = live.get(f.id)?.friend ?? f;
      pet.win.webContents.send(IPC.status, status(now));
      pet.win.webContents.send(IPC.image, imageOf(now));
    });
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
    for (const { pet } of live.values()) pet.setHidden(reason, on, false);
  }

  return {
    sync,
    setHidden,
    get count() {
      return live.size;
    },
  };
}
