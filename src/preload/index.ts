import { contextBridge, ipcRenderer } from 'electron';
import type { AiProvider } from '../shared/ai/types.ts';
import type { BubbleLayout } from '../shared/bubble-layout.ts';
import type { ChatState } from '../shared/chat-state.ts';
import {
  type BubbleMessage,
  CHAT,
  type ChatBridge,
  type GestureEvent,
  IPC,
  LOOK,
  type OutgoingImage,
  type OverlayBridge,
  type PetAiState,
  type PetBridge,
  type PetEnv,
} from '../shared/ipc.ts';

// 샌드박스 preload 는 다른 파일을 require 할 수 없어 한 파일로 묶는다.
// 창마다 자기 기능만 열어 준다: 메인이 창을 만들 때 `--jj-window=<이름>` 을 넘긴다.
const kind = process.argv.find((a) => a.startsWith('--jj-window='))?.split('=')[1];

if (kind === 'pet') {
  const pet: PetBridge = {
    platform: process.platform,
    hover: (overPet: boolean) => ipcRenderer.send(IPC.hover, overPet),
    gesture: (event: GestureEvent) => ipcRenderer.send(IPC.gesture, event),
    contextMenu: () => ipcRenderer.send(IPC.contextMenu),
    wheel: (deltaY: number, zoom: boolean) => ipcRenderer.send(IPC.wheel, deltaY, zoom),
    onEnv: (listener: (env: PetEnv) => void) => {
      ipcRenderer.on(IPC.env, (_e, env: PetEnv) => listener(env));
    },
    onAi: (listener: (state: PetAiState) => void) => {
      ipcRenderer.on(IPC.ai, (_e, state: PetAiState) => listener(state));
    },
    onBubble: (listener) => {
      ipcRenderer.on(IPC.bubble, (_e, bubble: BubbleMessage | null) => listener(bubble));
    },
    onLayout: (listener) => {
      ipcRenderer.on(IPC.layout, (_e, layout: BubbleLayout) => listener(layout));
    },
    bubbleSize: (id: string, width: number, height: number) =>
      ipcRenderer.send(IPC.bubbleSize, id, width, height),
    bubbleClosed: (id: string, action: string) => ipcRenderer.send(IPC.bubbleClosed, id, action),
  };
  contextBridge.exposeInMainWorld('jjakkung', pet);
}

if (kind === 'chat') {
  const chat: ChatBridge = {
    platform: process.platform,
    snapshot: () => ipcRenderer.invoke(CHAT.snapshot),
    status: (refresh: boolean) => ipcRenderer.invoke(CHAT.status, refresh),
    send: (text: string, images: OutgoingImage[]) => ipcRenderer.send(CHAT.send, text, images),
    cancel: () => ipcRenderer.send(CHAT.cancel),
    reset: () => ipcRenderer.send(CHAT.reset),
    setProvider: (provider: AiProvider) => ipcRenderer.send(CHAT.provider, provider),
    providers: () => ipcRenderer.invoke(CHAT.providers),
    addProvider: (input) => ipcRenderer.invoke(CHAT.addProvider, input),
    removeProvider: (id: AiProvider) => ipcRenderer.invoke(CHAT.removeProvider, id),
    onState: (listener) => {
      ipcRenderer.on(CHAT.state, (_e, state: ChatState) => listener(state));
    },
    onDelta: (listener) => {
      ipcRenderer.on(CHAT.delta, (_e, id: string, text: string) => listener(id, text));
    },
    onAttach: (listener) => {
      ipcRenderer.on(CHAT.attach, (_e, image: OutgoingImage) => listener(image));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungChat', chat);
}

if (kind === 'overlay') {
  const overlay: OverlayBridge = {
    select: (rect) => ipcRenderer.send(LOOK.select, rect),
  };
  contextBridge.exposeInMainWorld('jjakkungOverlay', overlay);
}
