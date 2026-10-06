// AI 사용량. 사용자 요청(2026-10-02): claude 와 codex 를 같이 쓰니 남은 양이 보이면 좋겠다.
// claude 는 답할 때마다 rate_limit_event 를, codex 는 대화 기록(rollout) 파일에 rate_limits 를 남긴다.
import { getLang, locale, t } from '../i18n/index.ts';
import type { AiProvider } from './types.ts';

export interface UsageWindow {
  /** '5시간', '7일' 처럼 사람이 읽는 창 이름 */
  label: string;
  /** 0~100 */
  usedPercent: number;
  /** 다시 채워지는 시각 (epoch 초). 모르면 undefined */
  resetsAt?: number;
}

export interface AiUsage {
  provider: AiProvider;
  windows: UsageWindow[];
  plan?: string;
  /** 이 값을 읽은 시각 (epoch ms) */
  checkedAt: number;
}

function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return t('ai.usage.days', { n: minutes / 1440 });
  if (minutes % 60 === 0) return t('ai.usage.hours', { n: minutes / 60 });
  return t('ai.usage.minutes', { n: minutes });
}

const CLAUDE_WINDOWS: Record<string, number> = { five_hour: 300, seven_day: 10080 };

/** claude stream-json 의 rate_limit_event.rate_limit_info 를 읽는다. */
export function claudeUsage(info: unknown, now: number): AiUsage | undefined {
  const windows = (info as { unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }> })
    ?.unifiedWindows;
  if (!windows || typeof windows !== 'object') return undefined;
  const list: UsageWindow[] = [];
  for (const [key, w] of Object.entries(windows)) {
    if (typeof w?.utilization !== 'number') continue;
    list.push({
      label: CLAUDE_WINDOWS[key] ? windowLabel(CLAUDE_WINDOWS[key]) : key,
      usedPercent: Math.round(w.utilization * 1000) / 10,
      resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt : undefined,
    });
  }
  return list.length ? { provider: 'claude', windows: list, checkedAt: now } : undefined;
}

interface CodexWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

/** codex 대화 기록의 rate_limits 를 읽는다. */
export function codexUsage(limits: unknown, now: number): AiUsage | undefined {
  const l = limits as { primary?: CodexWindow; secondary?: CodexWindow; plan_type?: string } | undefined;
  if (!l || typeof l !== 'object') return undefined;
  const list: UsageWindow[] = [];
  for (const w of [l.primary, l.secondary]) {
    if (typeof w?.used_percent !== 'number' || typeof w.window_minutes !== 'number') continue;
    list.push({ label: windowLabel(w.window_minutes), usedPercent: w.used_percent, resetsAt: w.resets_at });
  }
  return list.length
    ? { provider: 'codex', windows: list, plan: l.plan_type ?? undefined, checkedAt: now }
    : undefined;
}

/** 대화 기록 파일 내용에서 마지막 rate_limits 를 찾는다. 한 줄에 하나의 JSON 사건이 있다. */
export function lastCodexLimits(rollout: string): unknown {
  const lines = rollout.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.includes('"rate_limits"')) continue;
    try {
      const found = findKey(JSON.parse(line), 'rate_limits');
      if (found) return found;
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return undefined;
}

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (key in value && (value as Record<string, unknown>)[key]) return (value as Record<string, unknown>)[key];
  for (const v of Object.values(value)) {
    const found = findKey(v, key);
    if (found) return found;
  }
  return undefined;
}

/** "3시간 뒤", "12분 뒤", "목 15:00" 처럼 초기화까지 남은 때. */
export function resetText(resetsAt: number | undefined, now: number): string {
  if (!resetsAt) return '';
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return t('ai.usage.resetSoon');
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return t('ai.usage.resetMinutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('ai.usage.resetHours', { n: hours });
  const d = new Date(resetsAt * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  // 한국어는 "목 15:00", 영어는 Intl 요일 ("Thu 15:00")
  const day =
    getLang() === 'ko'
      ? '일월화수목금토'[d.getDay()]
      : new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d);
  return t('ai.usage.resetAt', { when: `${day} ${hm}` });
}

export type UsageLevel = 'ok' | 'warn' | 'full';

export function usageLevel(percent: number): UsageLevel {
  if (percent >= 95) return 'full';
  if (percent >= 80) return 'warn';
  return 'ok';
}
