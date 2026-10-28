// 매일 쪽지 (2026-10-11): 하루 한 번 9시 뒤 처음 자리에 있을 때 펫이 쪽지를 들고 온다. 펫을 누르면 펼쳐진다.
// 함께한 7, 30, 100, 365일(그 뒤 해마다)에는 봉투에 스티커를 붙인 특별한 편지와 코인 선물. 펼칠 때 코인을 준다.
// 쓰는 글은 이 컴퓨터 기록만 (어제 끝낸 수, 오늘 첫 일정, 습관 연속, 알려 준 것, 철) 이고 AI 를 부르지 않는다.
// 판단과 글 고르기는 shared/daily-note.ts, 저장은 저장 파일의 쪽지함 표(shared/mail-store.ts, 옛 daily-note.json 은 처음 켤 때 옮기고
// daily-note.json.migrated 로 남긴다). 못 본 쪽지는 쪽지함(패널 머리줄 봉투, 큰 창 쪽지함 구역)에 남아 다시 읽고, 보관하고, 지운다.
import { ipcMain, powerMonitor } from 'electron';
import type { PersonaId } from '../shared/ai/persona.ts';
import { dayNumber } from '../shared/companion.ts';
import {
  canDeliver,
  canDeliverEvening,
  composeEvening,
  composeNote,
  composeWeek,
  type DailyNote,
  fileNote,
  heldNote,
  lastWeekDays,
  markRead,
  milestoneDue,
  NOTE_REASON,
  type NoteFacts,
  type NoteState,
  noteId,
  parseNotes,
  recentVariants,
  weekLetterDue,
} from '../shared/daily-note.ts';
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import { inFilter, type MailBox, unreadCount } from '../shared/mail.ts';
import { MAIL_LOCAL_MAX, type MailPut, type MailRow, type MailStore } from '../shared/mail-store.ts';
import { isMailAct, type MailActResult, NOTES } from '../shared/note-ipc.ts';
import { basePersonaOf, styled } from '../shared/persona-voice.ts';
import { localDay } from '../shared/todo-store.ts';
import type { NoteLook } from '../shared/together.ts';
import { mailItemOf } from './mail-view.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import type { SurfaceWin } from './surface.ts';

const POLL_MS = 60_000;
/** 켜고 이만큼은 기다린다 (아침 브리핑, 맞이 인사가 먼저) */
const AFTER_START_MS = 90_000;
/** 자리에 있다고 보는 입력 뒤 시간 (초) */
const PRESENT_SEC = 60;

/** 쪽지를 쓸 때 부르는 쪽이 알려 주는 이 컴퓨터 기록 */
export type NoteSource = (now: number) => Omit<NoteFacts, 'day' | 'persona' | 'petName' | 'milestone'>;

/** 주간 편지와 저녁 쪽지에 쓰는 이 컴퓨터 기록 (days: 그 날짜들의 합) */
export interface DayTotals {
  done: number;
  focusMin: number;
}

