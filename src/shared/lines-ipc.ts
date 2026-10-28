// 펫 대사 고치기 (#125) 설정 창 ↔ 메인 통로. 글 틀과 검사는 shared/lines.ts, shared/line-template.ts
import type { LineGroupId, LineLang } from './lines.ts';

export const LINES = {
  state: 'lines:state',
  save: 'lines:save',
  reset: 'lines:reset',
  /** 한 칸 안 쓰기 켜고 끄기 */
  mute: 'lines:mute',
  /** 창이 뜰 때 고친 대사를 동기로 받는다 (화면의 t() 도 고친 대사를 쓰게) */
  sync: 'lines:sync',
} as const;

/** 화면에 보일 대사 한 줄 */
export interface LineView {
  key: string;
  /** 기본 대사 틀 ({name:은} 같은 값 자리 포함) */
  base: string;
  /** 지금 쓰는 대사 틀 (고쳤으면 고친 글) */
  text: string;
  /** 사용자가 고친 칸인지 */
  edited: boolean;
  /** 안 쓰기로 한 칸인지 */
  muted: boolean;
  /** 틀 안의 값 이름 */
  vars: string[];
}

export interface LinesState {
  lang: LineLang;
  petName: string;
  /** 지금 고친 칸 수 (이 언어) */
  edited: number;
  /** 안 쓰기로 한 칸 수 (이 언어) */
  mutedCount: number;
  groups: { id: LineGroupId; lines: LineView[] }[];
}

/** 저장 거절 까닭 (shared/line-template.ts checkLine 과 같다) */
export type LineSaveResult =
  | { ok: true; state: LinesState }
  | {
      ok: false;
      reason: 'empty' | 'long' | 'brace' | 'missing' | 'unknown' | 'particle' | 'nokey';
      vars?: string[];
    };

export interface LinesBridge {
  state(lang: LineLang): Promise<LinesState>;
  /** 한 칸 저장. 기본과 같은 글이면 고친 칸이 지워진다 */
  save(lang: LineLang, key: string, text: string): Promise<LineSaveResult>;
  /** 기본값으로 되돌리기. key 를 안 주면 그 언어의 고친 칸 전부 */
  reset(lang: LineLang, key?: string): Promise<LinesState>;
  /** 한 칸을 안 쓰기로 하거나(on) 다시 쓴다 */
  mute(lang: LineLang, key: string, on: boolean): Promise<LinesState | undefined>;
}
