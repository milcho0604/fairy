// 쪽지함 한 줄을 지금 말로 풀어 쓴다 (feat/mailbox). 저장된 쪽지(shared/mail-store.ts MailRow)를 화면 모델(shared/mail.ts MailItem)로.
// 펫 쪽지는 사전 열쇠와 값에서 지금 언어와 지금 말투로, 서버 쪽지는 받아 둔 원본에서, 공지는 두 언어 글에서 고른다.
import type { NoteLine } from '../shared/daily-note.ts';
import { getLang, t } from '../shared/i18n/index.ts';
import { firstLine, type MailItem } from '../shared/mail.ts';
import type { MailRow } from '../shared/mail-store.ts';
import { allowedLink } from '../shared/notices.ts';
import { styled } from '../shared/persona-voice.ts';
import { type InboxItem, inboxItemOf } from './server-api.ts';

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

/** 서버 쪽지 제목에 넣는 요약의 길이 */
const WHAT_MAX = 24;

/** 친구가 보낸 쪽지의 보낸 사람 이름 (닉네임, 없으면 기기 코드, 탈퇴했으면 "떠난 친구") */
export const senderName = (i: InboxItem): string =>
  i.sender?.nickname ?? i.sender?.code ?? t('inbox.leftFriend');

/** 첨부(코인, 이용권)가 있는가 */
const hasAttach = (i: InboxItem): boolean => i.coins > 0 || i.chatPasses > 0;

/**
 * 서버 쪽지 제목: 종류와 첫 줄 또는 들어 있는 것 요약. 열기 전에도 어떤 쪽지인지 알 수 있다
 * ("운영자 지급: 이벤트 보상 안내", "운영자 지급: 코인 10개", "친구 선물: 코인 5개", "친구 신청: 밀크")
 */
export function serverTitle(i: InboxItem): string {
  const kind = t(`mail.kind.${i.kind}`);
  let what = '';
  if (i.kind === 'friend') what = senderName(i);
  else if (i.kind === 'gift_back') what = senderName(i);
  else if (i.kind === 'subscription')
    what = i.fillTo ? t('mail.subWhat', { n: i.fillTo }) : t('mail.subWhat', { n: i.chatPasses });
  else {
    what = firstLine((i.message ?? '').split(/\r?\n/), WHAT_MAX);
    if (!what && hasAttach(i)) what = t('mail.reward', { coins: i.coins, passes: i.chatPasses });
    if (i.kind === 'gift' && what && i.message === null) what = `${what} (${senderName(i)})`;
  }
  return what ? t('mail.titleWith', { kind, what }) : kind;
}

/** 서버 쪽지 줄: 운영자 글, 첨부, 열었으면 받은 것(받은 것이 0이면 말하지 않는다). 친구 쪽지는 보낸 친구 */
export function serverLines(i: InboxItem): string[] {
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
  else if (hasAttach(i)) lines.push(t('inbox.attach', { coins: i.coins, passes: i.chatPasses }));
  if (i.opened) {
    // 받은 것이 없으면 "받았어: 코인 0개, 채팅 이용권 0장" 을 붙이지 않는다 (알림형 쪽지)
    if (i.opened.coins > 0 || i.opened.chatPasses > 0)
      lines.push(t('inbox.got', { coins: i.opened.coins, passes: i.opened.chatPasses }));
  } else if (i.expired) lines.push(t('inbox.expired'));
  return lines;
}

/**
 * 읽은 쪽지인가. 받을 것이 있는 쪽지는 서버에서 열어야 읽은 것(받아야 하니까)이고,
 * 받을 것이 없는 알림은 이 기기에서 읽음으로 표시해도 된다
 */
export function serverRead(i: InboxItem, row: Pick<MailRow, 'readAt'>): boolean {
  if (i.opened || i.expired) return true;
  return !hasAttach(i) && i.kind !== 'friend' && row.readAt !== null;
}

