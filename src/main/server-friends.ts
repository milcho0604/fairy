// 서버 친구의 앱 쪽 흐름 (이슈 #110 1부). Electron 없이 돌아 시험에서 그대로 부른다. main/server.ts 가 IPC 와 타이머를 붙인다.
// - 서버 모드(만 14세 이상, 서버 주소 있음), 로그인 세션, 서버가 켜 준 친구 기능(friends)일 때만 무엇이든 보낸다.
// - 일정 공유 1차: 내가 바쁜 시간을 보여 주는 친구가 하나라도 있고 구글 일정이 연결돼 있으면, 몇 분마다 앞으로 14일의
//   바쁜 시간대(시작, 끝)만 올린다. 제목, 장소, 메모는 보내지 않는다. 구글 연결을 끊으면 서버에 "모두 끄기"를 보내 지운다.
// - 토큰은 server-core 의 sessionCall 안에만 있다.
import { randomBytes } from 'node:crypto';
import {
  type BusyBlock,
  type FriendResult,
  type FriendsList,
  type FriendsState,
  friendCodeFrom,
} from '../shared/server-friends.ts';
import type { ApiResult } from './server-api.ts';
import type { ServerCore } from './server-core.ts';

/** 같은 내용이어도 이만큼 지나면 다시 올린다 (친구 화면의 "N분 전에 고침"이 오래되지 않게) */
export const BUSY_REFRESH_MS = 30 * 60_000;
/** 올리는 기간 (서버 BUSY_DAYS) */
export const BUSY_DAYS = 14;
/** 끝이 없는 일정은 30분으로 본다 (event-overlap.ts 와 같다) */
const NO_END_MS = 30 * 60_000;

export interface ServerFriendsDeps {
  core: () => ServerCore | undefined;
  /** 이 컴퓨터에 구글 일정이 연결돼 있다 */
  calendarLinked: () => boolean;
  /** [from, to) 와 겹치는 시각 일정의 시작과 끝 (종일 일정은 뺀다). 끝이 없으면 null */
  events: (from: number, to: number) => { startAt: number; endAt: number | null }[];
  now: () => number;
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

const errorOf = (r: { status: number; error: string }): string => (r.status === 0 ? 'offline' : r.error);

export function createServerFriends(d: ServerFriendsDeps) {
  const random = d.random ?? ((n: number) => randomBytes(n));
  let list: FriendsList | null = null;
  let problem: string | null = null;
  let prefill: string | null = null;
  let refreshing: Promise<void> | null = null;
  let lastUpload: { key: string; at: number } | null = null;
  let uploading = false;
  /** 시험용: 구글 연결 여부를 바꿔 끼운다 (JJ_TEST_SECRETS=memory 일 때만 server.ts 가 연다) */
  let linkedOverride: boolean | null = null;

  const status = () => d.core()?.status();
  const linked = () => linkedOverride ?? d.calendarLinked();

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
        s?.features?.friend_gift_admin_passes === true &&
        s.age === 'adult' &&
        s.ai,
      calendar: on && s?.features?.friend_calendar === true,
      calendarLinked: linked(),
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
      // 구글 연결을 끊었으면 서버에서도 모두 끄고 지운다
      if (!s.calendarLinked) {
        const r = await call((api, t) => api.busyStop(t));
        d.log('friends', '구글 연결이 없어 일정 공유를 모두 끔', r.ok ? 'ok' : r.error);
        lastUpload = null;
        await refresh();
        return;
      }
      if (!s.calendar) return;
      const now = d.now();
      const blocks = busyBlocks(d.events(now, now + BUSY_DAYS * 86_400_000), now);
      const key = JSON.stringify(blocks);
      if (!force && lastUpload && lastUpload.key === key && now - lastUpload.at < BUSY_REFRESH_MS) return;
      const r = await call<{ stored: number }>((api, t) => api.busyUpload(t, blocks));
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

  return {
    available,
    state,
    refresh,
    uploadBusy,
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
    /** 이 친구에게 바쁜 시간 보여 주기. 켜면 바로 올린다 (구글 일정이 연결돼 있을 때만 켤 수 있다) */
    async share(code: string, on: boolean): Promise<FriendResult> {
      if (on && !linked()) return { ok: false, error: 'not_linked' };
      const r = await act(on ? '일정 공유 켬' : '일정 공유 끔', (api, t) => api.friendShare(t, code, on));
      if (r.ok && on) await uploadBusy(true);
      return r;
    },
    async busy(code: string): Promise<FriendResult<{ blocks: BusyBlock[]; updatedAt: string | null }>> {
      const r = await call<{ blocks: BusyBlock[]; updatedAt: string | null }>((api, t) =>
        api.friendBusy(t, code),
      );
      if (!r.ok) return { ok: false, error: errorOf(r) };
      return { ok: true, data: r.data };
    },
    /** 시험용 */
    debugLinked(v: boolean | null) {
      linkedOverride = v;
      changed();
    },
  };
}

export type ServerFriends = ReturnType<typeof createServerFriends>;
