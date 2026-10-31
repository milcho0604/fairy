import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { ORT_WASM_URL } from './src/shared/ipc.ts';
import { ORT_WASM } from './src/shared/ort-wasm.ts';

/**
 * 사진 AI 엔진 wasm(17MB)을 설치 파일에 넣지 않는다. 처음 쓸 때 받는다 (src/main/ort-wasm.ts).
 * onnxruntime-web 묶음이 옆 파일을 new URL(이름, import.meta.url) 로 찾아서 빌드가 그 파일을 같이 내보냈다.
 * 그 자리를 우리 주소로 바꾸고, 그래도 어딘가 wasm 이 나오면 빌드를 멈춘다 (판을 올리다 이름이 바뀐 것을 놓치지 않게)
 */
function ortWasmOnDemand(): Plugin {
  const local = `new URL("${ORT_WASM.name}",import.meta.url)`;
  return {
    name: 'jj-ort-wasm-on-demand',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') || !code.includes(local)) return null;
      return { code: code.replaceAll(local, `new URL(${JSON.stringify(ORT_WASM_URL)})`), map: null };
    },
    generateBundle(_, bundle) {
      const wasm = Object.keys(bundle).filter((f) => f.endsWith('.wasm'));
      if (wasm.length)
        this.error(`wasm 이 설치 파일에 들어간다: ${wasm.join(', ')} (src/shared/ort-wasm.ts 확인)`);
    },
  };
}

/**
 * 큰 창의 페어리, 비서 구역은 설정 창의 화면 조각을 그대로 쓴다. 설정 창 CSS 는 body, header, button 같은 전역 규칙을 가져서
 * 그대로 들이면 큰 창이 깨진다. hub/hub.css 만 모든 규칙을 .hub 아래로 가둔다 (@import 가 인라인된 뒤에 돈다)
 */
function scopeHubCss() {
  const scope = (sel: string): string => {
    const s = sel.trim();
    if (/^(html|body|#root|:root)$/.test(s)) return '.hub';
    if (s === '*') return '.hub *';
    if (s.startsWith('.mac ')) return `.hub.mac ${s.slice(5)}`;
    return `.hub ${s.replace(/^(html|body)\s+/, '')}`;
  };
  return {
    postcssPlugin: 'jj-scope-hub-css',
    Once(root: import('postcss').Root, { result }: { result: import('postcss').Result }) {
      if (!(result.opts.from ?? '').replaceAll('\\', '/').endsWith('/hub/hub.css')) return;
      root.walkRules((rule) => {
        const parent = rule.parent;
        if (parent?.type === 'atrule' && /keyframes$/i.test((parent as import('postcss').AtRule).name))
          return;
        rule.selectors = rule.selectors.map(scope);
      });
    },
  };
}

const pkgVersion = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version;

export default defineConfig({
  main: {
    // 구글 캘린더에 쓰기 (docs/google-calendar.md): 빌드할 때 환경 변수로 OAuth 클라이언트를 넣는다. 없으면 빈 글 (기능이 숨는다)
    define: {
      // 앱 판 (MCP 서버가 serverInfo 로 알린다. 그 프로세스는 Electron app 없이 돈다)
      __JJ_APP_VERSION__: JSON.stringify(pkgVersion),
      __JJ_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.JJ_GOOGLE_CLIENT_ID ?? ''),
      __JJ_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.JJ_GOOGLE_CLIENT_SECRET ?? ''),
      // 페어리 서버 주소 (docs/server-plan.md). 없으면 빈 글 (서버 기능이 모두 꺼진 채로 앱이 돈다)
      __JJ_SERVER_URL__: JSON.stringify(process.env.JJ_SERVER_URL ?? ''),
    },
    // 펫 MCP 서버(v1)를 따로 낸다. AI 도구가 짝꿍 실행 파일을 Node 로 돌려 이 파일을 연다.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'mcp-server': resolve('src/main/mcp-server.ts'),
          // 펫 대화 AI 를 읽기 전용으로 묶는 claude 훅 (이슈 #126). 같은 방식으로 Node 로 띄운다
          'ai-guard': resolve('src/main/ai-guard.ts'),
          // 무료 AI 일꾼 (v2). utilityProcess 로 따로 띄운다
          'llm-worker': resolve('src/main/llm-worker.ts'),
        },
      },
    },
  },
  preload: {
    // 샌드박스 렌더러는 ESM preload 를 못 읽고 다른 파일을 require 하지도 못한다.
    // CommonJS 한 파일로 낸다. 입구를 여러 개 두면 공유 조각이 생겨서 창 종류는 실행 인자로 나눈다.
    // (electron-vite 5.0.0 의 isolatedEntries 는 터미널이 아니면 빌드가 죽어서 쓰지 않는다.)
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    // 펫 창은 가볍게 두려고 React 없이 만든다 (L6). 채팅 창과 패널은 React.
    plugins: [react(), ortWasmOnDemand()],
    css: { postcss: { plugins: [scopeHubCss()] } },
    build: {
      rollupOptions: {
        input: {
          pet: resolve('src/renderer/pet.html'),
          chat: resolve('src/renderer/chat.html'),
          overlay: resolve('src/renderer/overlay.html'),
          settings: resolve('src/renderer/settings.html'),
          panel: resolve('src/renderer/panel.html'),
          // 큰 창 (main/home.ts)
          home: resolve('src/renderer/home.html'),
          quick: resolve('src/renderer/quick.html'),
          maker: resolve('src/renderer/maker.html'),
          onboarding: resolve('src/renderer/onboarding.html'),
          // 짝꿍이 아는 것 (main/knows.ts)
          knows: resolve('src/renderer/knows.html'),
          // 공지 창 (main/notice-window.ts)
          notice: resolve('src/renderer/notice.html'),
        },
      },
      minify: true,
    },
  },
});