export interface DailyNoteOptions {
  /** 쪽지함 저장 (저장 파일의 mail 표) */
  mail: MailStore;
  /** 옛 daily-note.json 내용 (없으면 undefined). 읽어서 쪽지함으로 옮긴 뒤 doneLegacy 로 파일 이름을 바꾼다 */
  readLegacy: () => unknown;
  doneLegacy: () => void;
  petName: () => string;
  persona: () => PersonaId;
  facts: NoteSource;
  firstDay: () => string | null;
  /** 날짜들에 끝낸 할 일 수와 집중한 분의 합 */
  totals: (days: readonly string[]) => DayTotals;
  /** 말을 걸어도 되는 때 (숨거나 집중, 노는 중이 아니고 펫이 한가하다) */
  canTalk: () => boolean;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 든 쪽지 모양 (main/together.ts). 없으면 내려놓는다 */
  hold: (look: NoteLook | undefined) => void;
  reward: (coins: number, reason: string, now: number) => void;
  /** 지금 보이는 패널 면 (작은 패널, 큰 창이 열려 있으면 큰 창) */
  surface: () => SurfaceWin | undefined;
  /** 작은 패널이나 큰 창이 보낸 요청인가 (숨겨 둔 큰 창이어도 받는다) */
  fromSurface: (wc: Electron.WebContents) => boolean;
  /** 쪽지함을 연다 (큰 창이면 쪽지함 구역, 작은 패널이면 쪽지함 덮개) */
  openMailbox: () => void;
  /** 공지 쪽지의 링크를 연다 (허용한 주소만 넘어온다) */
  openLink: (url: string) => void;
  /** 코인이 바뀌었다 (패널 다시 그리기) */
  onChange: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/** 다른 곳의 쪽지 (서버 쪽지함, main/server-inbox.ts). 같은 쪽지함과 같은 펫 손에 섞인다 */
export interface ExtraNotes {
  holding(): boolean;
  /** 서버에 더 오래된 쪽지가 있다 */
  hasMore(): boolean;
  /** 더 오래된 쪽지를 한 쪽 더 받는다 */
  loadMore(): Promise<void>;
  openNext(): Promise<void>;
  /** quiet 이면 펫 말풍선을 띄우지 않는다 (쪽지함에서 읽을 때) */
  open(key: string, quiet?: boolean): Promise<void>;
  isKey(key: string): boolean;
}

export function createDailyNotes(o: DailyNoteOptions) {
  const mail = o.mail;
  // 옛 daily-note.json 이 있으면 쪽지함으로 옮긴다 (백업에서 되살린 옛 파일도 켤 때 한 번 옮긴다)
  let state: NoteState = { box: [], marks: [] };
  migrateLegacy();
  state = loadState();
  let extra: ExtraNotes | undefined;
  const today = (now = Date.now()) => localDay(now);

  /** 쪽지함 표의 이 컴퓨터 쪽지들을 쪽지 상태로 (지운 것도 든다: 오늘 쪽지를 지웠다고 다시 쓰지 않게) */
  function loadState(): NoteState {
    const box: DailyNote[] = [];
    for (const r of mail.all()) {
      if (r.source !== 'local') continue;
      const n = parseNotes({
        box: [
          {
            day: r.day,
            kind: r.kind === 'week' || r.kind === 'evening' ? r.kind : undefined,
            look: r.look,
            milestone: r.milestone ?? undefined,
            coins: r.coins ?? undefined,
            lines: (r.payload as { lines?: unknown } | null)?.lines,
            at: (r.payload as { at?: unknown } | null)?.at,
            read: r.readAt !== null,
          },
        ],
      }).box[0];
      if (n) box.push(n);
    }
    return { box: box.slice(0, MAIL_LOCAL_MAX), marks: mail.marks() };
  }

  /** 받은 시각: 그날 오전 9시, 저녁 쪽지는 밤 9시 (옛 파일에서 옮길 때 날짜 차례를 지킨다) */
  function atOf(n: DailyNote): number {
    const [y, m, d] = n.day.split('-').map(Number);
    return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, n.kind === 'evening' ? 21 : 9).getTime();
  }

  /** 쪽지 하나를 쪽지함 표에 넣는다 (같은 열쇠가 있으면 내용만 바꾼다) */
  function persist(n: DailyNote, at: number = atOf(n)) {
    const put: MailPut = {
      id: noteId(n),
      source: 'local',
      kind: n.kind ?? (n.milestone ? 'letter' : 'daily'),
      day: n.day,
      at,
      look: n.look,
      milestone: n.milestone ?? null,
      coins: n.coins ?? null,
      payload: { lines: n.lines, ...(n.at !== undefined ? { at: n.at } : {}) },
      readAt: n.read ? at : null,
    };
    try {
      mail.put(put);
      mail.setMarks(state.marks);
    } catch (err) {
      o.log('note', '저장 실패', err instanceof Error ? err.message : String(err));
    }
  }

