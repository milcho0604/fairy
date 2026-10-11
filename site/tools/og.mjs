#!/usr/bin/env node
// 공유 카드 그림(1200x630)을 tools/og.html 로 그려 assets/og.png 로 저장한다. config.js 의 이름을 쓴다.
// Renders tools/og.html (real screenshots + config name) to assets/og.png with headless Chromium.
// Needs Playwright with a Chromium:  npm i -D playwright && npx playwright install chromium
// (or set PLAYWRIGHT_MODULE to an existing install, e.g. /opt/node-tools/node_modules/playwright/index.mjs)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(SITE_DIR, 'tools/og.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: join(SITE_DIR, 'assets/og.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('wrote assets/og.png');
