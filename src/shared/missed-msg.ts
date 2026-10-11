// 놓친 알림 글을 말 열쇠와 값으로 남긴다. 글로 굳혀 두면 언어를 바꿔도 만들 때 언어로 남았다 (검토 2026-10-08).
// 보일 때 지금 언어로 다시 만든다. 저장 파일(missed.json)에 그대로 들어가서 읽을 때 모양을 검사한다.
import { allDayLabel } from './event-store.ts';
import { dicts, type I18nKey } from './i18n/index.ts';
import { voiced } from './persona-voice.ts';
import type { Anchor } from './remind.ts';
import { missedLine, type RemindItem } from './remind-text.ts';

export type MissedVar = string | number | MissedMsg;

/**
 * key 와 값(값도 말 열쇠일 수 있다: 업적 이름), 또는 일정과 할 일 알림 한 줄 (제목과 때).
 * span 은 여러 날 종일 일정의 기간 (보일 때 지금 언어로 range 를 다시 만든다)
 */
export type MissedMsg =
  | { key: string; vars?: Record<string, MissedVar> }
  | { remind: RemindItem; span?: { startAt: number; endAt: number } };

/** 지금 언어로 */
export function renderMissed(m: MissedMsg): string {
  if ('remind' in m) return missedLine(m.span ? { ...m.remind, range: allDayLabel(m.span) } : m.remind);
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.vars ?? {})) vars[k] = typeof v === 'object' ? renderMissed(v) : v;
  // 펫이 한 말이면 고른 성격 말투로 (shared/persona-voice.ts. 성격 말이 없는 키는 원래 말)
  return voiced(m.key as I18nKey, m.vars ? vars : undefined);
}

const MAX_DEPTH = 3;
const isKey = (k: unknown): k is string => typeof k === 'string' && k in dicts.ko;

function parseAnchor(raw: unknown): Anchor | undefined {
  const a = raw as Partial<{ kind: string; at: number; day: string }> | null;
  if (a?.kind === 'time' && typeof a.at === 'number' && Number.isFinite(a.at))
    return { kind: 'time', at: a.at };
  if (a?.kind === 'day' && typeof a.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.day))
    return { kind: 'day', day: a.day };
  return undefined;
}

/** 저장해 둔 것에서. 모양이 틀렸거나 없는 말 열쇠면 undefined (그때는 저장한 글을 그대로 보인다) */
export function parseMissedMsg(raw: unknown, depth = 0): MissedMsg | undefined {
  if (!raw || typeof raw !== 'object' || depth > MAX_DEPTH) return undefined;
  const r = raw as Record<string, unknown>;
  if ('remind' in r) {
    const it = r.remind as Partial<RemindItem> | null;
    const anchor = parseAnchor(it?.anchor);
    if (!it || (it.kind !== 'event' && it.kind !== 'todo') || typeof it.title !== 'string' || !anchor)
      return undefined;
    const span = r.span as Partial<{ startAt: number; endAt: number }> | undefined;
    const okSpan =
      typeof span?.startAt === 'number' && Number.isFinite(span.startAt) && Number.isFinite(span.endAt);
    return {
      remind: {
        kind: it.kind,
        title: it.title.slice(0, 500),
        anchor,
        ...(typeof it.range === 'string' ? { range: it.range.slice(0, 80) } : {}),
      },
      ...(okSpan ? { span: { startAt: Number(span?.startAt), endAt: Number(span?.endAt) } } : {}),
    };
  }
  if (!isKey(r.key)) return undefined;
  if (r.vars === undefined) return { key: r.key };
  if (!r.vars || typeof r.vars !== 'object' || Array.isArray(r.vars)) return undefined;
  const vars: Record<string, MissedVar> = {};
  for (const [k, v] of Object.entries(r.vars)) {
    if (typeof v === 'string') vars[k] = v.slice(0, 500);
    else if (typeof v === 'number' && Number.isFinite(v)) vars[k] = v;
    else {
      const inner = parseMissedMsg(v, depth + 1);
      if (!inner) return undefined;
      vars[k] = inner;
    }
  }
  return { key: r.key, vars };
}
