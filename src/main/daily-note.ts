// 매일 쪽지 (2026-10-11): 하루 한 번 9시 뒤 처음 자리에 있을 때 펫이 쪽지를 들고 온다. 펫을 누르면 펼쳐진다.
// 함께한 7, 30, 100, 365일(그 뒤 해마다)에는 봉투에 스티커를 붙인 특별한 편지와 코인 선물. 펼칠 때 코인을 준다.
// 쓰는 글은 이 컴퓨터 기록만 (어제 끝낸 수, 오늘 첫 일정, 습관 연속, 알려 준 것, 철) 이고 AI 를 부르지 않는다.
// 판단과 글 고르기는 shared/daily-note.ts, 저장은 daily-note.json. 못 본 쪽지는 패널 오늘 탭 쪽지함에 남는다.
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
import { NOTES, type NoteBox, type NoteView } from '../shared/note-ipc.ts';
import { basePersonaOf, styled } from '../shared/persona-voice.ts';
import { localDay } from '../shared/todo-store.ts';
import type { NoteLook } from '../shared/together.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';
import type { SurfaceWin } from './surface.ts';

const FILE = 'daily-note';
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
  openToday: () => void;
  /** 코인이 바뀌었다 (패널 다시 그리기) */
  onChange: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

/** 다른 곳의 쪽지 (서버 쪽지함, main/server-inbox.ts). 같은 쪽지함과 같은 펫 손에 섞인다 */
export interface ExtraNotes {
  views(): NoteView[];
  holding(): boolean;
  openNext(): Promise<void>;
  open(key: string): Promise<void>;
  isKey(key: string): boolean;
}

export function createDailyNotes(o: DailyNoteOptions) {
  let state: NoteState = parseNotes(readJson(FILE));
  let extra: ExtraNotes | undefined;
  const save = () => {
    try {
      writeJson(FILE, state);
    } catch (err) {
      o.log('note', '저장 실패', err instanceof Error ? err.message : String(err));
    }
  };
  const today = (now = Date.now()) => localDay(now);
  const bootAt = Date.now();

  /** 펫이 들고 있을 쪽지를 맞춘다 (오늘 받은 것을 안 펼쳤으면 든다) */
  function syncHold(now = Date.now()) {
    const n = settings.get().dailyNotes ? heldNote(state, today(now)) : undefined;
    // 운영자 쪽지는 매일 쪽지 설정과 상관없이 든다 (지급이 들어 있을 수 있다)
    o.hold(n?.look ?? (extra?.holding() ? 'note' : undefined));
  }

  function view(n: DailyNote): NoteView {
    const [, m, d] = n.day.split('-').map(Number);
    const date = { m: m ?? 1, d: d ?? 1 };
    return {
      day: noteId(n),
      look: n.look,
      title: n.milestone
        ? t('note.letterTitle', { n: n.milestone })
        : n.kind === 'week'
          ? t('note.weekTitle', date)
          : n.kind === 'evening'
            ? t('note.eveningTitle', date)
            : t('note.title', date),
      // 프리셋 말투, 내 말투면 지금 말투 규칙을 입힌다
      lines: n.lines.map((l) => styled(looseT(l.key, l.vars))),
      read: n.read,
      ...(n.coins ? { coins: n.coins } : {}),
    };
  }
  const box = (): NoteBox => ({
    on: settings.get().dailyNotes,
    notes: [...(extra?.views() ?? []), ...state.box.map(view)],
  });
  const push = () => {
    const w = o.surface();
    if (w && !w.isDestroyed()) w.webContents.send(NOTES.changed, box());
  };

  /** 읽었다. 특별한 편지는 처음 펼칠 때 코인을 준다. 서버 쪽지면 서버에서 연다 (첨부를 받는다) */
  function read(id: string, now = Date.now()) {
    if (extra?.isKey(id)) {
      void extra.open(id);
      return undefined;
    }
    const n = state.box.find((x) => noteId(x) === id);
    if (!n || n.read) return n;
    state = markRead(state, id);
    save();
    if (n.coins) {
      o.reward(n.coins, NOTE_REASON, now);
      o.onChange();
    }
    o.log('note', '읽음', n.look);
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
    const v = view(n);
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
    if (a === 'box') o.openToday();
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
    const d = new Date(now);
    const filed = { ...note, at: d.getHours() * 60 + d.getMinutes() };
    state = fileNote(state, filed);
    save();
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
    save();
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

  const fromPanel = (sender: Electron.WebContents) => o.fromSurface(sender);
  ipcMain.handle(NOTES.list, (e) => (fromPanel(e.sender) ? box() : undefined));
  ipcMain.on(NOTES.read, (e, day: unknown) => {
    if (fromPanel(e.sender) && typeof day === 'string') read(day);
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
    holding: () => (settings.get().dailyNotes && !!heldNote(state, today())) || !!extra?.holding(),
    /** 서버 쪽지함을 붙인다 (서버 계정이 생긴 뒤) */
    attach(x: ExtraNotes) {
      extra = x;
    },
    /** 다른 곳의 쪽지가 바뀌었다: 패널과 펫 손을 다시 맞춘다 */
    changed() {
      syncHold();
      push();
    },
    open,
    check,
    read,
    box,
    get state() {
      return state;
    },
    /** 개발용: 오늘 쪽지를 지우고 다시 들고 오게 한다. milestone 을 주면 그날 편지로 */
    /** 개발용: 저녁 쪽지를 지금 쓴다 (밤 9시를 기다리지 않는다) */
    debugEvening() {
      const day = today();
      state = { ...state, box: state.box.filter((n) => !(n.day === day && n.kind === 'evening')) };
      writeEvening();
      syncHold();
      push();
      return open(`${day}~e`);
    },
    /** 개발용: 오늘 쪽지를 주간 편지로 바꿔 다시 쓴다 */
    debugWeek() {
      const day = today();
      state = { ...state, box: state.box.filter((n) => !(n.day === day && n.kind !== 'evening')) };
      const total = o.totals(lastWeekDays(day));
      state = fileNote(
        state,
        composeWeek({
          day,
          persona: o.persona(),
          petName: o.petName(),
          lastWeekDone: total.done,
          lastWeekFocusMin: total.focusMin,
        }),
      );
      save();
      syncHold();
      push();
      return open(day);
    },
    debugBring(milestone?: number) {
      const day = today();
      state = { ...state, box: state.box.filter((n) => n.day !== day) };
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
        save();
      }
      return check(Date.now(), true);
    },
    stop: () => clearInterval(timer),
  };
}

export type DailyNotes = ReturnType<typeof createDailyNotes>;
