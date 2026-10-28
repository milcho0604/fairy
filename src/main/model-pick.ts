// 받는 모델의 판이 바뀌었을 때 (2026-10-28 fp16 판) 이미 받아 둔 옛 판을 계속 쓰기 위한 고르기. Electron 없이 시험한다.

/** 받을 모델 파일 하나 (받는 곳, 해시, 크기) */
export interface ModelFile {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

/**
 * 지금 쓸 파일. 옛 판이 디스크에 있으면 그것을 그대로 쓰고(다시 받게 하지 않는다), 없으면 새 판.
 * 두 판은 입력 크기와 정규화가 같고 결과 마스크, 깊이가 같아서 섞어 써도 화면이 달라지지 않는다
 */
export function pickModelFile(
  current: ModelFile,
  old: ModelFile | undefined,
  has: (file: string) => boolean,
): ModelFile {
  return old && has(old.file) ? old : current;
}