  function migrateLegacy() {
    let raw: unknown;
    try {
      raw = o.readLegacy();
    } catch {
      return;
    }
    if (raw === undefined || raw === null) return;
    try {
      const old = parseNotes(raw);
      for (const n of old.box) persist(n);
      const marks = [...new Set([...mail.marks(), ...old.marks])];
      mail.setMarks(marks);
      o.log('note', '옛 쪽지를 쪽지함으로 옮김', old.box.length);
      o.doneLegacy();
    } catch (err) {
      o.log('note', '옛 쪽지 옮기기 실패', err instanceof Error ? err.message : String(err));
    }
  }

  /** 지우거나 보관한 쪽지의 열쇠들 (펫이 들지 않고, 안 읽음에 세지 않는다) */
  const hiddenIds = (): Set<string> => {
    const out = new Set<string>();
    for (const r of mail.all()) if (r.deletedAt !== null || r.archivedAt !== null) out.add(r.id);
    return out;
  };
  /** 보이는 쪽지만 든 상태 (든 쪽지 판단) */
  const liveState = (): NoteState => {
    const hidden = hiddenIds();
    return { ...state, box: state.box.filter((n) => !hidden.has(noteId(n))) };
  };
  const bootAt = Date.now();

  /** 펫이 들고 있을 쪽지를 맞춘다 (오늘 받은 것을 안 펼쳤으면 든다) */
  function syncHold(now = Date.now()) {
    const n = settings.get().dailyNotes ? heldNote(liveState(), today(now)) : undefined;
    // 운영자 쪽지는 매일 쪽지 설정과 상관없이 든다 (지급이 들어 있을 수 있다)
    o.hold(n?.look ?? (extra?.holding() ? 'note' : undefined));
  }

  /** 쪽지함: 모든 쪽지(펫 쪽지, 서버 쪽지, 공지)를 지금 말로. 안 읽음 수는 "전체" 목록에 보이는 안 읽은 쪽지 수다 */
  const box = (): MailBox => {
    const items = mail.all().map(mailItemOf);
    return {
      on: settings.get().dailyNotes,
      items,
      unread: unreadCount(items),
      hasMore: extra?.hasMore() ?? false,
      trash: items.filter((m) => inFilter(m, 'trash')).length,
    };
  };
  const push = () => {
    const w = o.surface();
    if (w && !w.isDestroyed()) w.webContents.send(NOTES.changed, box());
  };

  /** 읽었다. 특별한 편지는 처음 펼칠 때 코인을 준다. 서버 쪽지면 서버에서 연다 (첨부를 받는다) */
  function read(id: string, now = Date.now()) {
    const row = mail.get(id);
    if (extra?.isKey(id)) {
      // 서버 쪽지는 서버에서 연다 (받을 것이 있으면 받는다). 받을 것이 없는 알림은 서버에 닿지 않아도 이 기기에서 읽은 것으로 표시한다.
      // 쪽지함에서 읽을 때는 말풍선을 띄우지 않는다
      if (row && mailItemOf(row).removable) mail.setRead(id, now);
      void extra.open(id, true);
      push();
      return undefined;
    }
    if (!row || row.readAt !== null) return state.box.find((x) => noteId(x) === id);
    mail.setRead(id, now);
    const n = state.box.find((x) => noteId(x) === id);
    if (n) state = markRead(state, id);
    // 특별한 편지는 처음 펼칠 때 코인을 준다 (쪽지함 표의 코인 칸이 기준이다)
    if (row.source === 'local' && row.coins) {
      o.reward(row.coins, NOTE_REASON, now);
      o.onChange();
    }
    o.log('note', '읽음', row.kind);
    syncHold(now);
    push();
    return n;
  }

