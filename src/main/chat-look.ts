import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, screen } from 'electron';
import type { ChatLookView } from '../shared/chat-look.ts';
import { CHAT, type OutgoingImage } from '../shared/ipc.ts';
import type { ChatFace } from './chat.ts';
import { openScreenSettings, screenAccess } from './look-together.ts';
import { readJson, writeJson } from './store.ts';

/** 처음 켤 때 본 안내에 동의했는지 (켬 자체는 남기지 않는다: 앱을 다시 켜면 꺼진다) */
const FILE = 'chat-look';

export interface ChatLookOptions {
  /** 지금 있는 채팅 면들 (따로 창, 큰 창 안). 없으면 빈 목록 */
  chatFaces: () => ChatFace[];
  look: {
    /** 화면 한 곳 고르기 (펫 메뉴의 같이 보기) */
    start(): void | Promise<void>;
    /** 그 모니터를 통째로 찍는다 (look-together.ts shot) */
    shot(display: Electron.Display, hide: () => () => void): Promise<OutgoingImage | 'denied' | 'failed'>;
  };
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 채팅 창의 같이 보기 (shared/chat-look.ts). 켜고 끄기, 동의 기억, 지금 화면 찍기, 고르기, 권한 설정 열기.
 * 화면은 채팅 창이 보낼 때만 찍는다 (켜 둔 동안 몰래 찍어 두지 않는다)
 */
export function createChatLook({ chatFaces, look, log }: ChatLookOptions) {
  const saved = readJson(FILE) as { agreed?: unknown } | undefined;
  let agreed = saved?.agreed === true;
  let on = false;

  const faceOf = (e: IpcMainEvent | IpcMainInvokeEvent) => chatFaces().find((f) => f.contents === e.sender);
  const fromChat = (e: IpcMainEvent | IpcMainInvokeEvent) => !!faceOf(e);
  const view = (): ChatLookView => ({ on, agreed, access: screenAccess() });
  const push = () => {
    for (const f of chatFaces()) f.contents.send(CHAT.lookState, view());
  };

  ipcMain.handle(CHAT.look, (e) => (fromChat(e) ? view() : undefined));

  ipcMain.on(CHAT.setLook, (e, next: unknown, agree: unknown) => {
    if (!fromChat(e) || typeof next !== 'boolean') return;
    // 처음 켤 때는 채팅 창이 안내를 보이고 동의(agree)를 받아 온다. 동의 없이 켜라고 하면 켜지 않는다
    if (next && !agreed) {
      if (agree !== true) return;
      agreed = true;
      writeJson(FILE, { agreed });
    }
    on = next;
    log('chat', 'look', on ? 'on' : 'off');
    push();
  });

  ipcMain.handle(CHAT.lookShot, async (e) => {
    const face = faceOf(e);
    const win = face?.frame;
    if (!face || !win || !on) return 'failed';
    const display = screen.getDisplayMatching(win.getBounds());
    const result = await look.shot(display, () => {
      // 채팅 창은 숨기지 않고 투명하게만 한다 (숨겼다 보이면 입력 포커스가 흔들린다). 시험 창은 원래 투명이라 그 값으로 되돌린다
      const before = win.getOpacity();
      win.setOpacity(0);
      return () => {
        if (!win.isDestroyed()) win.setOpacity(before);
      };
    });
    if (typeof result === 'string') {
      log('chat', 'look shot', result);
      push();
    }
    return result;
  });

  ipcMain.on(CHAT.lookPick, (e) => {
    if (fromChat(e)) void look.start();
  });

  ipcMain.on(CHAT.lookSettings, (e) => {
    if (fromChat(e)) openScreenSettings();
  });

  return { view };
}
