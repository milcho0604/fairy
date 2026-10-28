// 서버 쪽지함 (이슈 #101): 운영자가 보낸 쪽지(개인 지급, 알림)와 정기 지급의 달마다 쪽지, 친구 선물과 신청. 쪽지는 서버 DB 에 있어
// 같은 계정의 모든 기기가 같은 것을 보고, 연 쪽지도 "열림" 으로 남는다. 첨부(코인, 채팅 이용권)는 열 때 받는다.
// 받은 쪽지는 이 컴퓨터의 쪽지함 표(shared/mail-store.ts)에 받은 그대로 담아 오프라인에서도 다시 읽는다. 쪽지함 화면은 펫 쪽지, 공지와
// 같은 표에서 그린다 (main/daily-note.ts, main/mail-view.ts). 서버가 한 번에 20통씩 주므로 더 오래된 쪽지는 이어 받는다 (loadMore).
// 펫이 쪽지를 들고 와 누르면 펼친다. 서버 모드가 아니면(만 14세 미만, 서버 주소 없음) 아무것도 하지 않고 담아 둔 서버 쪽지도 비운다.
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import type { MailStore } from '../shared/mail-store.ts';
import { localDay } from '../shared/todo-store.ts';
import { serverLines, serverTitle } from './mail-view.ts';
import type { SayOptions } from './pet-window.ts';
import type { InboxItem } from './server-api.ts';
import type { ServerCore } from './server-core.ts';

/** 쪽지 번호를 쪽지함 열쇠로 (펫 쪽지의 날짜 자리를 같이 쓴다) */
export const inboxKey = (id: number) => `inbox:${id}`;
const idOf = (key: string): number | undefined => {
  const m = /^inbox:(\d{1,15})$/.exec(key);
  return m ? Number(m[1]) : undefined;
};

