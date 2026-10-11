// 짝꿍이 아는 것 (2026-10-11). 기억마다 어디서 왔는지(대화, 직접, MCP)와 날짜를 붙이고,
// 사용자가 직접 알려 준 것(생일, 좋아하는 간식, 좋아하는 것)을 따로 둔다. 알려 준 것은 AI 가 없어도 말풍선에 쓴다
// (생일 인사, 좋아하는 간식 한마디). 모두 순수 함수다. 저장과 창은 main/knows.ts.
import { cleanMemoryItem, memoryKey } from './pet-memory.ts';
import type { Settings } from './settings.ts';

/** 기억이 어디서 왔는지: chat 채팅의 AI 가 짝꿍 도구로, user 사용자가 직접, mcp 다른 AI 프로그램(Claude Code 등)이 */
export const MEM_SOURCES = ['chat', 'user', 'mcp'] as const;
export type MemSource = (typeof MEM_SOURCES)[number];
export interface MemNote {
  src: MemSource;
  /** 기억한 때 (ms). 기다리는 기억이면 기다리기 시작한 때 */
  at: number;
}
/** 기억 열쇠(memoryKey) → 출처와 날짜. 이 칸이 생기기 전 기억은 없다 (화면은 출처를 비워 둔다) */
export type MemMeta = Record<string, MemNote>;

const isSource = (v: unknown): v is MemSource => MEM_SOURCES.includes(v as MemSource);

/** 저장 파일이나 화면에서 온 출처 표를 고른다. 지금 기억하거나 기다리는 글의 것만 남긴다 */
export function cleanMeta(raw: unknown, texts: readonly string[]): MemMeta {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const keep = new Set(texts.map(memoryKey));
  const out: MemMeta = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (!keep.has(k) || typeof v !== 'object' || v === null) continue;
    const n = v as Record<string, unknown>;
    if (!isSource(n.src) || typeof n.at !== 'number' || !Number.isFinite(n.at) || n.at <= 0) continue;
    out[k] = { src: n.src, at: Math.floor(n.at) };
  }
  return out;
}

type MemFields = Pick<Settings, 'petMemory' | 'petMemoryPending' | 'petMemoryMeta'>;

/**
 * 설정이 바뀔 때 새로 생긴 기억에 출처와 날짜를 붙인다 (main/settings.ts set).
 * 기다리던 것을 허락했으면 그 출처(MCP, 대화)를 이어 받고 날짜는 허락한 때, 바꾸는 값에 출처를 같이 넣었으면 그것,
 * 아니면 기억은 직접(user), 기다리는 것은 MCP. 원래 있던 기억은 건드리지 않는다
 */
export function stampMemory(prev: MemFields, next: MemFields, now: number): MemMeta {
  const meta: MemMeta = { ...next.petMemoryMeta };
  const had = new Set(prev.petMemory.map(memoryKey));
  const waited = new Set(prev.petMemoryPending.map(memoryKey));
  // 바꾸는 값에 새 출처를 넣었는지 (값으로 견준다: 설정을 다시 읽으면 같은 값도 새 객체다)
  const given = (k: string) => {
    const a = next.petMemoryMeta[k];
    const b = prev.petMemoryMeta[k];
    return a !== undefined && (b === undefined || a.src !== b.src || a.at !== b.at);
  };
  for (const item of next.petMemory) {
    const k = memoryKey(item);
    if (had.has(k) || given(k)) continue;
    meta[k] = waited.has(k)
      ? { src: prev.petMemoryMeta[k]?.src ?? 'mcp', at: now }
      : { src: 'user', at: now };
  }
  for (const item of next.petMemoryPending) {
    const k = memoryKey(item);
    if (waited.has(k) || given(k)) continue;
    meta[k] = { src: 'mcp', at: now };
  }
  return cleanMeta(meta, [...next.petMemory, ...next.petMemoryPending]);
}

// ---- 직접 알려 준 것 ----

