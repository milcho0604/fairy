/**
 * 사진 AI 엔진 onnxruntime-web 의 wasm (배경 지우기와 2.5D 깊이가 같이 쓴다. GPU 와 CPU 가 한 파일).
 * 17MB 라 설치 파일에 넣지 않고 처음 사진 펫을 만들 때 모델과 같이 받는다 (설치 파일을 줄이려고, 2026-10-11).
 * 묶음 안 JS 와 판이 꼭 같아야 한다: package.json 의 onnxruntime-web 판을 올리면 version, sha256, bytes 도 같이
 * (ort-wasm.test.ts 가 node_modules 의 파일과 맞춰 본다). 판을 박은 주소라 파일이 바뀌지 않는다.
 */
export const ORT_WASM = {
  version: '1.30.0',
  /** 묶음이 찾는 이름 (electron.vite.config.ts 가 이 이름을 우리 주소로 바꿔 빌드에 넣지 않는다) */
  name: 'ort-wasm-simd-threaded.jspi.wasm',
  /** 저장 이름. 판을 붙여 판이 바뀌면 새로 받는다 */
  file: 'ort-wasm-simd-threaded.jspi-1.30.0.wasm',
  /** npm 원본을 그대로 내주는 CDN 둘. 앞이 안 되면(막힘, 서버 오류) 뒤로 */
  urls: [
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.jspi.wasm',
    'https://unpkg.com/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.jspi.wasm',
  ],
  sha256: 'a54c76f86b0f0d9572380cf1c6292a7b3903716ffcbcd6b0e5c7050bf430eb93',
  bytes: 16_758_545,
} as const;
