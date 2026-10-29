// 서버 친구 (이슈 #110 1부): 친구 맺기, 선물, 일정 공유 1차(바쁜 시간대)와 2차(친구별 일정 제목). 설정 창과 메인이 같이 쓰는 모양만 둔다.
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
  /** 내가 이 친구에게 내 펫이 놀러 가도 된다고 켰다 (#141) */
  iVisit: boolean;
  /** 이 친구가 나에게 자기 펫이 놀러 와도 된다고 켰다 */
  theyVisit: boolean;
  /** 둘 다 만 18세 이상이라 일정 제목 공유를 켤 수 있다 (14~17세는 바쁜 시간만) */
  canTitle: boolean;
  /** 내가 이 친구에게 일정 제목까지 보여 준다 */
  iTitle: boolean;
  /** 이 친구가 나에게 일정 제목까지 보여 준다 */
  theyTitle: boolean;
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
  /** 서버가 펫 놀러 가기를 켜 줬다 (friend_visit). 꺼졌으면 친구 줄의 스위치를 숨긴다 */
  visit: boolean;
  /** 내 펫이 앱에 든 그림이 아니라 친구 화면에는 대역으로 간다 (사진, 직접 만든 그림) */
  visitCustom: boolean;
  /** 지금 코인 잔액과 채팅 이용권 (서버 사본). 모르면 null */
  balance: number | null;
  passes: number | null;
  /** 초대 링크로 열어 미리 넣어 둔 친구 코드 (fairy://friend/<코드>) */
  prefill: string | null;
}

/** 놀러 올 친구 펫 카드 (서버 GET /v1/friends/visits). 그림 파일은 없다: 종류 id 와 이름뿐 */
export interface VisitorCard extends FriendPerson {
  pet: { species: string; name: string | null; stand: boolean };
}

/** 친구의 바쁜 시간대 (시작, 끝 ms). 제목은 없다 */
export interface BusyBlock {
  start: number;
  end: number;
}

/** 제목이 있는 일정 (일정 제목 공유 2차). 제목을 켠 친구에게만 서버가 준다 */
export interface TitledBlock extends BusyBlock {
  title: string;
}

/** 친구의 바쁜 시간 보기 */
export interface BusyView {
  blocks: BusyBlock[];
  titles: TitledBlock[];
  updatedAt: string | null;
}

/** 손님 방문 요약 (설정 친구 칸 머리말) */
export interface VisitInfo {
  today: number;
  max: number;
  paused: boolean;
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
  shareTitle: 'friends:share-title',
  busy: 'friends:busy',
  visit: 'friends:visit',
  visitInfo: 'friends:visit-info',
  visitPause: 'friends:visit-pause',
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
  /** 이 친구에게 일정 제목도 보여 주기 (둘 다 만 18세 이상, 바쁜 시간을 보여 주는 중일 때만) */
  shareTitle(code: string, on: boolean): Promise<FriendResult>;
  busy(code: string): Promise<FriendResult<BusyView>>;
  /** 이 친구에게 내 펫 놀러 가기 켜고 끄기 (#141) */
  visit(code: string, on: boolean): Promise<FriendResult>;
  /** 오늘 놀러 온 횟수와 "오늘은 그만" 상태 (손님 창을 맡은 메인이 답한다) */
  visitInfo(): Promise<VisitInfo | undefined>;
  /** "오늘은 그만" 켜고 끄기 */
  visitPause(on: boolean): Promise<VisitInfo | undefined>;
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

/** 제목 있는 일정을 날마다 나눈다 (현지 시간, 바쁜 시간대와 같은 방식). 날마다 시작 순 */
export function titlesByDay(
  titles: readonly TitledBlock[],
  now: number,
  days = 7,
): { day: number; items: { from: number; to: number; title: string }[] }[] {
  return busyByDay(titles, now, days).map((d) => {
    const next = new Date(d.day);
    next.setDate(next.getDate() + 1);
    return {
      day: d.day,
      items: titles
        .filter((x) => x.end > d.day && x.start < next.getTime())
        .map((x) => ({
          from: Math.round((Math.max(x.start, d.day) - d.day) / 60_000),
          to: Math.round((Math.min(x.end, next.getTime()) - d.day) / 60_000),
          title: x.title,
        }))
        .filter((x) => x.to > x.from)
        .sort((p, q) => p.from - q.from || p.title.localeCompare(q.title)),
    };
  });
}

/**
 * 바쁜 시간대 중 제목 있는 일정이 다 덮지 못한 것. 제목 줄에 이미 시간이 있어 같은 시간을 두 번 적지 않으려고 쓴다
 * (바쁜 시간대는 겹친 일정을 합친 것이라, 제목 일정 여럿이 이어 한 시간대를 덮을 수 있다)
 */
export function spansWithoutTitles(
  spans: readonly { from: number; to: number }[],
  items: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  const sorted = [...items].sort((a, b) => a.from - b.from);
  return spans.filter((sp) => {
    let at = sp.from;
    for (const it of sorted) {
      if (it.to <= at) continue;
      if (it.from > at) break;
      at = it.to;
      if (at >= sp.to) return false;
    }
    return true;
  });
}
