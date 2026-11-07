// 기기 간 동기화의 항목 합치기 (docs/sync-plan.md 6절). 저장 파일도 서버도 모르는 순수 셈이라 단위 시험이 쉽다.
// 항목 하나는 칸 값(f)과 칸마다 시각(c)이다. 칸마다 시각이 큰 쪽이 이기고, 같으면 값의 정해진 글자 순서로 정한다
// (어느 기기에서 합쳐도 같은 쪽이 남는다). 메모 본문만 마지막으로 맞춘 본문(base)과 견줘 따로 정한다.
import { cutText } from './cut-text.ts';
import { appendsTo, mergeNoteText, NOTE_TITLE_MAX, noteFormatOf } from './note-store.ts';
import type { SyncKind } from './sync-fields.ts';
import { derivedUid, sha256Hex } from './sync-uid.ts';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface SyncItem {
  kind: SyncKind;
  uid: string;
  /** 칸 값. 정수 연결은 uid 로 바꿔 둔다 */
  f: Record<string, Json>;
  /** 칸마다 시각 (ms, 하이브리드 논리 시계) */
  c: Record<string, number>;
  /** 보낸 기기의 번호 (이름은 싣지 않는다: 컴퓨터 이름에 실명이 들어 있을 수 있다) */
  dev: string;
  /** 메모: 보낸 기기가 마지막으로 서버와 맞춘 본문의 지문 (없으면 처음 보내는 것) */
  bh?: string | null;
  /** 충돌 사본이면 원본 uid */
  copyOf?: string;
}

export const DAY_MS = 86_400_000;

/** 값을 키 순서가 정해진 글자로 (비교와 지문용) */
export function canon(v: Json | undefined): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

/** 받은 칸 시각이 지금보다 하루 넘게 앞서면 지금 + 1일로 자른다 (틀린 시계 하나가 모두를 미래로 끌지 못하게) */
export const clampClock = (t: number, now: number): number => Math.min(t, now + DAY_MS);

/** a 가 b 를 이기나: 시각이 크면, 같으면 값의 글자 순서가 뒤인 쪽 */
export function beats(ta: number, va: Json | undefined, tb: number, vb: Json | undefined): boolean {
  if (ta !== tb) return ta > tb;
  return canon(va) > canon(vb);
}

export const bodyHash = (body: string): string => sha256Hex(body).slice(0, 32);

export interface NoteSeen {
  /** 마지막으로 서버와 맞춘 본문의 지문과 본문 (세 갈래 합치기의 base) */
  hash: string | null;
  body: string | null;
}

export interface NoteBodyResult {
  body: string;
  t: number;
  /** 지금 이 기기 본문이 졌다 (원격 것이 남는다) */
  localLost?: boolean;
  /** 합쳐지지 않아 진 쪽을 충돌 사본으로 남긴다 */
  copy?: { body: string; t: number; hash: string; fromLocal: boolean };
}

/**
 * 메모 본문 하나를 정한다. 양쪽 모두 base 와 다를 때만 충돌이다.
 * 둘 다 고쳤으면 먼저 세 갈래 합치기(진 쪽이 base 뒤에 덧붙인 것만)를 해 보고, 안 되면 진 쪽을 충돌 사본으로 남긴다
 */
export function decideNoteBody(
  local: { body: string; t: number } | undefined,
  seen: NoteSeen | undefined,
  remote: { body: string; t: number; baseHash: string | null },
): NoteBodyResult {
  if (!local) return { body: remote.body, t: remote.t };
  if (local.body === remote.body) return { body: local.body, t: Math.max(local.t, remote.t) };
  const localEdited = !seen || seen.hash === null || bodyHash(local.body) !== seen.hash;
  const remoteEdited = remote.baseHash === null || bodyHash(remote.body) !== remote.baseHash;
  const localWins = beats(local.t, local.body, remote.t, remote.body);
  if (!localEdited && !remoteEdited)
    return localWins ? { body: local.body, t: local.t } : { body: remote.body, t: remote.t, localLost: true };
  if (!localEdited) return { body: remote.body, t: remote.t, localLost: true };
  if (!remoteEdited) return { body: local.body, t: local.t };
  const win = localWins ? local : remote;
  const lose = localWins ? remote : local;
  const base = seen && seen.hash !== null && seen.hash === remote.baseHash ? seen.body : null;
  if (base !== null && appendsTo(base, lose.body))
    return {
      body: mergeNoteText(base, win.body, lose.body),
      t: Math.max(local.t, remote.t) + 1,
      localLost: true,
    };
  return {
    body: win.body,
    t: win.t,
    ...(localWins ? {} : { localLost: true }),
    copy: { body: lose.body, t: lose.t, hash: bodyHash(lose.body), fromLocal: !localWins },
  };
}

export interface MergeResult {
  item: SyncItem;
  /** 합친 결과가 받은 것과 다르다 (이 기기가 앞선 칸이 있어 서버에도 보내야 한다) */
  ahead: boolean;
  /** 메모 충돌 사본으로 남길 것 */
  copy?: NonNullable<NoteBodyResult['copy']>;
  /** 이 기기에서 바뀐 칸 (받은 것이 이긴 칸) */
  changed: string[];
}

