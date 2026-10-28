import { cmpVersion, isVersion, type UpdateLevels } from './shared/update-levels';

// 운영자 홈의 숫자 (이슈 #152): 일별 추이, 서버 백업 현황, 강제 업데이트로 잠기는 인원.
// 계산과 그림만 둔다 (DB 읽기는 admin.ts). 그림은 서버가 SVG 로 그린다: 인라인 스크립트도 style 속성도 쓰지 않는다 (CSP).

/** 추이를 보이는 날 수 */
export const TREND_DAYS = 14;

export interface TrendDay {
  /** 한국 날짜 (YYYY-MM-DD) */
  day: string;
  /** 새로 만들어진 계정 (합쳐져 닫힌 계정 제외) */
  signups: number;
  /** 그날 코인 기록이나 질문을 서버에 보낸 계정 */
  active: number;
  /** 질문 수 (ai_usage 줄 수. 이번 달 질문과 같은 셈) */
  asks: number;
  /** 추정 비용 (백만분의 1달러) */
  costMicros: number;
}

export interface TrendView {
  /** 집계에 쓰는 시간대 */
  zone: 'Asia/Seoul';
  /** 오래된 날부터, 오늘이 마지막. 일이 없었던 날도 0 으로 채운다 */
  days: TrendDay[];
}

export interface BackupStatus {
  /** 서버 백업이 켜져 있다 (BACKUP_ENC_KEY 가 있다) */
  enabled: boolean;
  /** 서버에 올라와 있는 백업 파일 수와 가진 계정 수 */
  files: number;
  accounts: number;
  /** 평문 기준 총 크기 (상한을 세는 값과 같다), 상한(없으면 null) */
  bytes: number;
  maxBytes: number | null;
  /** 가장 최근에 올라온 백업의 때 (ms), 없으면 null. 올리기에 실패한 기록은 서버가 남기지 않는다 */
  lastUploadAt: number | null;
  /** 다른 컨테이너가 맥미니 디스크에 하는 백업: 데이터베이스 덤프와 외장 디스크 사본. 그 컨테이너가 남긴 상태 파일로 안다 */
  external: ExternalBackup;
}

/** 밖에서 도는 백업 작업 하나의 상태 (상태 파일 db.*, files.* 에서 읽는다) */
export interface BackupJob {
  /** unknown: 상태 파일이 없다(아직 안 돌았거나 연결이 안 됐다), ok, stale: 마지막 성공이 오래됐다, failed: 마지막이 실패 */
  state: 'unknown' | 'ok' | 'stale' | 'failed';
  lastOkAt: number | null;
  lastOkNote: string | null;
  lastFailAt: number | null;
  lastFailReason: string | null;
  /** 작업 쪽이 마지막으로 확인한 때 (이 값이 멈췄으면 작업 컨테이너가 죽은 것이다) */
  checkedAt: number | null;
}

export interface ExternalBackup {
  db: BackupJob;
  files: BackupJob;
}

/** 이보다 오래 성공하지 못하면 경고 (하루 한 번 도는 작업에 두 시간 여유) */
export const BACKUP_STALE_MS = 26 * 3_600_000;
/** 상태 파일 한 줄: "<초 단위 시각><탭><글>" */
const MAX_NOTE = 200;

/** 상태 파일 한 줄을 (시각 ms, 글)로. 모양이 틀리면 null (읽다 만 파일, 엉뚱한 파일) */
export function parseStatusLine(raw: string | undefined): { at: number; note: string } | null {
  if (raw === undefined) return null;
  const m = /^(\d{9,11})(?:\t([^\n\r]*))?/.exec(raw.trim());
  if (!m) return null;
  const at = Number(m[1]) * 1000;
  if (!Number.isSafeInteger(at)) return null;
  // 글은 화면에만 쓴다 (화면이 이스케이프한다). 길이만 자른다
  return { at, note: (m[2] ?? '').trim().slice(0, MAX_NOTE) };
}

/** 작업 하나의 상태 파일 셋(ok, fail, checked) 내용으로 상태를 정한다 */
export function backupJobOf(
  raw: { ok?: string | undefined; fail?: string | undefined; checked?: string | undefined },
  now: number,
): BackupJob {
  const ok = parseStatusLine(raw.ok);
  const fail = parseStatusLine(raw.fail);
  const checked = parseStatusLine(raw.checked);
  const base = {
    lastOkAt: ok?.at ?? null,
    lastOkNote: ok ? ok.note || null : null,
    lastFailAt: fail?.at ?? null,
    lastFailReason: fail ? fail.note || '까닭을 남기지 않았어요' : null,
    checkedAt: checked?.at ?? null,
  };
  if (!ok && !fail && !checked) return { state: 'unknown', ...base };
  // 마지막 실패가 마지막 성공보다 뒤면 실패 (성공 시각이 같으면 성공)
  if (fail && (!ok || fail.at > ok.at)) return { state: 'failed', ...base };
  if (!ok || now - ok.at > BACKUP_STALE_MS) return { state: 'stale', ...base };
  return { state: 'ok', ...base };
}

export const UNKNOWN_JOB: BackupJob = {
  state: 'unknown',
  lastOkAt: null,
  lastOkNote: null,
  lastFailAt: null,
  lastFailReason: null,
  checkedAt: null,
};

/** 사용량이 이 비율(%) 이상이면 확인할 것에 올린다 */
export const BACKUP_WARN_PERCENT = 80;
export const BACKUP_BAD_PERCENT = 95;

