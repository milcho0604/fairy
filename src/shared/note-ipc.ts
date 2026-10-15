// 매일 쪽지함 통로 (패널 오늘 탭 ↔ 메인). preload 가 묶어 가는 파일이라 값은 이름 글뿐이고 다른 것은 타입만 부른다.
// 쪽지 쓰기와 배달은 shared/daily-note.ts, main/daily-note.ts.
import type { NoteLook } from './together.ts';

export const NOTES = {
  /** 패널 → 메인: 쪽지함 목록 */
  list: 'notes:list',
  /** 패널 → 메인: 이 쪽지를 펼쳐 읽었다 (특별한 편지면 코인을 이때 준다) */
  read: 'notes:read',
  /** 메인 → 패널: 쪽지함이 바뀌었다 */
  changed: 'notes:changed',
} as const;

/** 패널에 보이는 쪽지 하나 (메인이 지금 말로 풀어 쓴 글) */
export interface NoteView {
  day: string;
  look: NoteLook;
  title: string;
  lines: string[];
  read: boolean;
  coins?: number;
  /** 서버 쪽지함의 쪽지 (#101, 운영자가 보냄). 없으면 이 컴퓨터의 매일 쪽지. day 자리에 'inbox:<번호>' */
  source?: 'server';
}

export interface NoteBox {
  /** 매일 쪽지 설정이 켜져 있다 */
  on: boolean;
  notes: NoteView[];
}

export interface NoteBridge {
  list(): Promise<NoteBox | undefined>;
  read(day: string): void;
  onChange(listener: (box: NoteBox) => void): void;
}
