// 서버 친구의 앱 쪽 흐름 (이슈 #110 1부, 일정 제목 2차). Electron 없이 돌아 시험에서 그대로 부른다. main/server.ts 가 IPC 와 타이머를 붙인다.
// - 서버 모드(만 14세 이상, 서버 주소 있음), 로그인 세션, 서버가 켜 준 친구 기능(friends)일 때만 무엇이든 보낸다.
// - 일정 공유 1차: 내가 바쁜 시간을 보여 주는 친구가 하나라도 있으면, 몇 분마다 앞으로 14일의 바쁜 시간대(시작, 끝)만 올린다.
//   장소, 메모는 보내지 않는다. 구글 Limited Use 확인 전이라 직접 넣은 일정만 쓴다 (shareableEvent).
// - 일정 제목 2차: 제목을 켠 친구(iTitle)가 하나라도 있을 때만 제목 있는 일정(items)을 함께 올린다. 아무도 안 켰으면 제목은
//   서버로 나가지 않는다 (키 자체를 보내지 않는다). 서버가 친구별 허용에 따라 제목을 거르므로 앱은 켠 친구가 있을 때만 올리면 된다.
//   구글 일정은 제목을 보내지 않는다 (비공개 표시 private 를 로컬에 저장하지 않아 가릴 수 없으니 통째로 뺀다, shareableTitle).
// - 토큰은 server-core 의 sessionCall 안에만 있다.
import { randomBytes } from 'node:crypto';
import type { PetCard } from '../shared/pet-card.ts';
import {
  type BusyBlock,
  type BusyView,
  type FriendResult,
  type FriendsList,
  type FriendsState,
  friendCodeFrom,
  type TitledBlock,
  type VisitorCard,
} from '../shared/server-friends.ts';
import type { ApiResult } from './server-api.ts';
import type { ServerCore } from './server-core.ts';

/** 같은 내용이어도 이만큼 지나면 다시 올린다 (친구 화면의 "N분 전에 고침"이 오래되지 않게) */
export const BUSY_REFRESH_MS = 30 * 60_000;
/** 올리는 기간 (서버 BUSY_DAYS) */
export const BUSY_DAYS = 14;
/** 끝이 없는 일정은 30분으로 본다 (event-overlap.ts 와 같다) */
const NO_END_MS = 30 * 60_000;

/** 펫 카드는 내용이 같아도 이만큼 지나면 다시 올린다 (서버는 14일 안 올리면 지운다) */
export const CARD_REFRESH_MS = 6 * 3600_000;

/** 올리는 제목 길이 (서버 TITLE_MAX) */
export const TITLE_MAX = 80;

/** 바쁜 시간대를 만드는 일정 하나 (시작, 끝, 어디서 왔나). 제목은 제목을 켠 친구가 있을 때만 쓴다 */
export interface BusySource {
  startAt: number;
  endAt: number | null;
  source: 'local' | 'ics' | 'google';
  title?: string;
  /** 비공개로 표시된 일정 (구글 visibility private 등). 있으면 제목은 빼고 바쁜 시간만 */
  private?: boolean;
}

/**
 * 친구에게 보여 줄 일정인가 (사용자 결정 2026-10-16). 구글 Limited Use 확인 전에는 사용자가 페어리에 직접 넣은 일정만:
 * 구글에서 읽어 온 일정(google)과 캘린더 주소로 가져온 일정(ics)은 보내지 않는다.
 * TODO(#110 2차): Limited Use 확인 뒤 구글 일정은 따로 켜는 설정(기본 꺼짐, 사용자가 직접 켬)으로 연다. 그 설정이 생기기
 * 전까지 SHARE_GOOGLE_EVENTS 는 false 그대로 둔다
 */
export const SHARE_GOOGLE_EVENTS = false;
export const shareableEvent = (e: Pick<BusySource, 'source'>, google = SHARE_GOOGLE_EVENTS): boolean =>
  e.source === 'local' || (google && e.source === 'google');