/** 상한 대비 사용 비율(%, 내림). 상한이 없거나 0 이면 null (0 은 모두 막힘이라 따로 본다) */
export function backupPercent(b: Pick<BackupStatus, 'bytes' | 'maxBytes'>): number | null {
  if (!b.maxBytes || b.maxBytes <= 0) return null;
  return Math.floor((b.bytes / b.maxBytes) * 100);
}

/** 오늘(한국 날짜)부터 거슬러 올라가며 빈 날을 0 으로 채운다. rows 의 day 는 YYYY-MM-DD */
export function fillDays(
  today: string,
  rows: Array<{ day: string; signups?: number; active?: number; asks?: number; costMicros?: number }>,
  days = TREND_DAYS,
): TrendDay[] {
  const by = new Map<string, TrendDay>();
  const t = Date.parse(`${today}T00:00:00Z`);
  const out: TrendDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(t - i * 86_400_000).toISOString().slice(0, 10);
    const d: TrendDay = { day, signups: 0, active: 0, asks: 0, costMicros: 0 };
    by.set(day, d);
    out.push(d);
  }
  for (const r of rows) {
    const d = by.get(r.day);
    if (!d) continue;
    d.signups += r.signups ?? 0;
    d.active += r.active ?? 0;
    d.asks += r.asks ?? 0;
    d.costMicros += r.costMicros ?? 0;
  }
  return out;
}

export interface LockedStats {
  /** 지금 기준 (없으면 null) */
  min: string | null;
  restrict: string | null;
  /** 최근 30일 활동 계정 중 강제 기준보다 낮아 앱이 잠기는 수 */
  locked: number;
  /** 강제는 아니고 기능 제한 기준보다만 낮아 서버 기능이 거절되는 수 */
  restricted: number;
  /** 위 두 수에 든 판을 모르는 계정 (판 머리가 없으면 가장 낮은 판으로 본다) */
  unknown: number;
}

/**
 * 지금 기준으로 막히는 인원. 판 분포(최근 30일 활동 계정)에 서버 관문(gateOf)과 같은 규칙을 대 본다.
 * 판을 모르는 계정은 0.0.0 으로 본다 (기준이 있으면 막힌다). X.Y.Z 모양이 아닌 판도 모르는 것으로 센다.
 */
export function lockedStats(rows: Array<{ v: string | null; n: number }>, levels: UpdateLevels): LockedStats {
  let locked = 0;
  let restricted = 0;
  let unknown = 0;
  for (const r of rows) {
    const known = r.v !== null && isVersion(r.v);
    const v = known ? (r.v as string) : '0.0.0';
    const force = !!levels.min && cmpVersion(v, levels.min) < 0;
    const restrict = !force && !!levels.restrict && cmpVersion(v, levels.restrict) < 0;
    if (force) locked += r.n;
    else if (restrict) restricted += r.n;
    if ((force || restrict) && !known) unknown += r.n;
  }
  return { min: levels.min ?? null, restrict: levels.restrict ?? null, locked, restricted, unknown };
}

/** 기준 세 개를 걸었을 때 영향받는 인원 (최근 30일 활동 계정). 판을 모르는 계정은 0.0.0 으로 본다 */
export interface VersionImpact extends LockedStats {
  /** 최근 30일 활동한 계정 전체 */
  active: number;
  /** 권장 기준보다 낮아 업데이트 권장 알림을 받는 수 (잠기거나 막히는 계정도 포함) */
  recommended: number;
}

export function impactOf(rows: Array<{ v: string | null; n: number }>, levels: UpdateLevels): VersionImpact {
  let active = 0;
  let recommended = 0;
  for (const r of rows) {
    active += r.n;
    const v = r.v !== null && isVersion(r.v) ? r.v : '0.0.0';
    if (levels.recommend && cmpVersion(v, levels.recommend) < 0) recommended += r.n;
  }
  return { ...lockedStats(rows, levels), active, recommended };
}

// ---- 그림 ----

const W = 280;
const H = 64;
const PAD = 2;

/** "10-23" 같은 짧은 날짜 */
export const shortDay = (day: string) => day.slice(5);

/**
 * 막대 그림 하나. 값은 오래된 날부터. 가장 큰 값이 높이를 채우고, 0 인 날은 얇은 바닥 선만 둔다.
 * 오늘 막대는 class "today" 로 진하게 한다. 막대마다 <title> 로 값을 말한다 (눈 대신 마우스와 읽기 도구용).
 */
export function barChart(
  label: string,
  days: string[],
  values: number[],
  fmt: (n: number) => string,
  esc: (v: unknown) => string,
): string {
  const n = values.length;
  const max = Math.max(...values, 0);
  const slot = (W - PAD * 2) / Math.max(n, 1);
  const bw = Math.max(2, slot - 3);
  const bars = values
    .map((v, i) => {
      const h = max > 0 ? Math.max(v > 0 ? 2 : 1, Math.round((v / max) * (H - 6))) : 1;
      const x = (PAD + i * slot + (slot - bw) / 2).toFixed(1);
      const cls = i === n - 1 ? 'bar today' : v === 0 ? 'bar zero' : 'bar';
      return `<rect class="${cls}" x="${x}" y="${H - h}" width="${bw.toFixed(1)}" height="${h}" rx="1.5"><title>${esc(shortDay(days[i] ?? ''))} ${esc(fmt(v))}</title></rect>`;
    })
    .join('');
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}, 최근 ${n}일, 가장 큰 날 ${esc(fmt(max))}">${bars}</svg>`;
}
