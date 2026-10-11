// 사진 AI 엔진(onnxruntime-web) 설정. 엔진 wasm(17MB)은 설치 파일에 없고 처음 쓸 때 메인이 받아
// 해시를 맞춘 뒤 jj-model:// 로 흘려 준다 (src/main/ort-wasm.ts). 배경 지우기와 깊이가 이 파일을 먼저 불러온다.
// 같은 wasm 이 GPU(WebGPU)와 CPU 둘 다 돌려서 GPU → CPU 로 다시 여는 길도 그대로다.
import * as ort from 'onnxruntime-web/jspi';
import { ORT_WASM_URL } from '../../../shared/ipc.ts';

ort.env.wasm.wasmPaths = { wasm: ORT_WASM_URL };
