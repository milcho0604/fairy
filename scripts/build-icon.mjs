// 앱 아이콘 만들기: build/icon.svg 를 1024px PNG(build/icon.png)로 그린다.
// electron-builder 가 이 PNG 로 맥(icns)과 윈도우(ico) 아이콘을 만든다.
// 실행: npx electron scripts/build-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const dir = join(import.meta.dirname, '../build');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const SIZE = 1024;

app.dock?.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const png = image.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
  writeFileSync(join(dir, 'icon.png'), png);
  console.log(`build/icon.png ${image.getSize().width}x${image.getSize().height} -> ${SIZE}`);
  app.quit();
});
