import { contextBridge, ipcRenderer } from 'electron';
import { type GestureEvent, IPC, type PetBridge, type PetEnv } from '../shared/ipc.ts';

// 렌더러에 열어 줄 기능은 여기에만 둔다.
const bridge: PetBridge = {
  platform: process.platform,
  hover: (overPet: boolean) => ipcRenderer.send(IPC.hover, overPet),
  gesture: (event: GestureEvent) => ipcRenderer.send(IPC.gesture, event),
  contextMenu: () => ipcRenderer.send(IPC.contextMenu),
  onEnv: (listener: (env: PetEnv) => void) => {
    ipcRenderer.on(IPC.env, (_e, env: PetEnv) => listener(env));
  },
};
contextBridge.exposeInMainWorld('jjakkung', bridge);
