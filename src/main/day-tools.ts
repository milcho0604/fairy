// 하루 도구 (2026-10-11): 습관 체크, 아침 계획(펫 아침 한마디 포함), 방금 울린 알림 미루기, 내보내기.
// 글과 셈은 shared(habit.ts, day-plan.ts, snooze.ts, export.ts)에 있고 여기는 IPC, 저장 대화상자, 파일 쓰기만 한다.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  app,
  type BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  powerMonitor,
  type WebContents,
} from 'electron';
import { plusDays } from '../shared/day.ts';
import {
  DATA_EXPORT,
  DAY,
  type ExportResult,
  type HabitView,
  type PlanView,
  type PolishResult,
  pickReason,
  type RecentRemind,
} from '../shared/day-ipc.ts';
import {
  type DayPlan,
  focusBlocks,
  freeGaps,
  type PlanFile,
  type PlanPrefs,
  parsePlanFile,
  parsePolishReply,
  planCandidates,
  planRange,
  polishPlanPrompt,
  shouldAutoOpen,
  shouldNudge,
  suggestPicks,
} from '../shared/day-plan.ts';
import type { EventStore } from '../shared/event-store.ts';
import { timeLabel } from '../shared/event-store.ts';
import {
  defaultExportName,
  type ExportKind,
  type ExportTodo,
  eventsIcs,
  exportExt,
  exportPath,
  isExportKind,
  noteFileNames,
  noteMarkdown,
  notesMarkdown,
  todosCsv,
  todosMarkdown,
} from '../shared/export.ts';
import type { HabitStore } from '../shared/habit.ts';
import { t } from '../shared/i18n/index.ts';
import type { NoteStore } from '../shared/note-store.ts';
import { isSnoozeChoice, type SnoozeChoice } from '../shared/snooze.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import { rememberExport } from './exported.ts';
import type { SayOptions } from './pet-window.ts';
import { minuteOfDay, startOfDay } from './planner.ts';
import { freePath, writeFileAtomic } from './safe-file.ts';
import { readJson, writeJson } from './store.ts';

const PLAN_FILE = 'day-plan';
/** 펫 아침 한마디를 보는 간격 */
const NUDGE_TICK_MS = 30_000;
/** 그날 처음 자리에 앉고 이만큼 지나야 묻는다 (아침 브리핑 말풍선이 먼저 지나가게) */
const NUDGE_AFTER_MS = 90_000;

export interface DayToolsOptions {
  todos: TodoStore;
  habits: HabitStore;
  events: EventStore;
  notes: NoteStore;
  /** 내보낼 할 일 (지운 것 빼고 끝낸 것까지, export.ts readExportTodos) */
  exportTodos: () => ExportTodo[];
  restDays: () => number[];
  /** 하루 마무리 시각 (분). 집중 칸을 찾는 끝 */
  dayEndMinute: () => number;
  isPanel: (wc: WebContents) => boolean;
  panelWindow: () => BrowserWindow | undefined;
  openToday: () => void;
  isSettings: (wc: WebContents) => boolean;
  settingsWindow: () => BrowserWindow | undefined;
  askOnce: (text: string, system: string) => Promise<string | undefined>;
  aiLabel: () => string | undefined;
  aiLocked: () => boolean;
  say: (o: SayOptions) => Promise<string | undefined>;
  petHidden: () => boolean;
  focusing: () => boolean;
  reminders: {
    recent: (now: number) => RecentRemind | undefined;
    snoozeRecent: (choice: SnoozeChoice, now: number) => number | undefined;
    dismissRecent: () => void;
  };
  log: (tag: string, ...rest: unknown[]) => void;
}

