import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
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
        },
      },
      minify: true,
    },
  },
});