export const FACT_KINDS = ['birthday', 'food', 'like'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export interface PetFact {
  kind: FactKind;
  /** 생일은 MM-DD, 나머지는 짧은 글 */
  value: string;
  at: number;
}
/** 좋아하는 것은 다섯 개까지, 글은 30자까지 (말풍선 한 줄에 들어가게) */
export const FACT_LIKES_MAX = 5;
export const FACT_TEXT_MAX = 30;

const isFactKind = (v: unknown): v is FactKind => FACT_KINDS.includes(v as FactKind);
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 생일 MM-DD. 2월 29일도 받는다. 틀리면 undefined */
export function cleanBirthday(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return undefined;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > (DAYS_IN[month - 1] ?? 0)) return undefined;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 짧은 글: 한 줄로, 30자까지 */
export function cleanFactText(v: unknown): string {
  return [...cleanMemoryItem(v)].slice(0, FACT_TEXT_MAX).join('').trim();
}

/** 저장 파일이나 화면에서 온 목록을 고른다: 생일과 간식은 하나씩(나중 것), 좋아하는 것은 다섯 개까지, 같은 것은 하나 */
export function cleanFacts(raw: unknown): PetFact[] {
  if (!Array.isArray(raw)) return [];
  let birthday: PetFact | undefined;
  let food: PetFact | undefined;
  const likes: PetFact[] = [];
  for (const v of raw.slice(0, 40)) {
    if (typeof v !== 'object' || v === null) continue;
    const f = v as Record<string, unknown>;
    if (!isFactKind(f.kind)) continue;
    const at = typeof f.at === 'number' && Number.isFinite(f.at) && f.at > 0 ? Math.floor(f.at) : 0;
    if (f.kind === 'birthday') {
      const value = cleanBirthday(f.value);
      if (value) birthday = { kind: 'birthday', value, at };
      continue;
    }
    const value = cleanFactText(f.value);
    if (!value) continue;
    if (f.kind === 'food') food = { kind: 'food', value, at };
    else if (!likes.some((l) => memoryKey(l.value) === memoryKey(value)))
      likes.push({ kind: 'like', value, at });
  }
  return [...(birthday ? [birthday] : []), ...(food ? [food] : []), ...likes.slice(-FACT_LIKES_MAX)];
}

/**
 * 알려 준 것 넣기. 생일과 간식은 바꾸고, 좋아하는 것은 더한다(같은 것이 있으면 그대로, 꽉 찼으면 full).
 * 틀린 값이면 bad
 */
export function addFact(
  list: readonly PetFact[],
  kind: FactKind,
  value: unknown,
  now: number,
): { list: PetFact[]; result: 'added' | 'dupe' | 'full' | 'bad' } {
  const clean = kind === 'birthday' ? cleanBirthday(value) : cleanFactText(value);
  if (!clean) return { list: [...list], result: 'bad' };
  if (kind === 'like') {
    const likes = list.filter((f) => f.kind === 'like');
    if (likes.some((f) => memoryKey(f.value) === memoryKey(clean)))
      return { list: [...list], result: 'dupe' };
    if (likes.length >= FACT_LIKES_MAX) return { list: [...list], result: 'full' };
    return { list: cleanFacts([...list, { kind, value: clean, at: now }]), result: 'added' };
  }
  const same = list.find((f) => f.kind === kind);
  if (same && same.value === clean) return { list: [...list], result: 'dupe' };
  return {
    list: cleanFacts([...list.filter((f) => f.kind !== kind), { kind, value: clean, at: now }]),
    result: 'added',
  };
}

/** 오늘(YYYY-MM-DD)이 생일인지. 2월 29일 생일은 평년에 2월 28일 */
export function isBirthday(list: readonly PetFact[], day: string): boolean {
  const b = list.find((f) => f.kind === 'birthday')?.value;
  if (!b) return false;
  const md = day.slice(5);
  if (b === md) return true;
  const year = Number(day.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return b === '02-29' && !leap && md === '02-28';
}

/** 생일 MM-DD 를 말에 넣을 월, 일 숫자로 */
export function birthdayParts(mmdd: string): { m: number; d: number } {
  return { m: Number(mmdd.slice(0, 2)), d: Number(mmdd.slice(3, 5)) };
}

/**
 * AI 에 같이 보낼 줄 (기억 목록 앞에 붙인다). 사용자가 직접 적은 것이라 허락 없이 보낸다.
 * 글은 부르는 쪽이 고른 말로 (lines 는 t 를 넘겨받아 쓴다: 이 파일은 사전을 직접 읽지 않는다)
 */
export function factsForAi(
  list: readonly PetFact[],
  line: (kind: FactKind, vars: { value: string; m?: number; d?: number }) => string,
): string[] {
  return list.map((f) =>
    f.kind === 'birthday'
      ? line('birthday', { value: f.value, ...birthdayParts(f.value) })
      : line(f.kind, { value: f.value }),
  );
}

/** 좋아하는 것 한마디를 고를 때 쓰는 값. 알려 준 것이 없으면 undefined */
export function pickFactTalk(
  list: readonly PetFact[],
  rand: () => number = Math.random,
): { kind: 'food' | 'like'; value: string; variant: 1 | 2 } | undefined {
  const pool = list.filter((f): f is PetFact & { kind: 'food' | 'like' } => f.kind !== 'birthday');
  if (pool.length === 0) return undefined;
  const f = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] as PetFact & {
    kind: 'food' | 'like';
  };
  return { kind: f.kind, value: f.value, variant: rand() < 0.5 ? 1 : 2 };
}

/** 좋아하는 것 한마디를 해도 되는 시각 (현지 11시~20시. 아침 브리핑과 밤 인사와 겹치지 않게) */
export const factTalkHour = (hour: number): boolean => hour >= 11 && hour < 20;

// ---- 화면 목록 ----

export type KnowKind = 'fact' | 'memory' | 'pending' | 'rule';
export interface KnowRow {
  /** 화면 열쇠: fact:birthday, fact:like:<열쇠>, memory:<열쇠>, pending:<열쇠>, rule:<줄 번호> */
  id: string;
  kind: KnowKind;
  text: string;
  /** 출처. 규칙과 알려 준 것은 user, 이 칸이 생기기 전 기억은 없다 */
  src?: MemSource;
  at?: number;
  /** 알려 준 것이면 그 종류 */
  fact?: FactKind;
  /** 규칙이면 petRules 안 줄 번호 */
  line?: number;
}

type KnowFields = Pick<
  Settings,
  'petFacts' | 'petMemory' | 'petMemoryPending' | 'petMemoryMeta' | 'petRules'
>;

/** 짝꿍이 아는 것 화면에 늘어놓을 줄: 알려 준 것, 기억, 기다리는 기억, 규칙 순 */
export function knowRows(s: KnowFields): KnowRow[] {
  const rows: KnowRow[] = [];
  for (const f of s.petFacts)
    rows.push({
      id: f.kind === 'like' ? `fact:like:${memoryKey(f.value)}` : `fact:${f.kind}`,
      kind: 'fact',
      text: f.value,
      src: 'user',
      ...(f.at > 0 ? { at: f.at } : {}),
      fact: f.kind,
    });
  const memo = (kind: 'memory' | 'pending', text: string): KnowRow => {
    const k = memoryKey(text);
    const note = s.petMemoryMeta[k];
    return { id: `${kind}:${k}`, kind, text, ...(note ? { src: note.src, at: note.at } : {}) };
  };
  for (const m of [...s.petMemory].reverse()) rows.push(memo('memory', m));
  for (const m of s.petMemoryPending) rows.push(memo('pending', m));
  s.petRules.split('\n').forEach((line, i) => {
    const text = line.trim();
    if (text) rows.push({ id: `rule:${i}`, kind: 'rule', text, src: 'user', line: i });
  });
  return rows;
}

/** 규칙 한 줄 바꾸기. 비우면 그 줄을 지운다. 다른 줄은 그대로 */
export function editRule(rules: string, line: number, text: string): string {
  const lines = rules.split('\n');
  if (line < 0 || line >= lines.length) return rules;
  const clean = text.replace(/\s*\n\s*/g, ' ').trim();
  if (clean) lines[line] = clean;
  else lines.splice(line, 1);
  return lines.join('\n');
}

/** 기억 하나를 바꾼다(같은 자리). 비우면 지운다. 이미 같은 기억이 다른 자리에 있으면 dupe */
export function editMemory(
  list: readonly string[],
  from: string,
  to: unknown,
): { list: string[]; result: 'changed' | 'removed' | 'dupe' | 'same' } {
  const clean = cleanMemoryItem(to);
  const k = memoryKey(from);
  if (!clean) return { list: list.filter((m) => memoryKey(m) !== k), result: 'removed' };
  if (clean === from) return { list: [...list], result: 'same' };
  if (list.some((m) => memoryKey(m) === memoryKey(clean) && memoryKey(m) !== k))
    return { list: [...list], result: 'dupe' };
  return { list: list.map((m) => (memoryKey(m) === k ? clean : m)), result: 'changed' };
}

/** 모두 잊기: 기억, 기다리는 기억, 알려 준 것. 규칙은 고른 때만 */
export function forgetAll(withRules: boolean): Partial<Settings> {
  return {
    petMemory: [],
    petMemoryPending: [],
    petMemoryMeta: {},
    petFacts: [],
    ...(withRules ? { petRules: '' } : {}),
  };
}