const stamp = (now: number) => {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDay(now).replace(/-/g, '')}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export function createDayTools(o: DayToolsOptions) {
  let file: PlanFile = parsePlanFile(readJson(PLAN_FILE));
  /** 펫 한마디로 "같이 정하기"를 눌렀다: 새로 여는 패널이 plan() 을 부를 때 계획 화면을 띄운다 */
  let pendingOpen = false;
  const save = () => {
    try {
      writeJson(PLAN_FILE, file);
    } catch (err) {
      o.log('day', '계획 저장 못 함', err instanceof Error ? err.message : String(err));
    }
  };
  const fromPanel = (e: IpcMainEvent | IpcMainInvokeEvent) => o.isPanel(e.sender);

  // ---- 습관 ----
  ipcMain.handle(DAY.habits, (e): HabitView | undefined => {
    if (!fromPanel(e)) return undefined;
    const now = Date.now();
    return { today: localDay(now), habits: o.habits.list(now, o.restDays()) };
  });

  // ---- 아침 계획 ----
  /** 오늘 남은 시각 일정과 그 사이 빈 시간 */
  function dayGaps(now: number) {
    const dayStart = startOfDay(now);
    const { from, to } = planRange(dayStart, now, o.dayEndMinute());
    const events = o.events
      .between(dayStart, to)
      .filter((ev) => !ev.allDay && (ev.endAt ?? ev.startAt) >= now)
      .map((ev) => ({ title: ev.title, startAt: ev.startAt, endAt: ev.endAt, allDay: false }));
    return { events, gaps: freeGaps(events, from, to) };
  }

  function planView(now: number, auto = false): PlanView {
    const today = localDay(now);
    const open = o.todos.list(now).open;
    const candidates = planCandidates(open, today).map((todo) => {
      const reason = pickReason(todo, today, plusDays(today, 3));
      return {
        id: todo.id,
        title: todo.title,
        due: todo.due,
        dueMin: todo.dueMin,
        important: todo.important,
        repeat: todo.repeat,
        createdAt: todo.createdAt,
        ...(reason ? { reason } : {}),
      };
    });
    const { events, gaps } = dayGaps(now);
    const plan = file.plan?.day === today ? file.plan : undefined;
    const autoOpen = auto && (pendingOpen || shouldAutoOpen(file, today, minuteOfDay(now)));
    if (auto) pendingOpen = false;
    const ai = o.aiLocked() ? undefined : o.aiLabel();
    return {
      today,
      prefs: file.prefs,
      ...(plan ? { plan } : {}),
      candidates,
      suggested: suggestPicks(open, today),
      gaps,
      events: events.map(({ title, startAt, endAt }) => ({ title, startAt, endAt })),
      autoOpen,
      ...(ai ? { ai } : {}),
    };
  }

  ipcMain.handle(DAY.plan, (e, auto: unknown) =>
    fromPanel(e) ? planView(Date.now(), auto === true) : undefined,
  );
  ipcMain.handle(DAY.planSave, (e, picks: unknown, note: unknown): DayPlan | undefined => {
    if (!fromPanel(e) || !Array.isArray(picks)) return undefined;
    const now = Date.now();
    const open = new Set(o.todos.list(now).open.map((todo) => todo.id));
    const ids = [...new Set(picks.filter((id): id is number => Number.isInteger(id) && open.has(id)))].slice(
      0,
      3,
    );
    const plan: DayPlan = {
      day: localDay(now),
      picks: ids,
      blocks: focusBlocks(dayGaps(now).gaps, ids),
      ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 300) } : {}),
      at: now,
    };
    file = { ...file, plan, shownDay: plan.day };
    save();
    o.log('day', '아침 계획', ids.length, plan.blocks.length);
    return plan;
  });
  ipcMain.handle(DAY.planPrefs, (e, prefs: unknown): PlanPrefs => {
    if (!fromPanel(e)) return file.prefs;
    file = { ...file, prefs: parsePlanFile({ prefs }).prefs };
    save();
    return file.prefs;
  });
  ipcMain.on(DAY.planShown, (e) => {
    if (!fromPanel(e)) return;
    file = { ...file, shownDay: localDay(Date.now()) };
    save();
  });
  /** AI 다듬기 (선택). 할 일 제목이 AI 로 간다: 사용자가 단추를 눌렀을 때만 */
  let polishing = false;
  ipcMain.handle(DAY.planPolish, async (e, picks: unknown): Promise<PolishResult> => {
    if (!fromPanel(e)) return { ok: false, error: 'none' };
    if (o.aiLocked()) return { ok: false, error: 'locked' };
    if (!o.aiLabel()) return { ok: false, error: 'none' };
    if (polishing) return { ok: false, error: 'fail' };
    const now = Date.now();
    const view = planView(now);
    const chosen = Array.isArray(picks) ? picks.filter((id): id is number => Number.isInteger(id)) : [];
    const text = polishPlanPrompt({
      ask: t('plan.ai.ask'),
      candidates: view.candidates,
      picks: chosen,
      events: view.events.map((ev) => ({ time: timeLabel(minuteOfDay(ev.startAt)), title: ev.title })),
      gaps: view.gaps.map((g) => ({
        time: `${timeLabel(minuteOfDay(g.start))}-${timeLabel(minuteOfDay(g.end))}`,
      })),
      today: view.today,
    });
    polishing = true;
    try {
      const answer = await o.askOnce(text, t('plan.ai.system'));
      const r = parsePolishReply(
        answer,
        view.candidates.map((c) => c.id),
      );
      o.log('day', 'AI 다듬기', r ? 'ok' : 'fail');
      return r ? { ok: true, ...r } : { ok: false, error: 'fail' };
    } catch {
      return { ok: false, error: 'fail' };
    } finally {
      polishing = false;
    }
  });

  /** 계획 화면 띄우기 (펫 한마디 "같이 정하기"). 패널이 떠 있으면 바로, 아니면 새로 여는 패널이 띄운다 */
  function openPlan() {
    const had = o.panelWindow();
    if (had && !had.isDestroyed()) {
      o.openToday();
      had.webContents.send(DAY.openPlan);
      return;
    }
    pendingOpen = true;
    o.openToday();
  }

  /** 그날 처음 자리에 앉은 때 */
  let firstSeen: { day: string; at: number } | undefined;
  let nudging = false;
  function nudgeTick() {
    const now = Date.now();
    const today = localDay(now);
    if (nudging || !shouldNudge(file, today, minuteOfDay(now))) return;
    if (o.petHidden() || o.focusing() || powerMonitor.getSystemIdleTime() > 60) return;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return;
    if (firstSeen?.day !== today) firstSeen = { day: today, at: now };
    if (now - firstSeen.at < NUDGE_AFTER_MS) return;
    // 이미 오늘 계획 화면을 열어 봤으면 묻지 않는다
    if (file.shownDay === today) {
      file = { ...file, nudgedDay: today };
      save();
      return;
    }
    nudging = true;
    o.log('day', '아침 계획 한마디');
    void o
      .say({
        kind: 'system',
        text: t('plan.nudge'),
        buttons: [
          { id: 'plan', label: t('plan.nudge.go') },
          { id: 'later', label: t('plan.sheet.later') },
        ],
        ttlMs: 20_000,
      })
      .then((a) => {
        nudging = false;
        // 수다 빈도나 시간 상한에 막혔으면(undefined) 다음 틱에 다시
        if (a === undefined) return;
        file = { ...file, nudgedDay: today };
        save();
        if (a === 'plan') openPlan();
      });
  }
  const timer = setInterval(nudgeTick, NUDGE_TICK_MS);
  timer.unref();

  // ---- 방금 울린 알림 미루기 ----
  ipcMain.handle(DAY.remind, (e) => (fromPanel(e) ? o.reminders.recent(Date.now()) : undefined));
  ipcMain.handle(DAY.remindSnooze, (e, choice: unknown) => {
    if (!fromPanel(e) || !isSnoozeChoice(choice)) return undefined;
    return o.reminders.snoozeRecent(choice, Date.now());
  });
  ipcMain.on(DAY.remindDismiss, (e) => {
    if (fromPanel(e)) o.reminders.dismissRecent();
  });

  // ---- 내보내기 (설정 > 데이터) ----
  ipcMain.handle(DATA_EXPORT.run, async (e, kind: unknown): Promise<ExportResult | undefined> => {
    if (!o.isSettings(e.sender) || !isExportKind(kind)) return undefined;
    try {
      const r = await runExport(kind);
      if (r?.ok) rememberExport(r.path);
      return r;
    } catch (err) {
      o.log('export', '실패', kind, err instanceof Error ? err.message : String(err));
      return { ok: false, error: 'failed' };
    }
  });

  async function runExport(kind: ExportKind): Promise<ExportResult | undefined> {
    const now = Date.now();
    const parent = o.settingsWindow();
    if (kind === 'notes-files') {
      const notes = o.notes.list();
      if (notes.length === 0) return { ok: false, error: 'nothing' };
      const opts = {
        title: t('export.dialog.folder'),
        properties: ['openDirectory', 'createDirectory'],
      } as const;
      const pick = await (parent
        ? dialog.showOpenDialog(parent, { ...opts, properties: [...opts.properties] })
        : dialog.showOpenDialog({ ...opts, properties: [...opts.properties] }));
      const base = pick.filePaths[0];
      if (pick.canceled || !base) return undefined;
      if (!isAbsolute(base) || !existsSync(base) || !statSync(base).isDirectory())
        return { ok: false, error: 'failed' };
      // 고른 폴더를 어지르지 않게 새 폴더 하나에 모은다 (같은 분에 두 번이면 -2)
      const out = freePath(join(base, `fairy-memos-${stamp(now)}`));
      mkdirSync(out, { recursive: true });
      const names = noteFileNames(notes);
      notes.forEach((n, i) => {
        writeFileAtomic(join(out, names[i] ?? `${i + 1}.md`), noteMarkdown(n));
      });
      o.log('export', kind, notes.length);
      return { ok: true, n: notes.length, path: out };
    }
    const content = (): { text: string; n: number } | undefined => {
      if (kind === 'notes-md') {
        const notes = o.notes.list();
        return notes.length ? { text: notesMarkdown(notes, now), n: notes.length } : undefined;
      }
      if (kind === 'events-ics') {
        const events = o.events.between(0, Number.MAX_SAFE_INTEGER);
        return events.length ? { text: eventsIcs(events, now), n: events.length } : undefined;
      }
      const todos = o.exportTodos();
      if (todos.length === 0) return undefined;
      return { text: kind === 'todos-csv' ? todosCsv(todos) : todosMarkdown(todos, now), n: todos.length };
    };
    const made = content();
    if (!made) return { ok: false, error: 'nothing' };
    const ext = exportExt(kind);
    const filters = [
      { name: t(`export.filter.${ext.slice(1) as 'md' | 'csv' | 'ics'}`), extensions: [ext.slice(1)] },
    ];
    const opts = {
      title: t('export.dialog.file'),
      defaultPath: join(app.getPath('documents'), defaultExportName(kind, now)),
      filters,
    };
    const pick = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
    if (pick.canceled) return undefined;
    const path = exportPath(pick.filePath, ext);
    if (!path) return { ok: false, error: 'failed' };
    writeFileAtomic(path, made.text);
    o.log('export', kind, made.n);
    return { ok: true, n: made.n, path };
  }

  return {
    openPlan,
    stop: () => clearInterval(timer),
  };
}
