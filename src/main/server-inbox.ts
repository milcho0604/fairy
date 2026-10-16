// 서버 쪽지함 (이슈 #101): 운영자가 보낸 쪽지(개인 지급, 알림)와 정기 지급의 달마다 쪽지. 쪽지는 서버 DB 에 있어
// 같은 계정의 모든 기기가 같은 것을 보고, 연 쪽지도 "열림" 으로 남는다. 첨부(코인, 채팅 이용권)는 열 때 받는다.
// 매일 쪽지(main/daily-note.ts)와 같은 길로 보인다: 펫이 쪽지를 들고 와 누르면 펼치고, 패널 쪽지함에 섞여 보인다
// (출처 "운영자" 표시). 서버 모드가 아니면(만 14세 미만, 서버 주소 없음) 아무것도 하지 않는다.
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import type { NoteView } from '../shared/note-ipc.ts';
import type { SayOptions } from './pet-window.ts';
import type { InboxItem } from './server-api.ts';
import type { ServerCore } from './server-core.ts';

/** 쪽지 번호를 쪽지함 열쇠로 (매일 쪽지의 날짜 자리를 같이 쓴다) */
export const inboxKey = (id: number) => `inbox:${id}`;
const idOf = (key: string): number | undefined => {
  const m = /^inbox:(\d{1,15})$/.exec(key);
  return m ? Number(m[1]) : undefined;
};

/** 친구가 보낸 쪽지의 보낸 사람 이름 (닉네임, 없으면 기기 코드, 탈퇴했으면 "떠난 친구") */
const senderName = (i: InboxItem): string => i.sender?.nickname ?? i.sender?.code ?? t('inbox.leftFriend');

/** 쪽지 제목 */
export function inboxTitle(i: InboxItem): string {
  if (i.kind === 'gift') return t('inbox.giftTitle');
  if (i.kind === 'friend') return t('inbox.friendTitle');
  if (i.kind === 'gift_back') return t('inbox.giftBackTitle');
  return i.kind === 'subscription' ? t('inbox.subTitle') : t('inbox.title');
}

/** 쪽지 줄: 운영자 글, 첨부, 열었으면 받은 것. 친구 쪽지는 보낸 친구 (#110) */
export function inboxLines(i: InboxItem): string[] {
  const lines: string[] = [];
  if (i.kind === 'friend') {
    lines.push(t('inbox.friendLine', { name: senderName(i) }));
    if (i.expired) lines.push(t('inbox.expired'));
    return lines;
  }
  // 돌아온 선물: 양은 돌려줄 때 이미 넣었다 (열어도 더 받지 않는다)
  if (i.kind === 'gift_back')
    return [t('inbox.giftBackLine', { name: senderName(i), coins: i.coins, passes: i.chatPasses })];
  if (i.kind === 'gift') lines.push(t('inbox.fromFriend', { name: senderName(i) }));
  if (i.message) lines.push(i.message);
  if (i.kind === 'subscription')
    lines.push(i.fillTo ? t('inbox.subFill', { n: i.fillTo }) : t('inbox.subAdd', { n: i.chatPasses }));
  else if (i.coins > 0 || i.chatPasses > 0)
    lines.push(t('inbox.attach', { coins: i.coins, passes: i.chatPasses }));
  if (i.opened) lines.push(t('inbox.got', { coins: i.opened.coins, passes: i.opened.chatPasses }));
  else if (i.expired) lines.push(t('inbox.expired'));
  return lines;
}

export function inboxView(i: InboxItem): NoteView {
  return {
    day: inboxKey(i.id),
    look: 'note',
    title: inboxTitle(i),
    lines: inboxLines(i),
    read: !!i.opened || i.expired,
    source: 'server',
  };
}

export function createServerInbox(o: {
  core: () => ServerCore | undefined;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 말을 걸어도 되는 때 */
  canTalk: () => boolean;
  /** 쪽지함이 바뀌었다 (패널, 펫이 드는 쪽지) */
  onChange: () => void;
  /** 받은 코인이나 채팅 이용권이 생겼다 */
  onGot: () => void;
  /** 친구 신청 쪽지를 열었다 (#110): 설정의 친구 칸을 연다 */
  openFriends?: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let items: InboxItem[] = [];
  /** 이번 실행에서 펫이 들고 온다고 말한 쪽지 */
  const announced = new Set<number>();
  let refreshing: Promise<void> | null = null;

  const unopened = () => items.filter((i) => !i.opened && !i.expired);

  async function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    const run = async () => {
      try {
        const core = o.core();
        if (!core?.allowed()) {
          if (items.length) {
            items = [];
            o.onChange();
          }
          return;
        }
        const page = await core.inbox();
        if (!page) return;
        items = page.items;
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

  /** 쪽지 하나를 연다 (펫 누르기나 쪽지함). 받은 것을 펫이 쪽지 모양 말풍선으로 */
  async function open(key: string): Promise<void> {
    const id = idOf(key);
    const core = o.core();
    if (id === undefined || !core) return;
    const r = await core.openInbox(id);
    if (r.ok) {
      items = items.map((i) => (i.id === id ? r.data.item : i));
      o.onChange();
      o.onGot();
      o.react('happy');
      o.log('inbox', '열림', id, r.data.item.opened?.coins ?? 0, r.data.item.opened?.chatPasses ?? 0);
      const v = inboxView(r.data.item);
      if (r.data.item.kind === 'friend') o.openFriends?.();
      await o.say({
        kind: 'answer',
        text: `${v.title}\n\n${v.lines.join('\n')}`,
        paper: 'note',
        ttlMs: 30_000,
      });
      return;
    }
    o.log('inbox', '못 엶', id, r.status, r.error);
    await refresh();
    if (r.status === 410) await o.say({ kind: 'answer', text: t('inbox.expired'), ttlMs: 8000 });
    else if (r.status !== 409) await o.say({ kind: 'answer', text: t('inbox.failed'), ttlMs: 8000 });
  }

  /** 새 쪽지가 있으면 펫이 들고 와 알린다 (한 쪽지에 한 번) */
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
        { id: 'later', label: t('note.later') },
      ],
      ttlMs: 15_000,
    });
    const first = unopened()[0];
    if (a === 'open' && first) await open(inboxKey(first.id));
  }

  return {
    refresh,
    deliver,
    open,
    /** 패널 쪽지함에 섞을 것 (최근 것부터) */
    views: (): NoteView[] => items.map(inboxView),
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