  /** 펼친다 (펫을 누르거나 "펼쳐 보기"). 쪽지 모양 말풍선으로. 오늘 쪽지가 없으면 서버 쪽지 */
  async function open(id?: string): Promise<void> {
    // 열쇠를 안 주면 펫이 들고 있는 것(오늘 안 읽은 쪽지), 없으면 오늘 매일 쪽지
    const n = id
      ? state.box.find((x) => noteId(x) === id)
      : (heldNote(state, today()) ?? state.box.find((x) => x.day === today() && x.kind !== 'evening'));
    if (!n || (n.read && extra?.holding())) {
      if (extra?.holding()) await extra.openNext();
      return;
    }
    const fresh = !n.read;
    read(noteId(n));
    const row = mail.get(noteId(n)) as MailRow;
    const v = mailItemOf(row);
    if (fresh) o.react(n.look === 'letter' ? 'cheer' : 'happy');
    const a = await o.say({
      kind: 'answer',
      text: `${v.title}\n\n${v.lines.join('\n')}`,
      paper: n.look,
      buttons: [
        { id: 'thanks', label: t('note.thanks') },
        { id: 'box', label: t('note.toBox') },
      ],
      ttlMs: 30_000,
    });
    if (a === 'box') o.openMailbox();
  }

  /** 오늘 쪽지를 쓴다. 이미 있으면 그것 */
  function write(now = Date.now()): DailyNote {
    const day = today(now);
    const have = state.box.find((n) => n.day === day && n.kind !== 'evening');
    if (have) return have;
    const first = o.firstDay();
    const days = first ? dayNumber(first, day) : 0;
    const milestone = milestoneDue(days, state.marks);
    const recent = recentVariants(state);
    // 월요일(못 만났으면 수요일까지)에는 지난주를 돌아보는 주간 편지가 그날 쪽지다. 특별한 편지가 있는 날은 그것이 먼저
    const week = !milestone && weekLetterDue(state, day);
    const note = week
      ? composeWeek(
          (() => {
            const total = o.totals(lastWeekDays(day));
            return {
              day,
              persona: o.persona(),
              petName: o.petName(),
              lastWeekDone: total.done,
              lastWeekFocusMin: total.focusMin,
            };
          })(),
          Math.random,
          recent,
        )
      : composeNote(
          {
            ...o.facts(now),
            day,
            persona: o.persona(),
            petName: o.petName(),
            ...(milestone ? { milestone } : {}),
          },
          Math.random,
          recent,
        );
    // 들고 온 때(그날 0시부터 분)를 적어 둔다: 저녁 쪽지는 매일 쪽지와 간격을 둔다 (shared/daily-note.ts canDeliverEvening)
    const d = new Date(now);
    const filed = { ...note, at: d.getHours() * 60 + d.getMinutes() };
    state = fileNote(state, filed);
    persist(filed, now);
    o.log('note', '씀', filed.kind ?? filed.look, milestone ?? '');
    return filed;
  }

  /** 오늘 저녁 쪽지를 쓴다. 이미 있으면 그것 */
  function writeEvening(now = Date.now()): DailyNote {
    const day = today(now);
    const have = state.box.find((n) => n.day === day && n.kind === 'evening');
    if (have) return have;
    const total = o.totals([day]);
    const note = composeEvening(
      { day, persona: o.persona(), petName: o.petName(), doneToday: total.done, focusMin: total.focusMin },
      Math.random,
      recentVariants(state),
    );
    state = fileNote(state, note);
    persist(note, now);
    o.log('note', '씀', 'evening');
    return note;
  }

