// 쪽지함 상태 한 곳 (feat/mailbox): 머리줄 봉투, 사이드바 숫자, 오늘 탭 카드, 쪽지함 화면이 같은 값을 본다.
// 안 읽음 수는 메인이 센 값(배지)이라 어디서나 같다.
import { useSyncExternalStore } from 'react';
import type { MailBox } from '../../../shared/mail.ts';

const bridge = window.jjakkungNotes;
let box: MailBox | undefined;
let started = false;
const subs = new Set<() => void>();

export function setMailBox(next: MailBox): void {
  box = next;
  for (const s of subs) s();
}

function start(): void {
  if (started) return;
  started = true;
  void bridge.list().then((b) => {
    if (b) setMailBox(b);
  });
  bridge.onChange(setMailBox);
}

const subscribe = (cb: () => void) => {
  start();
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};

/** 쪽지함 전체 (아직 못 받았으면 undefined) */
export function useMailBox(): MailBox | undefined {
  return useSyncExternalStore(subscribe, () => box);
}

/** 안 읽은 쪽지 수 (배지) */
export function useMailUnread(): number {
  return useMailBox()?.unread ?? 0;
}

/** 쪽지함을 열어 달라는 요청을 면(패널, 큰 창)에 알린다 (오늘 탭 카드 -> PanelApp) */
export const OPEN_MAIL_EVENT = 'jj:open-mail';
export const openMail = (): void => {
  window.dispatchEvent(new Event(OPEN_MAIL_EVENT));
};
