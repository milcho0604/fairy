// 앱 아이콘 만들기 (6단계): 펫 화면과 같은 3D 렌더러로 콩이를 그려 build/icon.png(1024px)로 저장한다.
// electron-builder 가 이 PNG 로 맥(icns)과 윈도우(ico) 아이콘을 만든다. 그림은 scripts/icon-entry.ts.
// 실행: npx electron scripts/build-icon.mjs  (창은 띄우지 않는다)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { build } from 'vite';

const root = join(import.meta.dirname, '..');
const out = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: false,
    lib: { entry: join(root, 'scripts/icon-entry.ts'), formats: ['iife'], name: 'icon' },
  },
});
const code = [out].flat()[0].output[0].code;

app.dock?.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 64, height: 64, show: false });
  await win.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
  const url = await win.webContents.executeJavaScript(`${code}\n;window.iconPng`);
  const png = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(join(root, 'build/icon.png'), png);
  console.log(`build/icon.png ${Math.round(png.length / 1024)}KB`);
  app.quit();
});
