// 샌드박스 preload 는 CommonJS 여야 한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  hover: (overPet) => ipcRenderer.send('pet:hover', overPet),
  event: (name, detail) => ipcRenderer.send('pet:event', name, detail),
});