/** 지우거나 보관해도 되는가: 받을 것이 남은 안 연 쪽지와 답 안 한 친구 신청은 안 된다 */
export function serverRemovable(i: InboxItem): boolean {
  if (i.opened || i.expired) return true;
  return !hasAttach(i) && i.kind !== 'friend';
}

function localLines(payload: unknown): NoteLine[] {
  const raw = (payload as { lines?: unknown } | null)?.lines;
  const out: NoteLine[] = [];
  for (const l of Array.isArray(raw) ? raw : []) {
    if (typeof l !== 'object' || l === null) continue;
    const { key, vars } = l as { key?: unknown; vars?: unknown };
    if (typeof key !== 'string' || !key.startsWith('note.')) continue;
    out.push(
      typeof vars === 'object' && vars !== null
        ? { key, vars: vars as Record<string, string | number> }
        : { key },
    );
  }
  return out;
}

const flags = (row: MailRow) => ({
  archived: row.archivedAt !== null,
  pinned: row.pinnedAt !== null,
  deleted: row.deletedAt !== null,
});

/** 쪽지 하나를 지금 말로 풀어 쓴다 */
export function mailItemOf(row: MailRow): MailItem {
  const base = {
    id: row.id,
    source: row.source,
    kind: row.kind,
    look: row.look,
    at: row.at,
    day: row.day,
    ...flags(row),
  };
  if (row.source === 'server') {
    const i = inboxItemOf(row.payload);
    const lines = i ? serverLines(i) : [];
    return {
      ...base,
      title: i ? serverTitle(i) : t(`mail.kind.${row.kind}`),
      preview: firstLine(lines),
      lines,
      read: i ? serverRead(i, row) : row.readAt !== null,
      removable: i ? serverRemovable(i) : true,
      canUnread: !(i && (i.opened || i.expired)),
      from:
        i && (i.kind === 'gift' || i.kind === 'friend' || i.kind === 'gift_back')
          ? senderName(i)
          : t('inbox.from'),
      ...(i && !i.opened && !i.expired && hasAttach(i) && i.kind !== 'subscription'
        ? { coins: i.coins }
        : {}),
    };
  }
  if (row.source === 'notice') {
    const p = (row.payload ?? {}) as {
      title?: { ko?: string; en?: string };
      body?: { ko?: string; en?: string };
      link?: string;
    };
    const lang = getLang();
    const title = p.title?.[lang] ?? p.title?.ko ?? '';
    const body = p.body?.[lang] ?? p.body?.ko ?? '';
    const lines = body.split(/\r?\n/).filter((l) => l.trim());
    const link = allowedLink(p.link);
    return {
      ...base,
      title: title
        ? t('mail.titleWith', { kind: t('mail.kind.announce'), what: title })
        : t('mail.kind.announce'),
      preview: firstLine(lines),
      lines,
      read: row.readAt !== null,
      removable: true,
      canUnread: true,
      ...(link ? { link } : {}),
    };
  }
  // 이 컴퓨터에서 만든 펫 쪽지
  const [, m, d] = row.day.split('-').map(Number);
  const date = { m: m ?? 1, d: d ?? 1 };
  const title = row.milestone
    ? t('note.letterTitle', { n: row.milestone })
    : row.kind === 'week'
      ? t('note.weekTitle', date)
      : row.kind === 'evening'
        ? t('note.eveningTitle', date)
        : t('note.title', date);
  // 프리셋 말투, 내 말투면 지금 말투 규칙을 입힌다
  const lines = localLines(row.payload).map((l) => styled(looseT(l.key, l.vars)));
  return {
    ...base,
    title,
    preview: firstLine(lines),
    lines,
    read: row.readAt !== null,
    // 코인을 아직 안 준 특별한 편지는 지우거나 보관하지 못한다 (안 읽은 채 지워 코인을 못 받는 일을 막는다)
    removable: !(row.coins && row.coinsPaidAt === null),
    canUnread: true,
    from: t('mail.fromPet'),
    ...(row.coins ? { coins: row.coins } : {}),
  };
}
