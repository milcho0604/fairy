// 메뉴 막대 달리는 펫 손그림 실루엣 굽기 (src/shared/menu-runner.ts RUNNER_ART_SIZES).
// runner.py 가 만든 장면 SVG 를 헤드리스 Chromium 에서 크기마다 그려 불투명도만 남기고(눈과 코는 구멍), resources/runner/<종>.alpha.gz 로 쓴다.
// 사용: python3 scripts/cute2d/runner.py <폴더> && node scripts/cute2d/runner.mjs <폴더> [미리보기.png]
// playwright 가 필요하다 (레포 의존성이 아니다): PLAYWRIGHT=<playwright index.mjs 경로>, 헤드리스 셸은 CHROME=<실행 파일>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNNER_ART_SIZES, RUNNER_TOTAL } from '../../src/shared/menu-runner.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const [dir, preview] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const meta = JSON.parse(readFileSync(join(dir, 'runner.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const page = await browser.newPage();
const url = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
// 눈과 코(같은 진갈색)만 보이게: 구멍 자리
const eyesOnly = (svg) =>
  svg.replace(/(<svg [^>]*>)/, `$1<style>svg *{visibility:hidden}[fill="${meta.eye}"]{visibility:visible}</style>`);

const out = join(ROOT, 'resources/runner');
mkdirSync(out, { recursive: true });
const sheets = [];
for (const kind of meta.kinds) {
  const svgs = Array.from({ length: RUNNER_TOTAL }, (_, i) => readFileSync(join(dir, `${kind}-${i}.svg`), 'utf8'));
  const bodies = svgs.map(url);
  const eyes = svgs.map((s) => url(eyesOnly(s)));
  const res = await page.evaluate(
    async ({ bodies, eyes, sizes }) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const B = await Promise.all(bodies.map(load));
      const E = await Promise.all(eyes.map(load));
      // 모든 장을 감싸는 상자 (512 판)
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d', { willReadFrequently: true });
      let x0 = 512, y0 = 512, x1 = 0, y1 = 0;
      for (const img of B) {
        g.clearRect(0, 0, 512, 512);
        g.drawImage(img, 0, 0, 512, 512);
        const a = g.getImageData(0, 0, 512, 512).data;
        for (let y = 0; y < 512; y++)
          for (let x = 0; x < 512; x++)
            if (a[(y * 512 + x) * 4 + 3] > 24) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const chunks = [];
      for (const { w, h } of sizes) {
        // 바닥에 발을 대고 가운데. 위와 옆은 1px 여유
        const s = Math.min((w - 2) / bw, (h - 1) / bh);
        const ox = (w - bw * s) / 2 - x0 * s;
        const oy = h - (y1 + 1) * s;
        const holes = s * 28 >= 1.6;    // 눈(가로 28)이 1.6px 아래면 구멍을 내지 않는다
        const cc = document.createElement('canvas');
        cc.width = w;
        cc.height = h;
        const gg = cc.getContext('2d', { willReadFrequently: true });
        const px = (img) => {
          gg.clearRect(0, 0, w, h);
          gg.drawImage(img, ox, oy, 512 * s, 512 * s);
          return gg.getImageData(0, 0, w, h).data;
        };
        for (let i = 0; i < B.length; i++) {
          const a = px(B[i]);
          const e = holes ? px(E[i]) : undefined;
          const one = new Array(w * h);
          for (let k = 0; k < w * h; k++) {
            const body = a[k * 4 + 3];
            const hole = e ? e[k * 4 + 3] / 255 : 0;
            one[k] = Math.round(body * (1 - hole));
          }
          chunks.push(one);
        }
      }
      return chunks;
    },
    { bodies, eyes, sizes: RUNNER_ART_SIZES },
  );
  const bytes = Buffer.from(res.flat());
  writeFileSync(join(out, `${kind}.alpha.gz`), gzipSync(bytes, { level: 9 }));
  sheets.push({ kind, frames: res.slice(0, RUNNER_TOTAL) });
  console.log(kind, bytes.length);
}
if (preview) {
  // 44x36 장을 4배로 키워 밝은 막대와 어두운 막대 위에 (사람 눈 점검용)
  const { w, h } = RUNNER_ART_SIZES[0];
  await page.setContent('<canvas id=c></canvas>');
  await page.evaluate(
    ({ sheets, w, h, n }) => {
      const Z = 4;
      const c = document.getElementById('c');
      c.width = n * w * Z;
      c.height = sheets.length * h * Z * 2;
      const g = c.getContext('2d');
      sheets.forEach(({ frames }, r) => {
        for (const [dark, row] of [[false, r * 2], [true, r * 2 + 1]]) {
          g.fillStyle = dark ? '#2b2b2e' : '#ececec';
          g.fillRect(0, row * h * Z, c.width, h * Z);
          frames.forEach((f, i) => {
            for (let k = 0; k < w * h; k++) {
              const a = f[k] / 255;
              if (!a) continue;
              g.fillStyle = dark ? `rgba(245,245,245,${a})` : `rgba(0,0,0,${a})`;
              g.fillRect((i * w + (k % w)) * Z, (row * h + Math.floor(k / w)) * Z, Z, Z);
            }
          });
        }
      });
    },
    { sheets, w, h, n: RUNNER_TOTAL },
  );
  await page.locator('canvas').screenshot({ path: preview });
}
await browser.close();
