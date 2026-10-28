import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate } from '../shared/db-schema.ts';
import { setLang } from '../shared/i18n/index.ts';
import { isPurged, type MailRow, MailStore } from '../shared/mail-store.ts';
import { mailItemOf, serverLines, serverRead, serverRemovable, serverTitle } from './mail-view.ts';
import type { InboxItem, InboxPage } from './server-api.ts';
import type { ServerCore } from './server-core.ts';
import { createServerInbox, inboxKey } from './server-inbox.ts';

const memoryMail = () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return new MailStore(db);
};

const item = (over: Partial<InboxItem> & { id: number }): InboxItem => ({
  kind: 'grant',
  sender: null,
  message: null,
  coins: 0,
  chatPasses: 0,
  fillTo: null,
  sentAt: `2026-10-${String(10 + (over.id % 15)).padStart(2, '0')}T00:00:00Z`,
  expiresAt: null,
  openedAt: null,
  opened: null,
  expired: false,
  ...over,
});

const serverRow = (i: InboxItem, over: Partial<MailRow> = {}): MailRow => ({
  id: inboxKey(i.id),
  source: 'server',
  kind: i.kind,
  day: '2026-10-28',
  at: Date.parse(i.sentAt),
  look: 'note',
  milestone: null,
  coins: i.coins || null,
  payload: i,
  readAt: null,
  archivedAt: null,
  deletedAt: null,
  pinnedAt: null,
  coinsPaidAt: null,
  ...over,
});

test('서버 쪽지 제목: 종류와 첫 줄이나 들어 있는 것 (열기 전에 구분된다)', () => {
  setLang('ko');
  assert.equal(
    serverTitle(item({ id: 1, message: '이벤트 보상 안내\n자세한 내용은 아래' })),
    '운영자 지급: 이벤트 보상 안내',
  );
  assert.equal(serverTitle(item({ id: 2, coins: 10 })), '운영자 지급: 코인 10개');
  assert.equal(
    serverTitle(item({ id: 3, coins: 10, chatPasses: 2 })),
    '운영자 지급: 코인 10개, 채팅 이용권 2장',
  );
  assert.equal(serverTitle(item({ id: 4, kind: 'notice', message: '점검 안내' })), '운영자 알림: 점검 안내');
  assert.equal(serverTitle(item({ id: 5, kind: 'subscription', fillTo: 5 })), '정기 지급: 채팅 이용권 5장');
  assert.equal(
    serverTitle(item({ id: 6, kind: 'subscription', chatPasses: 3 })),
    '정기 지급: 채팅 이용권 3장',
  );
  assert.equal(
    serverTitle(item({ id: 7, kind: 'friend', sender: { code: 'F-1', nickname: '밀크' } })),
    '친구 신청: 밀크',
  );
  assert.equal(
    serverTitle(item({ id: 8, kind: 'gift_back', sender: { code: null, nickname: null } })),
    '돌아온 선물: 떠난 친구',
  );
  // 긴 첫 줄은 자른다
  const long = serverTitle(item({ id: 9, message: '가'.repeat(80) }));
  assert.ok([...long].length < 40 && long.endsWith('…'), long);
  // 아무것도 없으면 종류만
  assert.equal(serverTitle(item({ id: 10 })), '운영자 지급');
  setLang('en');
  assert.equal(
    serverTitle(item({ id: 11, coins: 5, chatPasses: 1 })),
    'Operator gift: 5 coins, 1 chat passes',
  );
  setLang('ko');
});

