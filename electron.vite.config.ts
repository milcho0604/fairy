import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    // 구글 캘린더에 쓰기 (docs/google-calendar.md): 빌드할 때 환경 변수로 OAuth 클라이언트를 넣는다. 없으면 빈 글 (기능이 숨는다)
    define: {
      __JJ_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.JJ_GOOGLE_CLIENT_ID ?? ''),
      __JJ_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.JJ_GOOGLE_CLIENT_SECRET ?? ''),
    },
    // 펫 MCP 서버(v1)를 따로 낸다. AI 도구가 짝꿍 실행 파일을 Node 로 돌려 이 파일을 연다.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'mcp-server': resolve('src/main/mcp-server.ts'),
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
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          pet: resolve('src/renderer/pet.html'),
          chat: resolve('src/renderer/chat.html'),
          overlay: resolve('src/renderer/overlay.html'),
          settings: resolve('src/renderer/settings.html'),
          panel: resolve('src/renderer/panel.html'),
          quick: resolve('src/renderer/quick.html'),
          maker: resolve('src/renderer/maker.html'),
          onboarding: resolve('src/renderer/onboarding.html'),
        },
      },
      minify: true,
    },
  },
});
