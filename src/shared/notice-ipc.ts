// 공지 창 (main/notice-window.ts) 과 화면(renderer/src/notice) 사이 약속.
import type { NoticeKind } from './notices.ts';

export const NOTICE = {
  /** 지금 보일 공지 (NoticeView). 창이 처음 그릴 때 묻는다 */
  get: 'notice:get',
  /** 보일 공지가 바뀌었다 (메인이 보낸다) */
  changed: 'notice:changed',
  /** 단추를 눌렀다 (단추 id) */
  act: 'notice:act',
  /** 그린 내용의 높이. 창 높이를 맞춘다 */
  size: 'notice:size',
} as const;

export interface NoticeButton {
  id: string;
  label: string;
  primary?: boolean;
}

/** 창이 그릴 것. 글은 메인이 지금 말(ko, en)로 골라 넘긴다. 본문은 글자만 (HTML 아님) */
export interface NoticeView {
  /** 같은 창을 다시 쓸 때 화면이 바뀐 것을 알도록 (공지 id 또는 force) */
  key: string;
  kind: NoticeKind;
  /** 종류 이름 (알림, 중요, 업데이트 권장, 꼭 필요한 업데이트) */
  badge: string;
  title: string;
  body: string;
  /** 본문 아래 작은 글 (강제: 버전, 백업과 끄기 안내) */
  notes: string[];
  buttons: NoticeButton[];
}

export interface NoticeBridge {
  get(): Promise<NoticeView | undefined>;
  onChange(listener: (view: NoticeView) => void): void;
  act(id: string): void;
  size(height: number): void;
}