/** 같은 항목의 이 기기 것(local)과 받은 것(remote)을 칸마다 합친다. remote 의 시각은 이미 자른 것이어야 한다 */
export function mergeItems(
  local: SyncItem | undefined,
  remote: SyncItem,
  seen: NoteSeen | undefined,
): MergeResult {
  if (!local) return { item: remote, ahead: false, changed: Object.keys(remote.f) };
  const f: Record<string, Json> = {};
  const c: Record<string, number> = {};
  const changed: string[] = [];
  let copy: MergeResult['copy'];
  const keys = new Set([...Object.keys(local.f), ...Object.keys(remote.f)]);
  for (const k of keys) {
    const inL = k in local.f;
    const inR = k in remote.f;
    if (remote.kind === 'note' && k === 'body' && inL && inR) {
      const d = decideNoteBody({ body: String(local.f.body), t: local.c.body ?? 0 }, seen, {
        body: String(remote.f.body),
        t: remote.c.body ?? 0,
        baseHash: remote.bh ?? null,
      });
      f.body = d.body;
      c.body = d.t;
      if (d.body !== local.f.body) changed.push('body');
      if (d.copy) copy = d.copy;
      continue;
    }
    if (!inR) {
      f[k] = local.f[k] as Json;
      c[k] = local.c[k] ?? 0;
      continue;
    }
    if (!inL) {
      f[k] = remote.f[k] as Json;
      c[k] = remote.c[k] ?? 0;
      changed.push(k);
      continue;
    }
    const tl = local.c[k] ?? 0;
    const tr = remote.c[k] ?? 0;
    if (beats(tr, remote.f[k], tl, local.f[k])) {
      f[k] = remote.f[k] as Json;
      c[k] = tr;
      if (canon(remote.f[k]) !== canon(local.f[k])) changed.push(k);
    } else {
      f[k] = local.f[k] as Json;
      c[k] = tl;
    }
  }
  const item: SyncItem = { ...remote, f, c };
  return { item, ahead: !sameContent(item, remote), changed, ...(copy ? { copy } : {}) };
}

/** 칸 값과 시각이 모두 같은가 */
export function sameContent(a: SyncItem, b: SyncItem): boolean {
  const keys = new Set([...Object.keys(a.f), ...Object.keys(b.f)]);
  for (const k of keys) {
    if (canon(a.f[k]) !== canon(b.f[k])) return false;
    if ((a.c[k] ?? 0) !== (b.c[k] ?? 0)) return false;
  }
  return true;
}

/** 내용 지문 (보낸 뒤 그사이 고쳤는지 보는 데 쓴다) */
export const contentHash = (it: SyncItem): string =>
  sha256Hex(canon(it.f) + canon(it.c as unknown as Json) + (it.bh ?? '')).slice(0, 32);

/** 충돌 사본 uid: H(원본 uid, 진 쪽 칸 시각, 진 쪽 본문 지문). 어느 기기가 만들어도 같다 */
export const conflictCopyUid = (origUid: string, loserT: number, loserHash: string): string =>
  derivedUid(`${origUid}:conflict:${loserT}:${loserHash}`);

/** 충돌 사본 항목을 만든다. 모든 칸의 시각이 진 쪽 본문 시각이라 어느 기기가 만들어도 같고, 같으면 값 순서로 수렴한다 */
export function conflictCopy(
  orig: SyncItem,
  copy: NonNullable<MergeResult['copy']>,
  title: string,
  dev: { id: string },
): SyncItem {
  const t = copy.t;
  const f: Record<string, Json> = {
    title: cutText(title, NOTE_TITLE_MAX),
    body: copy.body,
    source: (orig.f.source as Json) ?? 'me',
    created_at: copy.t,
    updated_at: copy.t,
    deleted_at: null,
    pinned_at: null,
    // 사본도 원본과 같은 형식으로 보인다 (마크다운 글이 글자 그대로 보이지 않게)
    format: noteFormatOf(orig.f.format),
  };
  const c: Record<string, number> = {};
  for (const k of Object.keys(f)) c[k] = t;
  return {
    kind: 'note',
    uid: conflictCopyUid(orig.uid, copy.t, copy.hash),
    f,
    c,
    dev: dev.id,
    bh: null,
    copyOf: orig.uid,
  };
}

// ---- 구글 일정 id ----

const B32HEX = '0123456789abcdefghijklmnopqrstuv';

/**
 * 항목 uid 에서 정한 구글 일정 id (구글 규칙: a~v, 0~9, 5~1024자). 어느 기기가 보내도 같은 id 가 된다.
 * uid 가 32자리 16진이면 그대로 바이트로 보고, 아니면 지문을 쓴다. 머리 + 26글자(130비트 중 128비트).
 * prefix 는 일정은 jjk, 할 일은 jjt (shared/gcal.ts GCAL_ID_PREFIX, GCAL_TODO_ID_PREFIX)
 */
export function googleIdFromUid(uid: string, prefix: string): string {
  const hex = /^[0-9a-f]{32}$/.test(uid) ? uid : sha256Hex(uid).slice(0, 32);
  let bits = '';
  for (const ch of hex) bits += Number.parseInt(ch, 16).toString(2).padStart(4, '0');
  bits = bits.padEnd(130, '0');
  let out = prefix;
  for (let i = 0; i < 130; i += 5) out += B32HEX[Number.parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
