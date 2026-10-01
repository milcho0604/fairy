import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {
    // 샌드박스 렌더러는 ESM preload 를 못 읽는다. CommonJS 로 낸다.
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    // 펫 창은 가볍게 두려고 React 없이 만든다 (L6). 패널, 채팅 창은 React 로 2단계부터 더한다.
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { pet: resolve('src/renderer/pet.html') },
      },
    },
  },
});