test('서버 쪽지 줄: 받은 것이 0이면 "받았어" 줄이 없다 (알림형 쪽지)', () => {
  setLang('ko');
  const notice = item({ id: 1, kind: 'notice', message: '점검이 있어', opened: { coins: 0, chatPasses: 0 } });
  assert.deepEqual(serverLines(notice), ['점검이 있어']);
  const grant = item({ id: 2, coins: 10, message: '보상', opened: { coins: 10, chatPasses: 0 } });
  const lines = serverLines(grant);
  assert.equal(lines.length, 3);
  assert.ok(lines.at(-1)?.includes('받았어'), lines.join('|'));
  // 안 연 지급은 들어 있는 것만
  assert.ok(serverLines(item({ id: 3, coins: 10 })).some((l) => l.includes('들어 있는 것')));
  // 기한 지난 안 연 쪽지
  assert.ok(serverLines(item({ id: 4, coins: 10, expired: true })).some((l) => l.includes('기한')));
  setLang('en');
  assert.ok(!serverLines(notice).some((l) => /Received/.test(l)));
  setLang('ko');
});

test('읽음과 지울 수 있는지: 받을 것이 남은 안 연 쪽지, 답 안 한 친구 신청은 안 된다', () => {
  const row = { readAt: null as number | null };
  const marked = { readAt: 5 };
  // 받을 것이 없는 알림은 이 기기에서 읽음으로 표시해도 읽은 것
  const notice = item({ id: 1, kind: 'notice', message: 'a' });
  assert.equal(serverRead(notice, row), false);
  assert.equal(serverRead(notice, marked), true);
  assert.equal(serverRemovable(notice), true);
  // 받을 것이 있는 쪽지는 서버에서 열어야 읽은 것
  const grant = item({ id: 2, coins: 5 });
  assert.equal(serverRead(grant, marked), false);
  assert.equal(serverRemovable(grant), false);
  assert.equal(serverRead({ ...grant, opened: { coins: 5, chatPasses: 0 } }, row), true);
  assert.equal(serverRemovable({ ...grant, opened: { coins: 5, chatPasses: 0 } }), true);
  assert.equal(serverRemovable({ ...grant, expired: true }), true);
  // 친구 신청: 열기 전에는 안 된다
  const friend = item({ id: 3, kind: 'friend', sender: { code: 'F-1', nickname: '밀크' } });
  assert.equal(serverRemovable(friend), false);
  assert.equal(serverRead(friend, marked), false);
  assert.equal(serverRemovable({ ...friend, opened: { coins: 0, chatPasses: 0 } }), true);
});

test('쪽지 행을 화면 모델로: 펫 쪽지, 서버 쪽지, 공지', () => {
  setLang('ko');
  const local: MailRow = {
    id: '2026-10-28',
    source: 'local',
    kind: 'daily',
    day: '2026-10-28',
    at: 1,
    look: 'note',
    milestone: null,
    coins: null,
    payload: { lines: [{ key: 'note.open', vars: { p: 'friend', v: 1 } }, { key: 'weird.key' }, 'junk'] },
    readAt: null,
    archivedAt: null,
    deletedAt: null,
    pinnedAt: 9,
    coinsPaidAt: null,
  };
  const a = mailItemOf(local);
  assert.equal(a.title, '10월 28일 쪽지');
  assert.equal(a.lines.length, 1, '쪽지 줄이 아닌 열쇠와 깨진 줄은 버린다');
  assert.equal(a.preview, a.lines[0]);
  assert.equal(a.read, false);
  assert.equal(a.pinned, true);
  assert.equal(a.removable, true);
  assert.equal(
    mailItemOf({ ...local, kind: 'letter', look: 'letter', milestone: 7, coins: 5 }).title,
    '함께한 7일 편지',
  );
  assert.equal(mailItemOf({ ...local, kind: 'week' }).title, '10월 28일 주간 편지');
  assert.equal(mailItemOf({ ...local, kind: 'evening', id: '2026-10-28~e' }).title, '10월 28일 저녁 쪽지');
  assert.equal(mailItemOf({ ...local, readAt: 3 }).read, true);

  const s = mailItemOf(serverRow(item({ id: 7, message: '보상이야', coins: 10 })));
  assert.equal(s.source, 'server');
  assert.equal(s.title, '운영자 지급: 보상이야');
  assert.equal(s.read, false);
  assert.equal(s.removable, false);
  assert.equal(s.coins, 10);
  assert.equal(s.from, '운영자');

  const n = mailItemOf({
    ...local,
    id: 'notice:x',
    source: 'notice',
    kind: 'announce',
    payload: {
      title: { ko: '점검 안내', en: 'Maintenance' },
      body: { ko: '내일 점검\n오전 두 시간', en: 'Tomorrow' },
      link: 'https://fairy.moilga.com/x',
    },
  });
  assert.equal(n.title, '공지: 점검 안내');
  assert.deepEqual(n.lines, ['내일 점검', '오전 두 시간']);
  assert.equal(n.link, 'https://fairy.moilga.com/x');
  setLang('en');
  assert.equal(
    mailItemOf({
      ...local,
      id: 'notice:x',
      source: 'notice',
      kind: 'announce',
      payload: { title: { ko: '가', en: 'Maintenance' }, body: { ko: '가', en: 'Tomorrow' } },
    }).title,
    'Notice: Maintenance',
  );
  setLang('ko');
  // 허용하지 않는 링크는 빠진다
  assert.equal(
    mailItemOf({
      ...local,
      id: 'notice:y',
      source: 'notice',
      kind: 'announce',
      payload: { title: { ko: 't', en: 't' }, body: { ko: 'b', en: 'b' }, link: 'javascript:alert(1)' },
    }).link,
    undefined,
  );
  // 깨진 서버 원본도 목록은 그린다
  assert.equal(mailItemOf({ ...serverRow(item({ id: 1 })), payload: { junk: true } }).title, '운영자 지급');
});

