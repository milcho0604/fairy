// 펫 경험 (동료이자 친구): 끝낸 일 축하, 만난 날 기념, 혼잣말에 쓰는 기억, 최근 혼잣말 저장.
// 판단은 shared/companion.ts, 대사는 shared/i18n/companion.ts. 기억은 pet-memory.json 하나에 둔다 (writeJson 이 .json 을 붙인다).
import { type AchievementStore, streak } from '../shared/achieve.ts';
import type { StatStore } from '../shared/beta-stats.ts';
import {
  anniversaryDue,
  completionCheer,
  dayNumber,
  type PetMemory,
  parseMemory,
  weekDays,
} from '../shared/companion.ts';
import { plusDays } from '../shared/day.ts';
import { dicts, type I18nKey, t } from '../shared/i18n/index.ts';
import type { IdleFacts, IdleKey } from '../shared/idle-talk.ts';
import type { ReactKind } from '../shared/ipc.ts';
import { restDaysOf } from '../shared/routine.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';

const FILE = 'pet-memory';
/** 끝낸 직후의 통통 튀기와 빙글 춤(1.4초)을 다 보인 뒤 말한다 (말풍선이 뜨면 신남 모습이 말하기로 바뀐다) */
const CHEER_DELAY_MS = 1600;
/** 만난 날 기념을 보는 간격 (날이 바뀌는 것만 보면 된다) */
const ANNIV_EVERY_MS = 10 * 60_000;
/** 켜고 나서 처음 볼 때 (펫이 자리를 잡고 브리핑이 먼저 뜨게) */
const ANNIV_FIRST_MS = 90_000;

export interface CompanionOptions {
  todos: TodoStore;
  stats: StatStore;
  achievements: AchievementStore;
  petName: () => string;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 숨거나(사용자, 발표) 집중 중이면 기념은 다음에 (집에서 쉬는 중은 편지로 모아 둔다) */
  canCelebrate: () => boolean;
  log: (tag: string, ...rest: unknown[]) => void;
}

const isIdleKey = (k: string): k is IdleKey => k.startsWith('idle.') && k in dicts.ko;

export function createCompanion(o: CompanionOptions) {
  let memory: PetMemory = parseMemory(readJson(FILE));
  const save = () => writeJson(FILE, memory);

  // ---- 혼잣말에 쓰는 기억 (idle-talk IdleFacts) ----
  /** 혼잣말을 고를 때만 부른다 (4~6분에 한 번). 저장 파일을 몇 번 읽는다 */
  function memoryFacts(now: number): Partial<IdleFacts> {
    try {
      return readMemoryFacts(now);
    } catch (e) {
      // 기억을 못 읽어도 혼잣말은 시각과 할 일로 한다
      o.log('companion', '기억 읽기 실패', String(e));
      return {};
    }
  }

  function readMemoryFacts(now: number): Partial<IdleFacts> {
    const today = localDay(now);
    const yesterday = plusDays(today, -1);
    const week = weekDays(today);
    const days = [...new Set([yesterday, ...week])];
    const facts = o.stats.diaryFacts(days);
    const byDay = new Map(facts.map((f) => [f.day, f]));
    const first = o.stats.firstDay();
    return {
      yesterdayDone: byDay.get(yesterday)?.done ?? 0,
      weekDone: week.reduce((sum, d) => sum + (byDay.get(d)?.done ?? 0), 0),
      focusMin: byDay.get(today)?.focusMin ?? 0,
      streak: streak(o.achievements.doneDays(), today, restDaysOf(settings.get())),
      ...(first ? { daysTogether: dayNumber(first, today) } : {}),
    };
  }

  // ---- 끝낸 일 축하 ----
  function completed(now = Date.now()) {
    const today = localDay(now);
    const { open, doneToday } = o.todos.list(now);
    const due = (d: string | null) => d !== null && d <= today;
    const said = memory.cheers.day === today ? memory.cheers.ids : [];
    const cheer = completionCheer(
      {
        doneToday: doneToday.length,
        doneDueToday: doneToday.filter((x) => due(x.due)).length,
        openDueToday: open.filter((x) => due(x.due)).length,
        streak: streak(o.achievements.doneDays(), today, restDaysOf(settings.get())),
      },
      new Set(said),
    );
    if (!cheer) return;
    // 축하는 했든 수다 빈도에 막혔든 그날 한 번으로 친다 (되돌렸다 다시 끝내도 되풀이하지 않게)
    memory = { ...memory, cheers: { day: today, ids: [...said, cheer.id] } };
    save();
    o.log('companion', '축하', cheer.id);
    // 오늘 할 일을 다 끝냈으면 색종이를 터뜨린다 (통통 튀는 동안)
    if (cheer.kind === 'clear') o.react('cheer');
    setTimeout(() => {
      void o.say({
        kind: 'system',
        text: t(cheer.key, { name: o.petName(), n: cheer.n }),
        ttlMs: 5000,
      });
    }, CHEER_DELAY_MS).unref();
  }

  // ---- 만난 날 기념 ----
  function anniversary(now = Date.now()) {
    if (settings.get().chatter === 'quiet' || !o.canCelebrate()) return;
    const first = o.stats.firstDay();
    if (!first) return;
    const due = anniversaryDue(dayNumber(first, localDay(now)), memory.anniv);
    if (!due) return;
    memory = { ...memory, anniv: [...memory.anniv, due.mark] };
    save();
    o.log('companion', '기념', due.mark);
    o.react('cheer');
    const vars = { name: o.petName(), n: due.n };
    void o.say({
      kind: 'system',
      text: t(due.key, vars),
      ttlMs: 9000,
      // 보지 못하고 지나가면 놓친 알림에 남는다 (일 년에 몇 번 없는 말)
      hold: { missedMsgs: [{ key: due.key, vars }] },
    });
  }
  const annivTimer = setInterval(() => anniversary(), ANNIV_EVERY_MS);
  annivTimer.unref();
  setTimeout(() => anniversary(), ANNIV_FIRST_MS).unref();

  return {
    memoryFacts,
    completed,
    anniversary,
    /** 최근 혼잣말 (다시 켜도 되풀이하지 않게) */
    recentTalk: (): string[] => memory.recent.filter(isIdleKey),
    isIdleKey,
    saveRecentTalk(keys: readonly I18nKey[]) {
      memory = { ...memory, recent: [...keys] };
      save();
    },
    stop: () => clearInterval(annivTimer),
  };
}

export type Companion = ReturnType<typeof createCompanion>;
