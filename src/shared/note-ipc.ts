// 쪽지함 통로 (패널과 큰 창 ↔ 메인). preload 가 묶어 가는 파일이라 값은 이름 글뿐이고 다른 것은 타입만 부른다.
// 쪽지 쓰기와 배달은 shared/daily-note.ts, main/daily-note.ts. 쪽지함 저장과 화면 모델은 shared/mail-store.ts, shared/mail.ts.
import type { MailBox, MailItem } from './mail.ts';

export const NOTES = {
  /** 패널 → 메인: 쪽지함 (모든 쪽지와 안 읽음 수) */
  list: 'notes:list',
  /** 패널 → 메인: 이 쪽지를 펼쳐 읽었다 (특별한 편지면 코인, 받을 것이 있는 서버 쪽지면 서버에서 연다) */
  read: 'notes:read',
  /** 패널 → 메인: 쪽지 하나에 하는 일 (읽음, 보관, 지우기, 고정 ...) */
  act: 'notes:act',
  /** 패널 → 메인: 안 읽은 쪽지를 모두 읽음으로 */
  readAll: 'notes:readAll',
  /** 패널 → 메인: 서버의 더 오래된 쪽지를 불러온다 */
  more: 'notes:more',
  /** 패널 → 메인: 공지 쪽지의 링크 열기 */
  link: 'notes:link',
  /** 메인 → 패널: 쪽지함이 바뀌었다 */
  changed: 'notes:changed',
} as const;

/** 쪽지 하나에 하는 일 */
export type MailAct = 'read' | 'unread' | 'archive' | 'unarchive' | 'delete' | 'restore' | 'pin' | 'unpin';

export const MAIL_ACTS: readonly MailAct[] = [
  'read',
  'unread',
  'archive',
  'unarchive',
  'delete',
  'restore',
  'pin',
  'unpin',
];
export const isMailAct = (v: unknown): v is MailAct => (MAIL_ACTS as readonly unknown[]).includes(v);

/** act 의 답: cantRemove 는 받을 것이 남은 쪽지를 지우거나 보관하려 했다 */
export type MailActResult = { ok: true; box: MailBox } | { ok: false; reason: 'cantRemove' | 'unknown' };

export type { MailBox, MailItem };

export interface NoteBridge {
  list(): Promise<MailBox | undefined>;
  read(id: string): void;
  act(id: string, act: MailAct): Promise<MailActResult | undefined>;
  readAll(): Promise<MailBox | undefined>;
  more(): Promise<MailBox | undefined>;
  openLink(id: string): void;
  onChange(listener: (box: MailBox) => void): void;
}