/** 서버 코어 흉내: 쪽지 쪽 (쪽마다 20통) */
function fakeCore(total: number) {
  const all = Array.from({ length: total }, (_, k) =>
    item({
      id: total - k,
      message: `쪽지 ${total - k}`,
      sentAt: new Date(Date.UTC(2026, 9, 1) + (total - k) * 3_600_000).toISOString(),
    }),
  );
  const state = { allowed: true, account: 'A', calls: [] as (number | undefined)[], opened: [] as number[] };
  const core = {
    allowed: () => state.allowed,
    accountKey: () => state.account,
    inbox: async (before?: number): Promise<InboxPage> => {
      state.calls.push(before);
      const rest = before === undefined ? all : all.filter((i) => i.id < before);
      const items = rest.slice(0, 20);
      return { items, next: rest.length > 20 ? (items.at(-1)?.id ?? null) : null, unopened: all.length };
    },
    openInbox: async (id: number) => {
      state.opened.push(id);
      const found = all.find((i) => i.id === id) as InboxItem;
      return {
        ok: true as const,
        data: { item: { ...found, opened: { coins: 0, chatPasses: 0 } }, balance: 0, chatPasses: 0 },
      };
    },
  };
  return { core: core as unknown as ServerCore, state, all };
}

const make = (f: ReturnType<typeof fakeCore>, over: Record<string, unknown> = {}) => {
  const mail = memoryMail();
  const said: { text?: string; buttons?: { id: string; label: string }[] }[] = [];
  const log: string[] = [];
  const inbox = createServerInbox({
    core: () => f.core,
    mail,
    say: async (s) => {
      said.push(s);
      return undefined;
    },
    react: () => {},
    canTalk: () => true,
    onChange: () => log.push('change'),
    onGot: () => {},
    log: () => {},
    ...over,
  });
  return { mail, said, inbox, log };
};

