// 배경 제거 모델 비교 도구 (짝꿍 P1-07). 실제 앱처럼 렌더러에서 onnxruntime-web 으로 돌린다.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const B = process.env.BG_DIR;
ipcMain.handle('list', () => ({
  photos: fs.readdirSync(path.join(B, 'photos')).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort(),
  B,
}));
ipcMain.handle('save', (_e, name, dataUrl) => {
  fs.writeFileSync(path.join(B, 'out', name), Buffer.from(dataUrl.split(',')[1], 'base64'));
});
ipcMain.handle('done', (_e, result) => {
  fs.writeFileSync(path.join(B, 'out', 'result.json'), JSON.stringify(result, null, 2));
  console.log('RESULT', JSON.stringify(result));
  app.quit();
});
ipcMain.on('log', (_e, ...a) => console.log(...a));
app.whenReady().then(() => {
  const w = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });
  w.loadFile(path.join(__dirname, 'index.html'));
});
