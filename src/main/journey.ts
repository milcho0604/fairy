// 첫 7일 여정 (2026-10-11): 첫 안내를 마친 날부터 이레 동안 하루에 하나씩 기능을 권하고, 해 보면 작은 코인을 준다.
// 펫이 먼저 권하는 말은 하루 한 번까지, 안 해도 아무 일 없다. 판단은 shared/journey.ts, 저장은 journey.json.
// 해 봤는지는 앱이 이미 아는 것으로 본다: 빠른 입력 창, 집중 타이머, 새 메모, 펫 만들기 창은 15초마다 보고,
// 일정, 같이 보기는 부르는 쪽(index.ts)이, 주간 돌아보기는 패널이 알려 준다.
import { type BrowserWindow, ipcMain, powerMonitor } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import { BOND } from '../shared/bond-ipc.ts';
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import {
  canNudge,
  isJourneyStep,
  JOURNEY_COINS,
  JOURNEY_REASON,
  type JourneyState,
  type JourneyStep,
  journeyActive,
  journeyView,
  markNudged,
  parseJourney,
  shouldStartLate,
  startJourney,
  todayStep,
  tryStep,
} from '../shared/journey.ts';
import type { Note } from '../shared/note-store.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';

const FILE = 'journey';
const POLL_MS = 15_000;
const NUDGE_EVERY_MS = 2 * 60_000;
/** 켜고 이만큼은 권하지 않는다 (브리핑, 맞이 인사가 먼저) */
const NUDGE_AFTER_MS = 5 * 60_000;