  let bringing = false;
  /** 때가 되면 들고 온다: 매일 쪽지(월요일은 주간 편지)는 하루 한 번, 저녁 쪽지는 켠 사람만 밤 9시 뒤 한 번 */
  async function check(now = Date.now(), force = false) {
    syncHold(now);
    if (bringing || !settings.get().dailyNotes) return;
    const d = new Date(now);
    const gate = {
      day: today(now),
      minute: d.getHours() * 60 + d.getMinutes(),
      present: powerMonitor.getSystemIdleTime() < PRESENT_SEC,
      calm: o.canTalk(),
    };
    if (!force && now - bootAt < AFTER_START_MS) return;
    const daily = force || canDeliver(state, gate);
    const evening = !daily && canDeliverEvening(state, { ...gate, on: settings.get().eveningNotes });
    if (!daily && !evening) return;
    bringing = true;
    try {
      const note = daily ? write(now) : writeEvening(now);
      syncHold(now);
      push();
      // 조용히면 말없이 들고만 있다. 아니면 한마디 (상태 알림이라 수다 빈도를 따른다)
      if (settings.get().chatter === 'quiet') return;
      const vars = { p: basePersonaOf(o.persona()), name: o.petName() };
      const key =
        note.kind === 'week'
          ? 'note.bringWeek'
          : note.kind === 'evening'
            ? 'note.bringEvening'
            : note.look === 'letter'
              ? 'note.bringLetter'
              : 'note.bring';
      const a = await o.say({
        kind: 'system',
        text: styled(t(key, vars)),
        buttons: [
          { id: 'open', label: t('note.openNow') },
          { id: 'later', label: t('note.later') },
        ],
        ttlMs: 15_000,
      });
      if (a === 'open') await open(noteId(note));
    } finally {
      bringing = false;
    }
  }

  /** 쪽지 하나에 하는 일. 받을 것이 남은 안 연 서버 쪽지는 지우거나 보관하지 못하게 거절한다 */
  function act(id: string, what: string, now = Date.now()): MailActResult {
    const row = mail.get(id);
    if (!row || !isMailAct(what)) return { ok: false, reason: 'unknown' };
    const item = mailItemOf(row);
    if ((what === 'delete' || what === 'archive') && !item.removable)
      return { ok: false, reason: 'cantRemove' };
    switch (what) {
      case 'read':
        read(id, now);
        break;
      case 'unread':
        // 이 기기에서만 안 읽음으로 (서버에서 연 쪽지는 열린 채다)
        mail.setRead(id, null);
        state = { ...state, box: state.box.map((n) => (noteId(n) === id ? { ...n, read: false } : n)) };
        break;
      case 'archive':
        mail.setArchived(id, now);
        break;
      case 'unarchive':
        mail.setArchived(id, null);
        break;
      case 'delete':
        mail.setDeleted(id, now);
        break;
      case 'restore':
        mail.setDeleted(id, null);
        break;
      case 'pin':
        mail.setPinned(id, now);
        break;
      case 'unpin':
        mail.setPinned(id, null);
        break;
    }
    syncHold(now);
    push();
    o.onChange();
    return { ok: true, box: box() };
  }

  /** 안 읽은 쪽지를 모두 읽음으로. 특별한 편지는 코인을 주고, 받을 것이 있는 서버 쪽지는 서버에서 열어야 하니 그대로 둔다 */
  function readAll(now = Date.now()): MailBox {
    for (const it of box().items) {
      if (it.read || it.deleted || it.archived) continue;
      if (it.source === 'local') read(it.id, now);
      else if (it.source === 'server' && it.removable) {
        mail.setRead(it.id, now);
        void extra?.open(it.id, true);
      } else if (it.source !== 'server') mail.setRead(it.id, now);
    }
    syncHold(now);
    push();
    return box();
  }

  const fromPanel = (sender: Electron.WebContents) => o.fromSurface(sender);
  ipcMain.handle(NOTES.list, (e) => (fromPanel(e.sender) ? box() : undefined));
  ipcMain.on(NOTES.read, (e, id: unknown) => {
    if (fromPanel(e.sender) && typeof id === 'string') read(id);
  });
  ipcMain.handle(NOTES.act, (e, id: unknown, what: unknown) =>
    fromPanel(e.sender) && typeof id === 'string' && typeof what === 'string' ? act(id, what) : undefined,
  );
  ipcMain.handle(NOTES.readAll, (e) => (fromPanel(e.sender) ? readAll() : undefined));
  ipcMain.handle(NOTES.more, async (e) => {
    if (!fromPanel(e.sender)) return undefined;
    await extra?.loadMore();
    return box();
  });
  ipcMain.on(NOTES.link, (e, id: unknown) => {
    if (!fromPanel(e.sender) || typeof id !== 'string') return;
    const row = mail.get(id);
    const link = row ? mailItemOf(row).link : undefined;
    if (link) o.openLink(link);
  });

