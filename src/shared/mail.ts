// 쪽지함 화면 모델 (feat/mailbox): 메인이 지금 말로 풀어 쓴 쪽지(MailItem)를 걸러 내고, 찾고, 날짜로 묶는다. 순수 함수만 둔다.
// 안 읽음 수(배지)는 "전체" 목록에 보이는 안 읽은 쪽지 수와 같다: 보관하거나 지운 쪽지는 세지 않는다 (배지 3, 보이는 새 쪽지 2 로 어긋나던 것)

import { plusDays, weekdayOf } from './day.ts';
import type { MailKind, MailSource } from './mail-store.ts';

export type MailFilter =
  | 'all'
  | 'unread'
  | 'letter'
  | 'operator'
  | 'friend'
  | 'notice'
  | 'archived'
  | 'trash';
export const MAIL_FILTERS: readonly MailFilter[] = [
  'all',
  'unread',
  'letter',
  'operator',
  'friend',
  'notice',
  'archived',
  'trash',
];

/** 화면에 보이는 쪽지 하나 (글은 지금 언어로 풀어 쓴 것) */
export interface MailItem {
  /** 쪽지 열쇠: 펫 쪽지는 날짜(저녁 쪽지는 날짜~e), 서버 쪽지는 inbox:번호, 공지는 notice:번호 */
  id: string;
  source: MailSource;
  kind: MailKind;
  /** 목록에 보이는 제목: 열기 전에 어떤 쪽지인지 알 수 있게 첫 줄이나 보상 요약을 담는다 */
  title: string;
  /** 제목 아래 한 줄 (본문 첫 줄) */
  preview: string;
  lines: string[];
  look: 'note' | 'letter';
  read: boolean;
  archived: boolean;
  pinned: boolean;
  deleted: boolean;
  /** 받은 시각 (ms)과 날짜 (현지) */
  at: number;
  day: string;
  coins?: number;
  /** 보낸 쪽 이름 ("운영자", 친구 닉네임). 펫 쪽지는 없다 */
  from?: string;
  /** 공지의 바깥 링크 (열쇠가 아닌 주소) */
  link?: string;
  /** 지우거나 보관해도 되는가: 받을 것(코인, 이용권)이 남은 안 연 서버 쪽지, 답 안 한 친구 신청은 안 된다 */
  removable: boolean;
}

export interface MailBox {
  /** 매일 쪽지 설정이 켜져 있다 */
  on: boolean;
  items: MailItem[];
  /** "전체" 목록의 안 읽은 쪽지 수 (배지, 머리줄 점, 사이드바 숫자) */
  unread: number;
  /** 서버에 더 오래된 쪽지가 있다 (더 불러오기) */
  hasMore: boolean;
  /** 휴지통에 든 수 */
  trash: number;
}

type Group = Exclude<MailFilter, 'all' | 'unread' | 'archived' | 'trash'>;

/** 종류가 속한 묶음 (필터 칩) */
export const GROUP_OF: Record<MailKind, Group> = {
  daily: 'letter',
  letter: 'letter',
  week: 'letter',
  evening: 'letter',
  grant: 'operator',
  notice: 'operator',
  subscription: 'operator',
  gift: 'friend',
  friend: 'friend',
  gift_back: 'friend',
  announce: 'notice',
};

/** 보관도 지움도 아닌 쪽지 ("전체" 목록) */
const live = (m: MailItem) => !m.deleted && !m.archived;

export function inFilter(m: MailItem, f: MailFilter): boolean {
  switch (f) {
    case 'all':
      return live(m);
    case 'unread':
      return live(m) && !m.read;
    case 'archived':
      return m.archived && !m.deleted;
    case 'trash':
      return m.deleted;
    default:
      return live(m) && GROUP_OF[m.kind] === f;
  }
}

/** 안 읽음 수: "전체" 목록에 보이는 안 읽은 쪽지 */
export const unreadCount = (items: readonly MailItem[]): number =>
  items.filter((m) => live(m) && !m.read).length;

/** 칩마다 몇 개인지 (칩 옆 숫자) */
export function countsOf(items: readonly MailItem[]): Record<MailFilter, number> {
  const out = Object.fromEntries(MAIL_FILTERS.map((f) => [f, 0])) as Record<MailFilter, number>;
  for (const m of items) for (const f of MAIL_FILTERS) if (inFilter(m, f)) out[f]++;
  return out;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase();

/** 찾기: 제목과 본문 줄에서 (대소문자, 풀린 한글을 가리지 않는다). 빈 검색어면 그대로 */
export function searchMail(items: readonly MailItem[], query: string): MailItem[] {
  const q = norm(query.trim());
  if (!q) return [...items];
  return items.filter((m) => norm(`${m.title}\n${m.lines.join('\n')}`).includes(q));
}

/** 고정한 것이 먼저, 그다음 받은 시각 최근 것이 앞 */
export function sortMail(items: readonly MailItem[]): MailItem[] {
  return [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at || b.id.localeCompare(a.id),
  );
}

export type MailGroupId = 'pinned' | 'today' | 'week' | 'month' | 'older';

/** 날짜로 묶는다: 고정, 오늘, 이번 주(월요일부터), 이번 달, 이전. 비어 있는 묶음은 없다. today 는 현지 오늘 YYYY-MM-DD */
export function groupMail(
  items: readonly MailItem[],
  today: string,
): { id: MailGroupId; items: MailItem[] }[] {
  const monday = plusDays(today, -((weekdayOf(today) + 6) % 7));
  const out: Record<MailGroupId, MailItem[]> = { pinned: [], today: [], week: [], month: [], older: [] };
  for (const m of sortMail(items)) {
    const id: MailGroupId = m.pinned
      ? 'pinned'
      : m.day >= today
        ? 'today'
        : m.day >= monday
          ? 'week'
          : m.day.slice(0, 7) === today.slice(0, 7)
            ? 'month'
            : 'older';
    out[id].push(m);
  }
  return (['pinned', 'today', 'week', 'month', 'older'] as const)
    .map((id) => ({ id, items: out[id] }))
    .filter((g) => g.items.length > 0);
}

/** 본문 첫 줄 (목록 미리보기용, 한 줄로 줄이고 길면 자른다) */
export function firstLine(lines: readonly string[], max = 40): string {
  const one = (lines.find((l) => l.trim()) ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...one];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : one;
}