test('서버 쪽지가 21통 넘어도 이어 받아 모두 읽을 수 있다 (쪽지함 20통 한계)', async () => {
  const f = fakeCore(45);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  assert.equal(mail.all().filter((r) => r.source === 'server').length, 20);
  assert.equal(inbox.hasMore(), true);
  await inbox.loadMore();
  assert.equal(mail.all().filter((r) => r.source === 'server').length, 40);
  assert.equal(inbox.hasMore(), true);
  await inbox.loadMore();
  assert.equal(mail.all().filter((r) => r.source === 'server').length, 45);
  assert.equal(inbox.hasMore(), false);
  await inbox.loadMore();
  assert.equal(f.state.calls.length, 3, '더 없으면 서버를 안 부른다');
  // 가장 오래된 쪽지(1번)도 담겼다
  assert.ok(mail.get(inboxKey(1)));
  assert.deepEqual(f.state.calls, [undefined, 26, 6]);
  // 다시 첫 쪽을 받아도 이어 받은 쪽지가 사라지지 않는다
  await inbox.refresh();
  assert.equal(mail.all().filter((r) => r.source === 'server').length, 45);
  assert.equal(inbox.items.length, 45);
  assert.equal(inbox.hasMore(), false, '이어 받은 뒤에는 처음 받은 쪽의 다음 번호로 되돌아가지 않는다');
});

test('받아 둔 쪽지는 이 기기의 읽음, 보관, 지움을 지킨다 (다시 받아도)', async () => {
  const f = fakeCore(3);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  mail.setRead(inboxKey(2), 77);
  mail.setArchived(inboxKey(1), 88);
  mail.setDeleted(inboxKey(3), 99);
  await inbox.refresh();
  assert.equal(mail.get(inboxKey(2))?.readAt, 77);
  assert.equal(mail.get(inboxKey(1))?.archivedAt, 88);
  assert.equal(mail.get(inboxKey(3))?.deletedAt, 99);
});

test('서버가 정리해 목록에서 사라진 쪽지는 이 기기에서도 비운다', async () => {
  const f = fakeCore(5);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  assert.equal(mail.all().length, 5);
  f.all.splice(0, 1); // 5번이 서버에서 사라졌다
  await inbox.refresh();
  assert.equal(mail.get(inboxKey(5)), undefined);
  assert.equal(mail.all().length, 4);
});

test('서버 모드가 아니게 되면(로그아웃, 만 14세 미만) 담아 둔 서버 쪽지를 비운다. 펫 쪽지는 그대로', async () => {
  const f = fakeCore(3);
  const { mail, inbox } = make(f);
  mail.put({
    id: '2026-10-28',
    source: 'local',
    kind: 'daily',
    day: '2026-10-28',
    at: 1,
    look: 'note',
    milestone: null,
    coins: null,
    payload: { lines: [] },
  });
  await inbox.refresh();
  assert.equal(mail.all().length, 4);
  f.state.allowed = false;
  await inbox.refresh();
  assert.deepEqual(
    mail.all().map((r) => r.id),
    ['2026-10-28'],
  );
  assert.equal(inbox.hasMore(), false);
});

test('쪽지함에서 읽을 때(quiet)는 말풍선이 없고, 펫을 누를 때는 말풍선과 제목이 붙는다', async () => {
  setLang('ko');
  const f = fakeCore(2);
  const { said, inbox, mail } = make(f);
  await inbox.refresh();
  await inbox.open(inboxKey(2), true);
  assert.equal(said.length, 0);
  assert.deepEqual(f.state.opened, [2]);
  // 연 쪽지는 쪽지함 표에도 열린 상태로 담긴다
  assert.ok(((mail.get(inboxKey(2))?.payload ?? {}) as InboxItem).opened);
  await inbox.open(inboxKey(1));
  assert.equal(said.length, 1);
  assert.ok(said[0]?.text?.startsWith('운영자 지급: 쪽지 1'), String(said[0]?.text));
  assert.ok(!said[0]?.text?.includes('받았어'), '받은 것이 0이면 받았어 줄이 없다');
});

