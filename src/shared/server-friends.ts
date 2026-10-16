// 서버 친구 (이슈 #110 1부): 친구 맺기, 선물, 일정 공유 1차(바쁜 시간대만). 설정 창과 메인이 같이 쓰는 모양만 둔다.
// 토큰과 네트워크는 메인(main/server-friends.ts)에만 있다. 펫끼리 같이 걷는 "친구"(settings/Friends.tsx, main/friends.ts)와는 다른 것이다.
import { normalizeDeviceCode } from './account-profile.ts';
import { SITE_URL } from './update-policy.ts';

export interface FriendPerson {
  /** 기기 코드 F-XXXX-XXXX (공개 코드). 탈퇴한 친구면 빈 글 */
  code: string;
  nickname: string | null;
}

export interface FriendItem extends FriendPerson {
  since: string;
  /** 내가 이 친구에게 바쁜 시간을 보여 준다 */
  iShare: boolean;
  /** 이 친구가 나에게 바쁜 시간을 보여 준다 */
  theyShare: boolean;
  /** 이 친구가 마지막으로 일정을 올린 때 (보여 줄 때만) */
  busyAt: string | null;
}

export interface FriendRequestItem extends FriendPerson {
  id: number;
  sentAt: string;
  expiresAt: string;
}

export interface FriendLimits {
  friends: number;
  giftCoinsPerDay: number;
  giftPassesPerDay: number;
  requestDays: number;
  busyDays: number;
}

/** 서버 GET /v1/friends 의 대답 */
export interface FriendsList {
  me: FriendPerson;
  friends: FriendItem[];
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
  blocked: FriendPerson[];
  limits: FriendLimits;
  /** 오늘(한국 날짜) 보낸 선물 합 */
  today: { coins: number; passes: number };
}

/** 설정 칸이 그리는 것 */
export interface FriendsState {
  /**
   * 칸을 보이나: 서버 주소가 있고, 만 14세 이상 서버 모드이고, 로그인(세션)했고, 서버가 친구 기능(friends)을 켜 줬다.
   * 아니면 칸을 통째로 숨긴다
   */
  available: boolean;
  /** 서버에서 받은 목록. 아직 못 받았으면 null */
  list: FriendsList | null;
  /** 마지막으로 받기에 실패한 까닭 (offline 등). 되면 null */
  problem: string | null;
  /** 선물 단추 (friend_gifts) */
  gifts: boolean;
  /** 채팅 이용권 선물 칸 (만 18세 이상, 채팅 이용권을 쓸 수 있고, 이용권 선물 스위치 friend_gift_passes 가 켜졌다) */
  passGifts: boolean;
  /** 서버가 일정 공유를 켜 줬다 (friend_calendar) */
  calendar: boolean;
  /** 지금 코인 잔액과 채팅 이용권 (서버 사본). 모르면 null */
  balance: number | null;
  passes: number | null;
  /** 초대 링크로 열어 미리 넣어 둔 친구 코드 (fairy://friend/<코드>) */
  prefill: string | null;
}

/** 친구의 바쁜 시간대 (시작, 끝 ms). 제목은 없다 */
export interface BusyBlock {
  start: number;
  end: number;
}

export type FriendResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const FRIENDS = {
  state: 'friends:state',
  refresh: 'friends:refresh',
  request: 'friends:request',
  accept: 'friends:accept',
  decline: 'friends:decline',
  cancel: 'friends:cancel',
  remove: 'friends:remove',
  block: 'friends:block',
  unblock: 'friends:unblock',
  gift: 'friends:gift',
  share: 'friends:share',
  busy: 'friends:busy',
  copyCode: 'friends:copy-code',
  copyLink: 'friends:copy-link',
  clearPrefill: 'friends:clear-prefill',
  changed: 'friends:changed',
} as const;

/** 설정 창이 부르는 것 (preload 가 window.jjakkungFriends 로 연다) */
export interface FriendsBridge {
  state(): Promise<FriendsState | undefined>;
  refresh(): Promise<FriendsState | undefined>;
  /** 친구 코드나 초대 링크를 붙여 넣어 신청 */
  request(text: string): Promise<FriendResult<{ accepted: boolean }>>;
  accept(id: number): Promise<FriendResult>;
  decline(id: number): Promise<FriendResult>;
  cancel(id: number): Promise<FriendResult>;
  remove(code: string): Promise<FriendResult>;
  block(code: string): Promise<FriendResult>;
  unblock(code: string): Promise<FriendResult>;
  gift(code: string, coins: number, passes: number): Promise<FriendResult<{ coins: number; passes: number }>>;
  share(code: string, on: boolean): Promise<FriendResult>;
  busy(code: string): Promise<FriendResult<{ blocks: BusyBlock[]; updatedAt: string | null }>>;
  copyCode(): Promise<boolean>;
  copyLink(): Promise<boolean>;
  clearPrefill(): void;
  onChanged(listener: (s: FriendsState) => void): () => void;
}

/** 초대 링크 (홈페이지 안내 페이지가 앱 열기를 시도한다: fairy://friend/<코드>) */
export const inviteLink = (code: string): string => `${SITE_URL}/f/${code}/`;

/**
 * 붙여 넣은 글에서 친구 코드를 찾는다: 코드 그대로(소문자, 붙임표 없이도), 초대 링크(https://fairy.moilga.com/f/<코드>),
 * 앱 주소(fairy://friend/<코드>). 못 찾으면 undefined
 */
export function friendCodeFrom(text: unknown): string | undefined {
  if (typeof text !== 'string' || text.length > 300) return undefined;
  const s = text.trim();
  const m = /(?:\/f\/|friend\/)([0-9A-Za-z-]{8,12})\/?(?:[?#].*)?$/.exec(s);
  return normalizeDeviceCode(m ? m[1] : s);
}

/** 바쁜 시간대를 날마다 나눈다 (현지 시간). 앞으로 days 일, 날마다 [시작, 끝] 분 */
export function busyByDay(
  blocks: readonly BusyBlock[],
  now: number,
  days = 7,
): { day: number; spans: { from: number; to: number }[] }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const out: { day: number; spans: { from: number; to: number }[] }[] = [];
  for (let i = 0; i < days; i++) {
    const d0 = new Date(start);
    d0.setDate(start.getDate() + i);
    const d1 = new Date(d0);
    d1.setDate(d0.getDate() + 1);
    const a = d0.getTime();
    const b = d1.getTime();
    const spans = blocks
      .filter((x) => x.end > a && x.start < b)
      .map((x) => ({
        from: Math.round((Math.max(x.start, a) - a) / 60_000),
        to: Math.round((Math.min(x.end, b) - a) / 60_000),
      }))
      .filter((x) => x.to > x.from);
    out.push({ day: a, spans });
  }
  return out;
}