export function createServerInbox(o: {
  core: () => ServerCore | undefined;
  /** 쪽지함 저장 (저장 파일의 mail 표) */
  mail: MailStore;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 말을 걸어도 되는 때 */
  canTalk: () => boolean;
  /** 쪽지함이 바뀌었다 (패널, 펫이 드는 쪽지) */
  onChange: () => void;
  /** 받은 코인이나 채팅 이용권이 생겼다 */
  onGot: () => void;
  /** 쪽지함을 연다 (쪽지 말풍선의 "쪽지함 열기" 단추) */
  openMailbox?: () => void;
  /** 친구 신청 쪽지를 열었다 (#110): 설정의 친구 칸을 연다 */
  openFriends?: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  /** 이 기기가 아는 서버 쪽지들 (최근 것부터). 첫 쪽과 더 받은 오래된 쪽을 합친 것 */
  let items: InboxItem[] = [];
  /** 첫 쪽 뒤로 더 받은 오래된 쪽지 */
  let older: InboxItem[] = [];
  /** 더 오래된 쪽지를 받을 때 넘기는 번호. 더 없으면 null */
  let next: number | null = null;
  /** 이번 실행에서 펫이 들고 온다고 말한 쪽지 */
  const announced = new Set<number>();
  let refreshing: Promise<void> | null = null;
  let loadingMore = false;

  const unopened = () => items.filter((i) => !i.opened && !i.expired);

  /** 받은 쪽지를 쪽지함 표에 담는다 (이미 있으면 내용만 바꾸고 이 기기의 읽음, 보관, 지움은 그대로) */
  function store(list: readonly InboxItem[]) {
    for (const i of list) {
      const sent = Date.parse(i.sentAt);
      const at = Number.isFinite(sent) ? sent : Date.now();
      o.mail.put({
        id: inboxKey(i.id),
        source: 'server',
        kind: i.kind,
        day: localDay(at),
        at,
        look: 'note',
        milestone: null,
        coins: i.coins > 0 ? i.coins : null,
        payload: i,
        readAt: null,
      });
    }
  }

  const merge = (first: readonly InboxItem[], rest: readonly InboxItem[]): InboxItem[] => {
    const seen = new Set(first.map((i) => i.id));
    return [...first, ...rest.filter((i) => !seen.has(i.id))];
  };

  async function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    const run = async () => {
      try {
        const core = o.core();
        if (!core?.allowed()) {
          // 서버 모드가 아니면(로그아웃, 만 14세 미만) 담아 둔 서버 쪽지도 비운다: 다른 계정 쪽지가 남아 보이지 않게
          const dropped = o.mail.dropServerNotIn(new Set(), 0);
          if (items.length > 0 || older.length > 0 || dropped > 0) {
            items = [];
            older = [];
            next = null;
            o.onChange();
          }
          return;
        }
        const page = await core.inbox();
        if (!page) return;
        store(page.items);
        // 서버가 이미 정리한 쪽지(1년 지남)는 이 기기에서도 비운다: 첫 쪽이 가리키는 범위(첫 쪽의 가장 오래된 쪽지 이후)에서만 본다
        const oldest = page.items.reduce(
          (m, i) => Math.min(m, Date.parse(i.sentAt) || Number.POSITIVE_INFINITY),
          Number.POSITIVE_INFINITY,
        );
        o.mail.dropServerNotIn(
          new Set(page.items.map((i) => inboxKey(i.id))),
          page.next === null || !Number.isFinite(oldest) ? 0 : oldest,
        );
        // 첫 쪽이 이어 받던 오래된 쪽과 겹치면 오래된 쪽의 겹친 부분은 첫 쪽 것으로
        items = merge(page.items, older);
        if (older.length === 0) next = page.next;
        o.onChange();
      } catch (err) {
        o.log('inbox', '받기 실패', err instanceof Error ? err.message : String(err));
      }
    };
    // 바로 끝나도(서버 모드가 아닌 때) 대입이 먼저다 (#110 에서 찾음): finally 를 IIFE 안에 두면 끝난 약속이 refreshing 에
    // 남아, 서버 모드를 켜기 전에 한 번 불린 뒤로는 쪽지함을 다시 받지 않았다
    refreshing = run().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** 더 오래된 쪽지를 한 쪽(20통) 더 받는다. 서버에 더 없으면 아무것도 안 한다 */
  async function loadMore(): Promise<void> {
    if (loadingMore || next === null) return;
    loadingMore = true;
    try {
      const core = o.core();
      if (!core?.allowed()) return;
      const page = await core.inbox(next);
      if (!page) return;
      store(page.items);
      older = merge(older, page.items);
      items = merge(items, page.items);
      next = page.next;
      o.onChange();
    } catch (err) {
      o.log('inbox', '더 받기 실패', err instanceof Error ? err.message : String(err));
    } finally {
      loadingMore = false;
    }
  }

  /** 쪽지 하나를 연다 (펫 누르기나 쪽지함). 받은 것을 펫이 쪽지 모양 말풍선으로 (quiet 이면 말풍선 없이) */
  async function open(key: string, quiet = false): Promise<void> {
    const id = idOf(key);
    const core = o.core();
    if (id === undefined || !core) return;
    const r = await core.openInbox(id);
    if (r.ok) {
      items = items.map((i) => (i.id === id ? r.data.item : i));
      older = older.map((i) => (i.id === id ? r.data.item : i));
      store([r.data.item]);
      o.onChange();
      o.onGot();
      o.log('inbox', '열림', id, r.data.item.opened?.coins ?? 0, r.data.item.opened?.chatPasses ?? 0);
      if (quiet) return;
      o.react('happy');
      if (r.data.item.kind === 'friend') o.openFriends?.();
      await o.say({
        kind: 'answer',
        text: `${serverTitle(r.data.item)}\n\n${serverLines(r.data.item).join('\n')}`,
        paper: 'note',
        ttlMs: 30_000,
      });
      return;
    }
    o.log('inbox', '못 엶', id, r.status, r.error);
    await refresh();
    if (quiet) return;
    if (r.status === 410)
      await o.say({
        kind: 'answer',
        text: t(r.error === 'ineligible' ? 'inbox.ineligible' : 'inbox.expired'),
        ttlMs: 8000,
      });
    else if (r.status !== 409) await o.say({ kind: 'answer', text: t('inbox.failed'), ttlMs: 8000 });
  }

  /** 새 쪽지가 있으면 펫이 들고 와 알린다 (한 쪽지에 한 번). "펼쳐 보기"와 "쪽지함 열기" 단추가 있다 */
  async function deliver(): Promise<void> {
    await refresh();
    const fresh = unopened().filter((i) => !announced.has(i.id));
    if (fresh.length === 0 || !o.canTalk()) return;
    for (const i of fresh) announced.add(i.id);
    const a = await o.say({
      kind: 'system',
      text: t('inbox.bring', { n: unopened().length }),
      buttons: [
        { id: 'open', label: t('note.openNow') },
        ...(o.openMailbox ? [{ id: 'mailbox', label: t('mail.bringOpen') }] : []),
        { id: 'later', label: t('note.later') },
      ],
      ttlMs: 15_000,
    });
    const first = unopened()[0];
    if (a === 'open' && first) await open(inboxKey(first.id));
    else if (a === 'mailbox') o.openMailbox?.();
  }

  return {
    refresh,
    deliver,
    open,
    loadMore,
    /** 서버에 더 오래된 쪽지가 있다 */
    hasMore: () => next !== null,
    /** 펫이 들고 있을 쪽지가 있다 */
    holding: () => unopened().length > 0,
    /** 펫을 눌렀을 때 펼칠 쪽지 */
    openNext: async () => {
      const first = unopened()[0];
      if (first) await open(inboxKey(first.id));
    },
    isKey: (key: string) => idOf(key) !== undefined,
    get items() {
      return items;
    },
  };
}

export type ServerInbox = ReturnType<typeof createServerInbox>;
