// 숨어 있을 때 온 알림 (기획서 "펫 동작 규칙" 숨김: 알림은 쌓아 두었다가 나올 때 한 번에).
// 펫이 숨은 동안(방해 금지, 발표, 숨기기) 일정 알림이나 업적 같은 말을 버리지 않고 모아 둔다.
// 다시 나오면 아직 쓸모 있는 것은 말풍선 하나로 묶고, 시작이 한참 지난 일정은 패널 오늘 탭의 "놓친 알림"에만 둔다.
import { t } from './i18n/index.ts';
import { localDay } from './todo-store.ts';

export interface HeldBubble {
  text: string;
  /** 여러 알림을 묶은 말이면 줄마다 하나 (다시 묶을 때 머리말이 겹치지 않게, 놓친 알림에는 줄마다) */
  lines?: string[];
  /** 꺼낼 때 줄을 다시 만든다 ("8분 뒤 회의"가 늦게 나와도 맞게). 저장하지 않는다 */
  render?: (now: number) => string[];
  /** 놓친 알림에 남길 줄 ("디자인 회의 (오전 11:56)"처럼 때가 지나도 맞는 글) */
  missedLines?: string[];
  /** 온 때 */
  at: number;
  /** 이 때가 지나면 말풍선으로 꺼내지 않고 놓친 알림에만 둔다 (일정은 시작 뒤 조금) */
  staleAt?: number;
  /** 말풍선으로 보인 횟수 */
  shown?: number;
}

/** 보였는데 아무도 못 보고 지나가면 다시 보이는 횟수 상한. 넘으면 놓친 알림으로 */
export const MAX_SHOWS = 2;

/**
 * 놓치면 안 되는 말이 닫힌 뒤 어떻게 할지.
 * - seen: 단추나 말풍선을 눌렀다, 또는 사용자가 펫을 집어 들어 치웠다(봤다)
 * - hold: 다시 보일 수 있을 때 다시 (숨기, 화면 잠금으로 치움, 다른 말에 밀림, 자리를 비운 사이 시간 끝)
 * - missed: 놓친 알림으로 (자리에 있는데 시간이 끝남, 수다 상한, 여러 번 보였는데도 못 봄)
 * action 은 닫힌 방법(단추 id, 'dismiss', 'timeout', 'replaced', 'cleared'), 못 띄웠으면 undefined.
 * blocked 는 지금 띄울 수 없는지(숨음, 끄는 중, 화면 잠금), away 는 사용자가 자리를 비웠는지.
 */
export function fateOf(
  action: string | undefined,
  o: { blocked: boolean; away: boolean; shown: number },
): 'seen' | 'hold' | 'missed' {
  if (action !== undefined && action !== 'timeout' && action !== 'replaced' && action !== 'cleared')
    return 'seen';
  if (o.blocked) return 'hold';
  if (action === 'cleared') return 'seen';
  const again = o.shown < MAX_SHOWS ? 'hold' : 'missed';
  if (action === 'replaced') return again;
  if (action === 'timeout' && o.away) return again;
  return 'missed';
}

export interface MissedItem {
  text: string;
  at: number;
}

/** 모아 두는 수. 넘치면 오래된 것부터 놓친 알림으로 */
export const HELD_MAX = 6;
/** 놓친 알림은 오늘 것만, 이만큼까지 */
export const MISSED_MAX = 20;
/** 일정 알림은 시작 뒤 이만큼 지나면 말풍선으로 꺼내지 않는다 */
export const SCHEDULE_STALE_MS = 10 * 60_000;
/** 일정 알림 미루기 (메모리에만. 앱을 끄면 사라진다) */
export const SNOOZE_MS = 5 * 60_000;

/** 미루기 단추를 보일지: 미룬 뒤에도 시작이 한참 지나기 전이어야 한다 */
export function canSnooze(now: number, earliestStart: number): boolean {
  return now + SNOOZE_MS <= earliestStart + SCHEDULE_STALE_MS;
}

export class HeldBubbles {
  #items: HeldBubble[] = [];

  /** 모아 둔다. 넘쳐서 밀려난 것을 돌려준다 (놓친 알림으로 옮길 것) */
  hold(item: HeldBubble): HeldBubble[] {
    if (this.#items.some((h) => h.text === item.text)) return [];
    this.#items.push(item);
    return this.#items.length > HELD_MAX ? this.#items.splice(0, this.#items.length - HELD_MAX) : [];
  }

  get size(): number {
    return this.#items.length;
  }

  /** 다시 나올 때. fresh 는 말풍선으로, stale 은 놓친 알림으로. 모아 둔 것은 비운다 */
  flush(now: number): { fresh: HeldBubble[]; stale: HeldBubble[] } {
    const items = this.#items;
    this.#items = [];
    return {
      fresh: items.filter((h) => h.staleAt === undefined || now <= h.staleAt),
      stale: items.filter((h) => h.staleAt !== undefined && now > h.staleAt),
    };
  }
}

/** 묶은 말풍선 글. 하나면 그대로, 여럿이면 머리말 아래 줄마다 하나 */
export function bundleText(items: readonly HeldBubble[]): string {
  const lines = items.flatMap((h) => h.lines ?? [h.text]);
  if (lines.length === 1) return lines[0] ?? '';
  return [t('pet.held.title', { n: lines.length }), ...lines.map((l) => `- ${l}`)].join('\n');
}

/** 놓친 알림: 보지 못하고 지나간 알림. 오늘 것만 남긴다 (메모리에만, 앱을 다시 켜면 비어 있다) */
export class MissedLog {
  #items: MissedItem[] = [];

  /** 저장해 둔 것에서 (앱을 다시 켜도 오늘 놓친 알림이 남게). 모양이 틀린 것은 버린다 */
  static from(raw: unknown, now: number): MissedLog {
    const log = new MissedLog();
    if (!Array.isArray(raw)) return log;
    for (const v of raw.slice(-MISSED_MAX)) {
      const m = v as Partial<MissedItem> | null;
      if (m && typeof m.text === 'string' && typeof m.at === 'number' && Number.isFinite(m.at))
        log.add({ text: m.text.slice(0, 500), at: m.at });
    }
    log.list(now);
    return log;
  }

  /** 저장할 모양 */
  get items(): MissedItem[] {
    return [...this.#items];
  }

  add(item: MissedItem): void {
    if (this.#items.some((m) => m.text === item.text && localDay(m.at) === localDay(item.at))) return;
    this.#items.push(item);
    if (this.#items.length > MISSED_MAX) this.#items.splice(0, this.#items.length - MISSED_MAX);
  }

  /** 오늘 것만, 최근 것이 위로 */
  list(now: number): MissedItem[] {
    const today = localDay(now);
    this.#items = this.#items.filter((m) => localDay(m.at) === today);
    return [...this.#items].reverse();
  }

  clear(): void {
    this.#items = [];
  }
}