/**
 * 제목을 보내도 되는 일정인가: 직접 넣은 일정(local)이고 비공개 표시가 없고 제목이 있다. 구글에서 읽어 온 일정은
 * SHARE_GOOGLE_EVENTS 를 열어도 제목은 따로 막아 둔다: 구글의 비공개 일정(visibility private, confidential)을 가려내려면
 * 그 표시를 읽어 저장해야 하는데 아직 받지 않으므로, 모르는 채 제목을 내보내지 않는다
 */
export const shareableTitle = (e: Pick<BusySource, 'source' | 'title' | 'private'>): boolean =>
  e.source === 'local' && e.private !== true && !!e.title?.trim();

export interface ServerFriendsDeps {
  core: () => ServerCore | undefined;
  /** [from, to) 와 겹치는 시각 일정 (종일 일정은 뺀다). 끝이 없으면 null */
  events: (from: number, to: number) => BusySource[];
  now: () => number;
  /** 지금 내 펫 카드 (shared/pet-card-of.ts cardOf). 없으면 카드를 올리지 않는다 */
  card?: () => PetCard;
  /** 내 펫이 직접 가져온 그림이라 대역으로 가는가 (설정 칸의 안내) */
  customPet?: () => boolean;
  onChange: (s: FriendsState) => void;
  log: (tag: string, ...rest: unknown[]) => void;
  random?: (n: number) => Uint8Array;
}