test('새 쪽지 말풍선에는 펼쳐 보기와 쪽지함 열기 단추가 있고, 쪽지함 열기를 누르면 연다', async () => {
  setLang('ko');
  const f = fakeCore(2);
  let opened = 0;
  const mail = memoryMail();
  const said: { buttons?: { id: string; label: string }[] }[] = [];
  const inbox = createServerInbox({
    core: () => f.core,
    mail,
    say: async (s) => {
      said.push(s);
      return 'mailbox';
    },
    react: () => {},
    canTalk: () => true,
    onChange: () => {},
    onGot: () => {},
    openMailbox: () => {
      opened++;
    },
    log: () => {},
  });
  await inbox.deliver();
  assert.deepEqual(
    said[0]?.buttons?.map((b) => b.id),
    ['open', 'mailbox', 'later'],
  );
  assert.equal(said[0]?.buttons?.[1]?.label, '쪽지함 열기');
  assert.equal(opened, 1);
  assert.deepEqual(f.state.opened, [], '쪽지함 열기는 쪽지를 열지(받지) 않는다');
  // 같은 쪽지는 한 번만 알린다
  await inbox.deliver();
  assert.equal(said.length, 1);
});

const DAY = 86_400_000;

test('서버 모드가 꺼지면 상태가 바뀌는 즉시 서버 쪽지를 비운다 (받기를 기다리지 않는다, 개인정보)', async () => {
  const f = fakeCore(3);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  assert.equal(mail.all().filter((r) => r.source === 'server').length, 3);
  f.state.allowed = false;
  assert.equal(inbox.sync(), false);
  assert.equal(mail.all().filter((r) => r.source === 'server').length, 0);
  assert.equal(inbox.items.length, 0);
  assert.equal(inbox.holding(), false);
});

test('다른 계정으로 바뀌면 앞 계정의 서버 쪽지가 하나도 남지 않는다 (오래된 쪽지 포함)', async () => {
  const f = fakeCore(30);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  await inbox.loadMore();
  assert.equal(mail.all().length, 30);
  // 같은 계정이면 상태가 바뀌어도 그대로
  inbox.sync();
  assert.equal(mail.all().length, 30);
  // 계정 B: 첫 쪽만 새로 받는다
  f.state.account = 'B';
  const first = new Set(f.all.slice(0, 20).map((i) => inboxKey(i.id)));
  inbox.sync();
  assert.equal(mail.all().length, 0, '앞 계정 쪽지가 남았다');
  await inbox.refresh();
  assert.deepEqual(new Set(mail.all().map((r) => r.id)), first);
  assert.equal(mail.meta('server_account'), 'B');
});

test('다른 계정이면 refresh 만 불려도 앞 계정의 오래된 쪽지가 남지 않는다', async () => {
  const f = fakeCore(45);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  await inbox.loadMore();
  await inbox.loadMore();
  f.state.account = 'B';
  await inbox.refresh();
  assert.equal(mail.all().length, 20, '첫 쪽 20통만 있어야 한다');
});

test('휴지통 30일이 지나 정리된 서버 쪽지는 다시 받아도 안 읽음으로 돌아오지 않는다', async () => {
  const f = fakeCore(2);
  const { mail, inbox } = make(f);
  await inbox.refresh();
  const now = Date.now();
  mail.setRead('inbox:1', now);
  mail.setDeleted('inbox:1', now - 31 * DAY);
  mail.tidy(now);
  const gone = mail.get('inbox:1');
  assert.ok(gone, '줄은 남는다 (묘비)');
  assert.equal(gone.payload, null, '글은 비운다');
  assert.equal(isPurged(gone, now), true);
  await inbox.refresh();
  const row = mail.get('inbox:1');
  assert.ok(row?.deletedAt !== null && row?.deletedAt !== undefined, '지운 채로 있다');
  assert.equal(row.payload, null, '글을 다시 채우지 않는다');
  assert.equal(row.readAt !== null, true, '읽음도 그대로');
  // 서버가 목록에서 빼면 줄도 지운다
  f.all.splice(
    f.all.findIndex((i) => i.id === 1),
    1,
  );
  await inbox.refresh();
  assert.equal(mail.get('inbox:1'), undefined);
});