  settings.onChange((next, prev) => {
    if (next.dailyNotes === prev.dailyNotes && next.lang === prev.lang) return;
    syncHold();
    push();
  });

  const timer = setInterval(() => void check(), POLL_MS);
  timer.unref();
  // 다시 켜도 오늘 받은 쪽지를 그대로 든다
  setTimeout(() => syncHold(), 3000).unref();

  return {
    /** 펫이 쪽지를 들고 있다 (펫 누르기가 쪽지 펼치기가 된다) */
    holding: () => (settings.get().dailyNotes && !!heldNote(liveState(), today())) || !!extra?.holding(),
    /** 서버 쪽지함을 붙인다 (서버 계정이 생긴 뒤) */
    attach(x: ExtraNotes) {
      extra = x;
    },
    /** 다른 곳의 쪽지가 바뀌었다: 패널과 펫 손을 다시 맞춘다 */
    changed() {
      // 쪽지함 표가 바뀌었다(서버 쪽지, 공지, 되살린 백업): 쪽지 상태도 표에서 다시 읽는다
      state = loadState();
      syncHold();
      push();
    },
    open,
    check,
    read,
    box,
    act,
    readAll,
    /** 안 읽은 쪽지 수 (펫 메뉴) */
    unread: () => box().unread,
    /** 공지가 나왔다: 쪽지함에 모은다 (같은 공지는 한 통) */
    announce(
      n: { id: string; title: { ko: string; en: string }; body: { ko: string; en: string }; link?: string },
      now = Date.now(),
    ) {
      if (mail.get(`notice:${n.id}`)) return;
      mail.put({
        id: `notice:${n.id}`,
        source: 'notice',
        kind: 'announce',
        day: today(now),
        at: now,
        look: 'note',
        milestone: null,
        coins: null,
        payload: { title: n.title, body: n.body, ...(n.link ? { link: n.link } : {}) },
        readAt: null,
      });
      push();
      o.onChange();
    },
    get state() {
      return state;
    },
    /** 개발용: 오늘 쪽지를 지우고 다시 들고 오게 한다. milestone 을 주면 그날 편지로 */
    /** 개발용: 저녁 쪽지를 지금 쓴다 (밤 9시를 기다리지 않는다) */
    debugEvening() {
      const day = today();
      state = { ...state, box: state.box.filter((n) => !(n.day === day && n.kind === 'evening')) };
      mail.remove(`${day}~e`);
      writeEvening();
      syncHold();
      push();
      return open(`${day}~e`);
    },
    /** 개발용: 오늘 쪽지를 주간 편지로 바꿔 다시 쓴다 */
    debugWeek() {
      const day = today();
      state = { ...state, box: state.box.filter((n) => !(n.day === day && n.kind !== 'evening')) };
      mail.remove(day);
      const total = o.totals(lastWeekDays(day));
      const week = composeWeek({
        day,
        persona: o.persona(),
        petName: o.petName(),
        lastWeekDone: total.done,
        lastWeekFocusMin: total.focusMin,
      });
      state = fileNote(state, week);
      persist(week, Date.now());
      syncHold();
      push();
      return open(day);
    },
    debugBring(milestone?: number) {
      const day = today();
      state = { ...state, box: state.box.filter((n) => n.day !== day) };
      mail.remove(day);
      mail.remove(`${day}~e`);
      if (milestone) {
        state = { ...state, marks: state.marks.filter((m) => m !== milestone) };
        const note = composeNote({
          ...o.facts(Date.now()),
          day,
          persona: o.persona(),
          petName: o.petName(),
          milestone,
        });
        state = fileNote(state, note);
        persist(note, Date.now());
      }
      return check(Date.now(), true);
    },
    stop: () => clearInterval(timer),
  };
}

export type DailyNotes = ReturnType<typeof createDailyNotes>;