/** 앞으로 BUSY_DAYS 일의 바쁜 시간대. 겹친 것은 합친다 (서버도 한 번 더 합친다) */
export function busyBlocks(
  events: readonly { startAt: number; endAt: number | null }[],
  now: number,
): BusyBlock[] {
  const to = now + BUSY_DAYS * 86_400_000;
  const list = events
    .map((e) => ({
      start: Math.max(now, e.startAt),
      end: Math.min(to, e.endAt !== null && e.endAt > e.startAt ? e.endAt : e.startAt + NO_END_MS),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const out: BusyBlock[] = [];
  for (const b of list) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  // 분 단위로 맞춘다 (초가 바뀔 때마다 다시 올리지 않게)
  return out
    .slice(0, 400)
    .map((b) => ({ start: Math.floor(b.start / 60_000) * 60_000, end: Math.ceil(b.end / 60_000) * 60_000 }));
}

/** 앞으로 BUSY_DAYS 일의 제목 있는 일정 (겹쳐도 합치지 않는다). 제목은 한 줄로 다듬어 TITLE_MAX 글자까지, 400개까지 */
export function titledBlocks(
  events: readonly Pick<BusySource, 'startAt' | 'endAt' | 'source' | 'title' | 'private'>[],
  now: number,
): TitledBlock[] {
  const to = now + BUSY_DAYS * 86_400_000;
  return events
    .filter(shareableTitle)
    .map((e) => ({
      start: Math.max(now, e.startAt),
      end: Math.min(to, e.endAt !== null && e.endAt > e.startAt ? e.endAt : e.startAt + NO_END_MS),
      title: Array.from((e.title ?? '').replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').trim())
        .slice(0, TITLE_MAX)
        .join('')
        .trim(),
    }))
    .filter((b) => b.end > b.start && b.title)
    .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
    .slice(0, 400)
    .map((b) => ({
      start: Math.floor(b.start / 60_000) * 60_000,
      end: Math.ceil(b.end / 60_000) * 60_000,
      title: b.title,
    }));
}

const errorOf = (r: { status: number; error: string }): string => (r.status === 0 ? 'offline' : r.error);

export function createServerFriends(d: ServerFriendsDeps) {
  const random = d.random ?? ((n: number) => randomBytes(n));
  let list: FriendsList | null = null;
  let problem: string | null = null;
  let prefill: string | null = null;
  let refreshing: Promise<void> | null = null;
  let lastUpload: { key: string; at: number } | null = null;
  let uploading = false;
  let lastCard: { key: string; at: number } | null = null;
  let cardBusy = false;

  const status = () => d.core()?.status();

  /** 칸을 보이나: 서버 모드, 로그인, 친구 기능 */
  function available(): boolean {
    const s = status();
    return !!s && !!d.core()?.allowed() && s.signedIn && s.features?.friends === true;
  }

  function state(): FriendsState {
    const s = status();
    const on = available();
    return {
      available: on,
      list: on ? list : null,
      problem: on ? problem : null,
      gifts: on && s?.features?.friend_gifts === true,
      passGifts:
        on &&
        s?.features?.friend_gifts === true &&
        s?.features?.friend_gift_passes === true &&
        s.age === 'adult' &&
        s.ai,
      calendar: on && s?.features?.friend_calendar === true,
      visit: on && s?.features?.friend_visit === true,
      visitCustom: d.customPet?.() ?? false,
      balance: s?.balance ?? null,
      passes: s?.tickets ?? null,
      prefill: on ? prefill : null,
    };
  }

  const changed = () => d.onChange(state());

  async function call<T>(f: Parameters<ServerCore['sessionCall']>[0]): Promise<ApiResult<T>> {
    const core = d.core();
    if (!core || !available()) return { ok: false, status: 403, error: 'login', body: {} };
    return (await core.sessionCall(f)) as ApiResult<T>;
  }

  async function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    const run = async () => {
      if (!available()) {
        if (list) {
          list = null;
          lastUpload = null;
          lastCard = null;
        }
        return;
      }
      const r = await call<FriendsList>((api, t) => api.friends(t));
      if (r.ok) {
        list = r.data;
        problem = null;
      } else {
        problem = errorOf(r);
        d.log('friends', '목록을 못 받음', r.status, r.error);
      }
    };
    // 받기가 바로 끝나도(칸이 숨은 때) 아래 대입이 먼저다: finally 를 IIFE 안에 두면 끝난 약속이 refreshing 에 남아
    // 다음 받기가 영영 돌지 않는다
    refreshing = run().finally(() => {
      refreshing = null;
      changed();
    });
    return refreshing;
  }

  /** 단추 하나: 부르고, 되면 목록을 다시 받는다 */
  async function act<T = undefined>(
    name: string,
    f: Parameters<ServerCore['sessionCall']>[0],
    pick?: (data: unknown) => T,
  ): Promise<FriendResult<T>> {
    const r = await call<unknown>(f);
    if (!r.ok) {
      d.log('friends', name, '실패', r.status, r.error);
      await refresh();
      return { ok: false, error: errorOf(r) };
    }
    d.log('friends', name);
    await refresh();
    return { ok: true, data: (pick ? pick(r.data) : undefined) as T };
  }

  /** 제목을 켠 친구가 있나 (둘 다 만 18세 이상이라 서버가 켜 준 것만, 목록의 iTitle) */
  const titlesOn = (): boolean => list?.friends.some((f) => f.iShare && f.iTitle) ?? false;

  /** 바쁜 시간대 올리기 (몇 분마다, 공유를 켠 직후). 공유하는 친구가 없으면 아무것도 하지 않는다 */
  async function uploadBusy(force = false): Promise<void> {
    if (uploading || !available()) return;
    const s = state();
    const sharing = list?.friends.some((f) => f.iShare) ?? false;
    if (!sharing) {
      lastUpload = null;
      return;
    }
    uploading = true;
    try {
      if (!s.calendar) return;
      const now = d.now();
      const events = d.events(now, now + BUSY_DAYS * 86_400_000).filter((e) => shareableEvent(e));
      const blocks = busyBlocks(events, now);
      // 제목을 켠 친구가 없으면 items 를 아예 보내지 않는다 (undefined)
      const items = titlesOn() ? titledBlocks(events, now) : undefined;
      const key = JSON.stringify({ blocks, items });
      if (!force && lastUpload && lastUpload.key === key && now - lastUpload.at < BUSY_REFRESH_MS) return;
      const r = await call<{ stored: number }>((api, t) => api.busyUpload(t, blocks, items));
      if (r.ok) {
        lastUpload = { key, at: now };
        d.log('friends', '바쁜 시간 올림', r.data.stored);
      } else {
        d.log('friends', '바쁜 시간 못 올림', r.status, r.error);
        if (r.error === 'not_sharing') await refresh();
      }
    } finally {
      uploading = false;
    }
  }

  /** 내 펫이 놀러 가기로 켠 친구가 있나 */
  const visiting = (): boolean => list?.friends.some((f) => f.iVisit) ?? false;

  /**
   * 펫 카드 올리기 (몇 분마다, 켠 직후). 놀러 갈 친구가 없으면 아무것도 보내지 않는다. 카드는 종류 id, 이름, 네 발 서기뿐이다
   * (사진, 그림 파일은 없다). 내용이 같으면 CARD_REFRESH_MS 마다만 다시 올린다
   */
  async function uploadCard(force = false): Promise<void> {
    if (cardBusy || !available() || !d.card || !state().visit) return;
    if (!visiting()) {
      lastCard = null;
      return;
    }
    cardBusy = true;
    try {
      const card = d.card();
      const key = JSON.stringify(card);
      const now = d.now();
      if (!force && lastCard && lastCard.key === key && now - lastCard.at < CARD_REFRESH_MS) return;
      const r = await call<true>((api, t) => api.visitCard(t, card));
      if (r.ok) lastCard = { key, at: now };
      else {
        d.log('friends', '펫 카드 못 올림', r.status, r.error);
        if (r.error === 'not_visiting') await refresh();
      }
    } finally {
      cardBusy = false;
    }
  }

  /**
   * 서버가 조용히 쉬는 때인가 (손님을 새로 부르지 않는다): 친구 기능이 안 보이거나, 펫 놀러 가기 키가 꺼졌거나, 서버가 꺼졌거나
   * 업데이트 관문(426)에 막혔다. 말풍선, 알림 없이 다음 차례를 기다린다
   */
  function visitQuiet(): boolean {
    const s = status();
    return !available() || !state().visit || !!s?.problem;
  }

  return {
    available,
    state,
    refresh,
    uploadBusy,
    uploadCard,
    visitQuiet,
    /** 서로 켠 친구가 있나 (목록에서. 없으면 손님 목록을 받으러 가지 않는다) */
    mutualVisit: (): boolean => list?.friends.some((f) => f.iVisit && f.theyVisit) ?? false,
    /** 놀러 올 친구 펫 카드. 실패(오프라인, 426, 키 꺼짐)는 undefined: 조용히 넘어간다 */
    async visitors(): Promise<VisitorCard[] | undefined> {
      if (visitQuiet()) return undefined;
      const r = await call<VisitorCard[]>((api, t) => api.visits(t));
      if (!r.ok) {
        d.log('friends', '손님 목록 못 받음', r.status, r.error);
        return undefined;
      }
      return r.data;
    },
    /** 이 친구에게 내 펫 놀러 가기. 켜면 바로 카드를 올린다 */
    async visit(code: string, on: boolean): Promise<FriendResult> {
      const r = await act(on ? '놀러 가기 켬' : '놀러 가기 끔', (api, t) => api.friendVisit(t, code, on));
      if (r.ok && on) await uploadCard(true);
      return r;
    },
    /** 모든 친구에게 놀러 가기를 끄고 카드를 지운다 (로그아웃 전에 부른다. 실패해도 로그아웃은 한다) */
    async stopVisit(): Promise<void> {
      if (!available()) return;
      lastCard = null;
      await call((api, t) => api.visitStop(t));
    },
    /** 초대 링크(fairy://friend/<코드>)로 열었다: 칸에 코드를 미리 넣는다 */
    prefill(code: string) {
      prefill = code;
      changed();
    },
    clearPrefill() {
      prefill = null;
      changed();
    },
    /** 코드나 링크를 붙여 넣어 신청. 모양이 틀리면 보내지 않는다 (code) */
    async request(text: unknown): Promise<FriendResult<{ accepted: boolean }>> {
      const code = friendCodeFrom(text);
      if (!code) return { ok: false, error: 'code' };
      const r = await act(
        '신청',
        (api, t) => api.friendRequest(t, code),
        (x) => x as { accepted: boolean },
      );
      if (r.ok) prefill = null;
      return r;
    },
    accept: (id: number) => act('수락', (api, t) => api.friendAccept(t, id)),
    decline: (id: number) => act('거절', (api, t) => api.friendDecline(t, id)),
    cancel: (id: number) => act('신청 거둠', (api, t) => api.friendCancel(t, id)),
    remove: (code: string) => act('끊음', (api, t) => api.friendRemove(t, code)),
    block: (code: string) => act('차단', (api, t) => api.friendBlock(t, code)),
    unblock: (code: string) => act('차단 풂', (api, t) => api.friendUnblock(t, code)),
    /**
     * 선물. 요청 번호는 한 번 누를 때 하나: 인터넷이 끊겨 답을 못 받았으면 같은 번호로 한 번 더 보낸다 (서버가 한 번만 뺀다).
     * 되면 맞추기로 잔액과 채팅 이용권을 다시 받는다
     */
    async gift(
      code: string,
      coins: number,
      passes: number,
    ): Promise<FriendResult<{ coins: number; passes: number }>> {
      const requestId = Buffer.from(random(18)).toString('base64url');
      const send = () =>
        call<{ coins: number; passes: number }>((api, t) =>
          api.friendGift(t, { to: code, coins, passes, requestId }),
        );
      let r = await send();
      if (!r.ok && r.status === 0) r = await send();
      if (!r.ok) {
        d.log('friends', '선물 못 보냄', r.status, r.error);
        return { ok: false, error: errorOf(r) };
      }
      d.log('friends', '선물 보냄', r.data.coins, r.data.passes);
      const core = d.core();
      await core?.run();
      if (passes > 0) await core?.refreshTickets();
      await refresh();
      return { ok: true, data: { coins: r.data.coins, passes: r.data.passes } };
    },
    /** 이 친구에게 바쁜 시간 보여 주기. 켜면 바로 올린다 (직접 넣은 일정만, shareableEvent) */
    async share(code: string, on: boolean): Promise<FriendResult> {
      const r = await act(on ? '일정 공유 켬' : '일정 공유 끔', (api, t) => api.friendShare(t, code, on));
      if (r.ok && on) await uploadBusy(true);
      return r;
    },
    /**
     * 이 친구에게 일정 제목도 보여 주기. 켜면 바로 제목까지 올리고, 끄면 목록을 다시 받아 아무도 안 켰으면 다음 올리기부터
     * 제목 없이 올린다 (서버는 끄는 즉시 저장된 제목을 지운다)
     */
    async shareTitle(code: string, on: boolean): Promise<FriendResult> {
      const r = await act(on ? '일정 제목 공유 켬' : '일정 제목 공유 끔', (api, t) =>
        api.friendShareTitle(t, code, on),
      );
      if (r.ok) await uploadBusy(true);
      return r;
    },
    async busy(code: string): Promise<FriendResult<BusyView>> {
      const r = await call<BusyView>((api, t) => api.friendBusy(t, code));
      if (!r.ok) return { ok: false, error: errorOf(r) };
      return { ok: true, data: r.data };
    },
  };
}

export type ServerFriends = ReturnType<typeof createServerFriends>;
