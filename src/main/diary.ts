import type { StatStore } from '../shared/beta-stats.ts';
import { plusDays } from '../shared/day.ts';
import { acceptPolished, DIARY_DAYS, diaryText, hasDiary } from '../shared/diary.ts';
import { t } from '../shared/i18n/index.ts';
import type { DiaryEntry } from '../shared/ipc.ts';
import { localDay } from '../shared/todo-store.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';

const FILE = 'diary';
/** 다듬은 일기를 이만큼(날)까지 둔다 */
const KEEP_DAYS = 30;
/** 한 날을 다듬어 보는 횟수 (AI 가 계속 실패하면 그만) */
const MAX_TRIES = 2;

interface Polished {
  /** 다듬기 전 글 (말이나 기록이 바뀌면 다시 다듬는다) */
  src: string;
  text: string;
}

/**
 * 짝꿍 일기. 지난 7일 기록으로 펫이 쓴 일기를 패널에 보인다.
 * 설정 "일기를 AI 로 다듬기"(기본 끔)를 켜면 지난 날 일기를 하나씩 지금 고른 AI 에 보내 말투만 다듬는다.
 * 보내는 것은 정해 둔 문장(숫자와 펫 말)뿐이고, 숫자가 하나라도 바뀌면 버리고 원래 글을 쓴다.
 */
export function createDiary(o: {
  stats: StatStore;
  ask: (text: string, system: string) => Promise<string | undefined>;
  persona: () => string;
  onChange: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const cache = new Map<string, Polished>();
  const raw = readJson(FILE);
  if (raw && typeof raw === 'object')
    for (const [day, v] of Object.entries(raw as Record<string, unknown>)) {
      const p = v as Partial<Polished> | null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof p?.src === 'string' && typeof p.text === 'string')
        cache.set(day, { src: p.src, text: p.text.slice(0, 240) });
    }
  const tries = new Map<string, number>();

  function save(now: number) {
    const oldest = plusDays(localDay(now), -KEEP_DAYS);
    for (const day of cache.keys()) if (day < oldest) cache.delete(day);
    writeJson(FILE, Object.fromEntries(cache));
  }

  /** 최근 것부터. 기록이 없는 날은 뺀다 */
  function entries(now: number): DiaryEntry[] {
    const today = localDay(now);
    const days = Array.from({ length: DIARY_DAYS }, (_, i) => plusDays(today, -i));
    const ai = settings.get().diaryAi;
    return o.stats
      .diaryFacts(days)
      .filter(hasDiary)
      .map((f) => {
        const src = diaryText(f, f.day === today);
        const c = cache.get(f.day);
        const polished = ai && c?.src === src && c.text !== src;
        return { day: f.day, text: polished ? c.text : src, today: f.day === today, ai: polished };
      });
  }

  let busy = false;
  /** 다듬지 않은 지난 날 하나를 다듬는다. 다듬었으면 true (더 있으면 또 부른다) */
  async function polishOne(now: number): Promise<boolean> {
    if (!settings.get().diaryAi || busy) return false;
    const today = localDay(now);
    const days = Array.from({ length: DIARY_DAYS - 1 }, (_, i) => plusDays(today, -1 - i));
    const todo = o.stats
      .diaryFacts(days)
      .filter(hasDiary)
      .map((f) => ({ day: f.day, src: diaryText(f) }))
      .find((d) => cache.get(d.day)?.src !== d.src && (tries.get(d.day) ?? 0) < MAX_TRIES);
    if (!todo) return false;
    // 숫자가 없는 날은 붙잡을 사실이 없어 묻지 않는다 (작은 모델이 이야기를 지어냈다)
    if (!/\d/.test(todo.src)) {
      cache.set(todo.day, { src: todo.src, text: todo.src });
      save(now);
      return true;
    }
    busy = true;
    tries.set(todo.day, (tries.get(todo.day) ?? 0) + 1);
    try {
      const out = await o.ask(t('diary.ai.prompt', { text: todo.src }), o.persona());
      const text = out === undefined ? undefined : acceptPolished(todo.src, out);
      o.log('diary', todo.day, out === undefined ? 'AI 없음' : text ? '다듬음' : '버림');
      // 받았는데 숫자가 바뀌었으면 원래 글로 정해 두고 다시 묻지 않는다. AI 가 없었으면 다음에 다시
      if (out === undefined) return false;
      cache.set(todo.day, { src: todo.src, text: text ?? todo.src });
      save(now);
      o.onChange();
      return true;
    } finally {
      busy = false;
    }
  }

  async function polishSome() {
    // 한 번에 하나씩, 사이를 두고
    for (let i = 0; i < DIARY_DAYS; i++) {
      if (!(await polishOne(Date.now()))) return;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }

  const timer = setInterval(() => void polishSome(), 30 * 60_000);
  timer.unref();
  setTimeout(() => void polishSome(), 90_000).unref();
  const stopSettings = settings.onChange((next, prev) => {
    if (next.diaryAi !== prev.diaryAi) {
      o.onChange();
      if (next.diaryAi) void polishSome();
    }
  });

  return {
    entries,
    stop() {
      clearInterval(timer);
      stopSettings();
    },
  };
}