test('서버가 거둔 쪽지는 이어 받아 둔 오래된 쪽에서도 빠져 펫이 계속 들지 않는다', async () => {
  const f = fakeCore(30);
  const { inbox } = make(f);
  // 5번을 첫 쪽 시간 범위 안에서 보낸 것으로 한다 (거둔 쪽지는 범위 안일 때만 알아챌 수 있다)
  const five = f.all.find((i) => i.id === 5) as InboxItem;
  five.sentAt = new Date(Date.UTC(2026, 9, 1) + 25 * 3_600_000).toISOString();
  await inbox.refresh();
  await inbox.loadMore();
  assert.ok(inbox.items.some((i) => i.id === 5));
  f.all.splice(f.all.indexOf(five), 1);
  for (const i of f.all) i.opened = { coins: 0, chatPasses: 0 };
  await inbox.refresh();
  assert.equal(
    inbox.items.some((i) => i.id === 5),
    false,
    '거둔 쪽지가 목록에 남았다',
  );
  assert.equal(inbox.holding(), false, '거둔 쪽지를 펫이 들고 있다');
});

test('묘비와 지운 휴지통 쪽지: 화면 모델은 만들어진다 (깨진 원본으로 앱이 멈추지 않는다)', () => {
  const tomb = serverRow(item({ id: 9 }), { payload: null, deletedAt: 1 });
  assert.doesNotThrow(() => mailItemOf(tomb));
});

test('코인이 걸린 특별한 편지는 코인을 받기 전에는 지우거나 보관하지 못하고, 받은 뒤에는 된다', () => {
  setLang('ko');
  const base: MailRow = {
    id: '2026-10-21',
    source: 'local',
    kind: 'letter',
    day: '2026-10-21',
    at: 1,
    look: 'letter',
    milestone: 7,
    coins: 10,
    payload: { lines: [] },
    readAt: null,
    archivedAt: null,
    deletedAt: null,
    pinnedAt: null,
    coinsPaidAt: null,
  };
  assert.equal(mailItemOf(base).removable, false);
  assert.equal(
    mailItemOf({ ...base, coinsPaidAt: 5, readAt: null }).removable,
    true,
    '받고 안 읽음으로 돌린 편지는 지울 수 있다',
  );
  assert.equal(mailItemOf({ ...base, coins: null }).removable, true);
});

test('서버에서 이미 연 쪽지는 이 기기에서 안 읽음으로 되돌릴 수 없다', () => {
  setLang('ko');
  const opened = item({
    id: 1,
    coins: 5,
    opened: { coins: 5, chatPasses: 0 },
    openedAt: '2026-10-11T00:00:00Z',
  });
  assert.equal(mailItemOf(serverRow(opened)).canUnread, false);
  const alert = item({ id: 2, kind: 'notice', message: '점검' });
  assert.equal(mailItemOf(serverRow(alert, { readAt: 5 })).canUnread, true);
  assert.equal(mailItemOf(serverRow(alert, { readAt: 5 })).read, true);
});

test('코인 지급 표시는 한 번만 적히고, 옛 읽은 편지는 받은 것으로 옮겨진다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  for (const sql of MIGRATIONS.slice(0, 22)) db.exec(sql);
  db.exec('pragma user_version = 22');
  db.prepare(
    "insert into mail (id, source, kind, day, at, look, milestone, coins, payload, read_at) values ('a','local','letter','2026-10-01',1,'letter',7,5,'{}',9), ('b','local','letter','2026-10-02',2,'letter',30,5,'{}',null)",
  ).run();
  migrate(db);
  const mail = new MailStore(db);
  assert.equal(mail.get('a')?.coinsPaidAt, 9, '읽은 편지는 받은 것으로 센다');
  assert.equal(mail.get('b')?.coinsPaidAt, null);
  assert.equal(mail.markCoinsPaid('b', 100), true);
  assert.equal(mail.markCoinsPaid('b', 200), false, '두 번째는 안 준다');
  mail.setRead('b', null);
  assert.equal(mail.get('b')?.coinsPaidAt, 100, '안 읽음으로 돌려도 남는다');
});