export interface JourneyOptions {
  todos: Pick<TodoStore, 'reward'>;
  stats: Pick<StatStore, 'firstDay'>;
  notes: { list(): Note[] };
  petName: () => string;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 숨거나 집중 중, 노는 중이 아니라 말을 걸어도 되는지 */
  canTalk: () => boolean;
  /** 15초마다 보는 것: 빠른 입력 창이 떠 있다, 집중 타이머가 돈다, 펫 만들기 창이 떠 있다 */
  seen: { quick: () => boolean; focus: () => boolean; maker: () => boolean };
  /** 그 기능 열기 (말풍선 "해 볼래", 패널 칸의 단추) */
  open: (step: JourneyStep) => void;
  /** 지금 보이는 패널 면 (작은 패널, 큰 창이 열려 있으면 큰 창) */
  surface: () => BrowserWindow | undefined;
  /** 작은 패널이나 큰 창이 보낸 요청인가 (숨겨 둔 큰 창이어도 받는다) */
  fromSurface: (wc: Electron.WebContents) => boolean;
  /** 코인과 칸이 바뀌었다 (패널 다시 그리기) */
  onChange: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

export function createJourney(o: JourneyOptions) {
  const raw = readJson(FILE);
  let state: JourneyState = parseJourney(raw);
  const save = () => {
    try {
      writeJson(FILE, state);
    } catch (err) {
      o.log('journey', '저장 실패', err instanceof Error ? err.message : String(err));
    }
  };
  const today = () => localDay(Date.now());
  // 이 판에서 처음 켰다: 안내를 이미 마친 사람은 처음 켠 지 이틀 안일 때만 시작한다 (오래 쓴 사람은 알고 있다)
  if (raw === undefined && settings.get().onboarded) {
    if (shouldStartLate(o.stats.firstDay(), today())) state = startJourney(state, today());
    save();
  }

  const push = () => {
    const w = o.surface();
    if (w && !w.isDestroyed()) w.webContents.send(BOND.journeyChanged, journeyView(state, today()));
    o.onChange();
  };
  const fromPanel = (sender: Electron.WebContents) => o.fromSurface(sender);

  /** 해 봤다. 여정 중 처음이면 코인과 한마디 */
  function tried(step: JourneyStep, now = Date.now()) {
    const r = tryStep(state, step, localDay(now));
    if (!r.reward) return;
    state = r.state;
    save();
    o.todos.reward(JOURNEY_COINS, JOURNEY_REASON, now);
    o.log('journey', '해 봄', step, state.tried.length);
    const name = o.petName();
    if (r.finished) o.react('cheer');
    else o.react('happy');
    void o.say({
      kind: 'answer',
      text: r.finished
        ? t('bond.journey.finished', { name, coins: JOURNEY_COINS })
        : t('bond.journey.reward', { what: t(`bond.journey.step.${step}`), coins: JOURNEY_COINS }),
      ttlMs: 5000,
    });
    push();
  }

  function start() {
    if (state.start) return;
    state = startJourney(state, today());
    save();
    o.log('journey', '시작');
    push();
  }

  function skip() {
    state = { ...state, skipped: true };
    save();
    o.log('journey', '그만 보기');
    push();
  }

  ipcMain.handle(BOND.journeyGet, (e) => (fromPanel(e.sender) ? journeyView(state, today()) : undefined));
  ipcMain.on(BOND.journeyGo, (e, step: unknown) => {
    if (fromPanel(e.sender) && isJourneyStep(step)) o.open(step);
  });
  // 패널이 알려 주는 것은 주간 돌아보기뿐이다 (나머지는 메인이 직접 본다)
  ipcMain.on(BOND.journeyTried, (e, step: unknown) => {
    if (fromPanel(e.sender) && step === 'week') tried('week');
  });
  ipcMain.on(BOND.journeySkip, (e) => {
    if (fromPanel(e.sender)) skip();
  });

  // ---- 해 봤는지 보기 ----
  const startMs = () => {
    const d = state.start;
    if (!d) return Number.POSITIVE_INFINITY;
    return new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getTime();
  };
  function poll() {
    const day = today();
    if (!journeyActive(state, day)) return;
    const left = (s: JourneyStep) => !state.tried.includes(s);
    if (left('quick') && o.seen.quick()) tried('quick');
    if (left('focus') && o.seen.focus()) tried('focus');
    if (left('maker') && o.seen.maker()) tried('maker');
    if (left('note')) {
      const from = startMs();
      if (
        o.notes
          .list()
          .some((n) => n.createdAt >= from && n.source === 'me' && (n.title.trim() || n.body.trim()))
      )
        tried('note');
    }
  }
  const pollTimer = setInterval(poll, POLL_MS);
  pollTimer.unref();

  // ---- 하루 한 번 권하기 ----
  const bootAt = Date.now();
  let asking = false;
  async function nudge(now = Date.now()) {
    const day = localDay(now);
    if (asking || !canNudge(state, day) || now - bootAt < NUDGE_AFTER_MS) return;
    if (settings.get().chatter === 'quiet' || !o.canTalk() || powerMonitor.getSystemIdleTime() > 60) return;
    const hour = new Date(now).getHours();
    if (hour < 9 || hour >= 21) return;
    const step = todayStep(state, day);
    if (!step) return;
    asking = true;
    const a = await o.say({
      kind: 'system',
      text: t(`bond.journey.nudge.${step}`, { name: o.petName() }),
      buttons: [
        { id: 'go', label: t('bond.journey.go') },
        { id: 'later', label: t('bond.journey.later') },
      ],
      ttlMs: 20_000,
    });
    asking = false;
    // 수다 빈도나 다른 말풍선에 막혔으면 다음에 다시 (오늘 권한 것으로 치지 않는다)
    if (a === undefined) return;
    state = markNudged(state, day);
    save();
    o.log('journey', '권함', step, a);
    if (a === 'go') o.open(step);
  }
  const nudgeTimer = setInterval(() => void nudge(), NUDGE_EVERY_MS);
  nudgeTimer.unref();

  return {
    start,
    tried,
    skip,
    nudge,
    poll,
    view: () => journeyView(state, today()),
    get state() {
      return state;
    },
    stop() {
      clearInterval(pollTimer);
      clearInterval(nudgeTimer);
    },
  };
}

export type Journey = ReturnType<typeof createJourney>;
