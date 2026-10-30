// 운영자 화면 HTML (이슈 #101). 스크립트 없이 폼만 쓴다. 바깥 글꼴, CDN, 인라인 스타일 없음 (CSP: style-src 'self').
// 사용자가 넣은 글(공지, 이벤트, 닉네임, 기록)은 모두 esc 로 바꿔 넣는다. 사용자에게 보이는 이름은 "채팅 이용권"
// (서버 코드와 표 이름은 ai_ticket 그대로).
import {
  BACKUP_BAD_PERCENT,
  BACKUP_WARN_PERCENT,
  type BackupJob,
  type BackupStatus,
  backupPercent,
  barChart,
  type ExternalBackup,
  type LockedStats,
  type TrendView,
  type VersionImpact,
} from './admin-home';
import { formDefaults, POSTS_PER_KIND, type PostRow, type PostsView } from './admin-posts';
import type { AiSettings, SubscriptionInfo } from './ai-admin';
import { FEATURES, type FeatureView } from './features';
import type { EventRow } from './feeds';
import type { DocNotice, NoticeDoc } from './notice-doc';
import { kstIso, type SiteEvent } from './shared/site-events';

export interface AdminAccountRow {
  id: string;
  code: string;
  nickname: string | null;
  age: string;
  balance: number;
  merged_into: string | null;
}

/**
 * 운영자 화면의 다섯 칸 (이슈 #150). 칸마다 아래 칸(하위)을 둘 수 있고, 현재 자리는 주소 해시(#칸 또는 #칸/하위)로 둔다.
 * 새 화면은 여기에 칸이나 하위를 더하고 그 칸의 section 함수를 mainPage 에 붙이면 된다 (신고 목록은 reportsSection 자리).
 */
export const ADMIN_CELLS = ['home', 'users', 'reports', 'announce', 'settings'] as const;
export type AdminCell = (typeof ADMIN_CELLS)[number];
export const CELL_LABEL: Record<AdminCell, string> = {
  home: '홈',
  users: '이용자',
  reports: '신고',
  announce: '알리기',
  settings: '설정',
};
/** 하위가 없는 칸은 빈 목록 */
export const CELL_SUBS: Record<AdminCell, ReadonlyArray<readonly [string, string]>> = {
  home: [],
  users: [
    ['list', '이용자 찾기'],
    ['grants', '지급'],
  ],
  reports: [],
  announce: [
    ['posts', '게시물'],
    ['new', '만들기'],
  ],
  settings: [
    ['features', '기능 스위치'],
    ['ai', '예산, 정책'],
    ['backup', '백업'],
    ['log', '운영 기록'],
  ],
};
/** 옛 여덟 탭 주소가 가던 자리 (옛 주소는 새 자리로 돌려보낸다) */
export const LEGACY_PLACES: Record<string, string> = {
  '': 'home',
  users: 'users/list',
  grants: 'users/grants',
  notices: 'announce/posts',
  events: 'announce/posts',
  features: 'settings/features',
  ai: 'settings/ai',
  log: 'settings/log',
};
/** 칸 안 자리 ("users/grants" 같은 해시 글) */
export type AdminPlace = string;

/** 신고 처리 상태 (미처리, 확인, 조치) */
export const REPORT_STATES = ['pending', 'seen', 'done'] as const;
export type ReportState = (typeof REPORT_STATES)[number];
export type ReportFilter = ReportState | 'all';
export const REPORT_STATE_KO: Record<ReportState, string> = { pending: '미처리', seen: '확인', done: '조치' };

/** 신고 목록 한 줄. 대화 본문은 없다 (열어 봐야 보이고, 연 기록이 운영 기록에 남는다) */
export interface ReportRow {
  id: string;
  at: number;
  accountId: string;
  code: string;
  nickname: string | null;
  status: ReportState;
  handledBy: string | null;
  handledName: string | null;
  handledAt: number | null;
  /** 이 이용자의 채팅 이용권이 지금 막혀 있다 */
  blocked: boolean;
  /** 이 이용자가 받은 신고 수 (지금 남아 있는 것) */
  sameUser: number;
}

/** 본문을 연 신고 하나 */
export interface ReportOpen extends ReportRow {
  /** 이용자가 지금 만 18세 이상이 아니라 글을 열지 않았다 */
  closed: boolean;
  question: string;
  answer: string;
  /** 같은 이용자의 다른 신고 */
  others: Array<{ id: string; at: number; status: ReportState }>;
}

export interface AdminUserRow {
  id: string;
  code: string;
  nickname: string | null;
  logins: string[];
  age: string;
  balance: number;
  tickets: number;
  lastActive: number;
  created: number;
  appVersion: string | null;
}

export interface AdminUsersPage {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
  query: string;
  sort: 'active' | 'coins' | 'created';
  direction: 'asc' | 'desc';
}

/** 지급 대상 한 줄 (대상 확인 단계) */
export interface GrantTarget {
  ref: string;
  found: boolean;
  id?: string | undefined;
  code?: string | undefined;
  nickname?: string | null | undefined;
  age?: string | undefined;
  /** 같은 사람을 두 번 적었다 */
  duplicate?: boolean | undefined;
  /** 적은 계정이 합쳐져 닫힌 것이라 남은 계정(id)이 대신 받는다. 이 값이 합쳐진 계정 번호 */
  mergedFrom?: string | undefined;
}

/** 쪽지 하나의 받음 상태 (운영자가 보낸 지급, 알림, 정기 지급). 서버가 아는 것은 쪽지를 연 시각과 그때 실제로 받은 양 */
export interface GrantTrail {
  id: string;
  kind: string;
  message: string | null;
  coins: number;
  passes: number;
  fillTo: number | null;
  sentAt: number;
  expiresAt: number | null;
  openedAt: number | null;
  openedCoins: number | null;
  openedPasses: number | null;
  expired: boolean;
  /** 운영자가 철회한 때 (철회한 쪽지는 이용자 쪽지함에서 빠지고 열 수 없다) */
  withdrawnAt: number | null;
  accountId: string;
  code: string;
  nickname: string | null;
}

/** 이용자 상세의 내역 (합친 계정 묶음 기준, 최근 몇 건) */
export interface UserHistory {
  coins: Array<{ reason: string; amount: number; status: string; at: number }>;
  notes: GrantTrail[];
  log: Array<{
    at: string;
    actorName: string | null;
    actor: string;
    action: string;
    detail: unknown;
  }>;
}

/**
 * 발행과 지급의 공통 흐름 (작성, 대상 확인, 미리보기, 확정, 결과 확인)에서 대상 확인까지 끝난 것.
 * 서버 세션에 한 번에 하나만 둔다. 새로 고쳐도 남고 "고치기", 확정, 다른 쓰기가 지운다
 */
export type FlowPreview =
  | {
      action: 'grants/batch';
      fields: Record<string, string | string[]>;
      nonce: string;
      grant: {
        targets: GrantTarget[];
        people: number;
        coins: number;
        passes: number;
        days: number;
        reason: string;
        /** 이 까닭이 있으면 확정할 수 없다 (찾지 못한 계정, 만 18세 미만에게 채팅 이용권) */
        blocked: string | null;
      };
    }
  | {
      action: 'coins/revoke';
      fields: Record<string, string | string[]>;
      nonce: string;
      revoke: {
        found: boolean;
        id?: string | undefined;
        code?: string | undefined;
        nickname?: string | null | undefined;
        /** 적은 계정이 합쳐져 닫힌 것이라 남은 계정에서 뺀다. 이 값이 합쳐진 계정 번호 */
        mergedFrom?: string | undefined;
        balance: number;
        coins: number;
        after: number;
        reason: string;
        /** 이 까닭이 있으면 확정할 수 없다 (없는 계정, 잔액보다 많음) */
        blocked: string | null;
      };
    }
  | {
      action: 'notices';
      fields: Record<string, string | string[]>;
      nonce: string;
      notice: DocNotice;
      /** 같은 id 의 공지가 이미 있으면 그 제목 (바꾸기) */
      replaces: string | null;
    }
  | {
      action: 'events';
      fields: Record<string, string | string[]>;
      nonce: string;
      event: SiteEvent;
      /** 같은 id 의 이벤트가 이미 있으면 만들 수 없다 */
      exists: boolean;
      /** 선물과 쿠폰을 로그인 계정만 받는지 */
      loginOnly: boolean;
    }
  | {
      action: 'coupons';
      fields: Record<string, string | string[]>;
      nonce: string;
      coupon: {
        label: string;
        coins: number;
        tickets: number;
        maxUses: number;
        from: number | null;
        until: number;
      };
      loginOnly: boolean;
    }
  | {
      action: 'versions';
      fields: Record<string, string | string[]>;
      nonce: string;
      before: { min: string; restrict: string; rec: string };
      after: { min: string; restrict: string; rec: string };
      /** 올리는 기준 (최소와 기능 제한은 확인 칸이 있어야 한다) */
      raises: { min: boolean; restrict: boolean; rec: boolean };
      impactNow: VersionImpact;
      impactAfter: VersionImpact;
      latest: string | null;
      /** 같이 넣는 안내문 */
      message: DocNotice | null;
      /** 같은 id 의 공지가 이미 있으면 그 제목 (바꿔요) */
      replaces: string | null;
      /** 이 까닭이 있으면 확정할 수 없다 (최신 릴리스보다 높음, 최신 릴리스를 못 읽음) */
      blocked: string | null;
      needsConfirm: boolean;
    };

/** 홈의 "지금 확인할 것" 한 줄 (서버가 계산하고 웹 홈과 앱 요약이 같이 쓴다) */
export interface AdminTodo {
  kind: 'reports' | 'budget' | 'ending_events' | 'ending_coupons' | 'backup' | 'backup_db' | 'backup_files';
  level: 'warn' | 'bad';
  /** 신고 건수, 끝나는 이벤트나 쿠폰 수, 예산과 백업은 쓴 비율(%) */
  n: number;
  /** 눌렀을 때 가는 자리 */
  place: AdminPlace;
}

export interface AdminView {
  tab: AdminCell;
  csrf: string;
  flash?:
    | {
        text: string;
        error: boolean;
        /** 실패한 폼의 쓰기 이름, 대상, 쓴 값 (다시 그릴 때 칸을 채우고 오류를 그 폼 옆에 둔다) */
        form?: string | undefined;
        scope?: string | undefined;
        fields?: Record<string, string | string[]> | undefined;
        /** 미리보기에서 "고치기" 로 돌아온 것 (오류는 아니고 쓰던 값만 되살린다) */
        edit?: boolean | undefined;
        /** 복사 단추로 보일 값 (쿠폰 원본 코드, 한 번만) */
        copy?: string | undefined;
        /** 결과 글이 달린 칸 (폼 이름으로 알 수 없을 때: 신고 칸에서 누른 막기는 이용자 칸이 아니라 신고 칸) */
        place?: string | undefined;
        /** 방금 쓰기로 처리한 신고 번호 (같은 신고를 열어 둔 채 보이게, 열람 기록은 다시 남기지 않는다) */
        report?: string | undefined;
      }
    | undefined;
  /** 결과 글이 달린 폼이 있는 칸 (그 폼이 화면에 없을 때 이 칸 맨 위에 대신 보인다) */
  flashPlace?: AdminPlace | undefined;
  /** 알리기 게시물 목록 (웹 화면만 채운다) */
  posts?: PostsView | undefined;
  /** 알리기 초안이 있는 폼과 저장 시각 (웹 화면만) */
  draftTimes?: Partial<Record<string, number>> | undefined;
  /** 쓰던 발행, 지급 흐름의 미리보기 (대상 확인까지 끝난 것) */
  preview?: FlowPreview | undefined;
  /** 지급 칸에 미리 채울 계정 (이용자 표의 지급 단추, 표에서 고른 사람들은 줄마다 하나) */
  grantRef?: string | undefined;
  /** 표에서 고른 사람들 (지급 칸에 이름으로 보인다) */
  picked?: Array<{ id: string; code: string; nickname: string | null }> | undefined;
  /** 20명을 넘게 골라 지급 칸에 못 넣은 사람 수 */
  pickedDropped?: number | undefined;
  /** 최근 지급 쪽지와 받았는지 (웹 화면만) */
  recentGrants?: GrantTrail[] | undefined;
  /**
   * 신고 (#151). total, pending, seen, done 은 건수(앱 요약도 읽는다), rows 와 open 은 웹 화면만 채운다
   * (앱 API /v1/admin/overview 에는 대화 본문이 없다: rows 는 비고 open 은 없다)
   */
  reports: {
    total: number;
    pending: number;
    seen: number;
    done: number;
    /** 보는 상태 (all, pending, seen, done) */
    filter: ReportFilter;
    rows: ReportRow[];
    /** 본문을 연 신고 하나. 없는 신고(지워졌거나 번호가 틀림)면 null, 열지 않았으면 undefined */
    open?: ReportOpen | null | undefined;
    /** 열어 둔 신고 말고 다음 미처리 신고 번호 (없으면 null). 웹 화면만 채운다 */
    next?: string | null | undefined;
  };
  todo: AdminTodo[];
  /** 최근 운영 기록 몇 줄 (찾기 조건과 상관없이) */
  recent: Array<{
    at: string;
    actor: string;
    actorName: string | null;
    action: string;
    target: string | null;
    targetName: string | null;
  }>;
  summary: {
    accounts: number;
    coins: number;
    tickets: number;
    earnedDay: number;
    spentDay: number;
    aiCostMicros: number;
    aiAsks: number;
    aiBudgetMicros: number;
  };
  /** 찾은 말 (계정 번호, 기기 코드, 닉네임) */
  query: string | undefined;
  accounts: AdminAccountRow[];
  users: AdminUsersPage;
  /** 하나만 찾았을 때 자세히. 못 찾았으면 null, 여럿이거나 찾지 않았으면 undefined */
  account:
    | (AdminAccountRow & {
        created: number;
        logins: string[];
        claims: number;
        coupons: number;
        notes: number;
        /** 찾은 계정이 합쳐져 닫힌 것이라 남은 계정을 대신 보인다. 이 값이 합쳐진 계정 번호 */
        mergedFrom?: string | undefined;
        /** 코인, 쪽지, 운영 기록 내역 (웹 화면만 채운다) */
        history?: UserHistory | undefined;
        /** 이 이용자의 신고 (본문은 없다). total 은 남아 있는 전체 건수 */
        reports: { total: number; rows: Array<{ id: string; at: number; status: ReportState }> };
        /** 운영자 구글 계정 (sub 는 보이지 않는다) */
        admin: boolean;
        ai: {
          remaining: number;
          blocked: boolean;
          allowed: boolean;
          monthAsks: number;
          monthCostMicros: number;
          subscription: SubscriptionInfo | null;
        };
      })
    | null
    | undefined;
  ai: AiSettings & {
    allow: Array<{ id: string; code: string; nickname: string | null }>;
    waitlist: Array<{ id: string; code: string; nickname: string | null; since: string }>;
  };
  events: Array<EventRow & { claims: number }>;
  coupons: Array<{
    id: string;
    hint: string;
    label: string;
    coins: number;
    tickets: number;
    starts: string;
    ends: string;
    max_uses: number;
    used: number;
    disabled: boolean;
  }>;
  notices: NoticeDoc | undefined;
  noticesUpdated: number | undefined;
  /** 최신 릴리스. 못 읽으면 null (키는 늘 실어 보낸다) */
  latest: string | null;
  /** 선물과 쿠폰은 로그인 계정만 */
  rewardsLoginOnly: boolean;
  /** 기능 스위치 (#102, features.ts): kakao_login, coin_reset, calendar_link_hint (#115) */
  features: FeatureView[];
  /**
   * 스위치(기능 키, 채팅 이용권은 ai_chat)마다 가장 최근에 바꾼 기록. 표의 이전 값과 되돌리기가 읽는다.
   * 기록이 없는 스위치(서버 설정 기본값 그대로)는 키가 없다
   */
  switchLast: Record<
    string,
    { before: string; after: string; at: number; actor: string; actorName: string | null }
  >;
  /** 앱 판 분포 (이슈 #120): 최근 30일 활동 계정의 마지막 앱 판 */
  versions: {
    active: number;
    unknown: number;
    rows: { version: string; count: number }[];
    /** 지금 업데이트 기준으로 잠기거나 기능이 막히는 인원 (#152) */
    locked: LockedStats;
  };
  /** 최근 14일 일별 추이와 서버 백업 현황 (#152) */
  trend: TrendView;
  backup: BackupStatus;
  /** 운영 기록 한 쪽. actorName 은 옛 기록에서 null (actor 를 그대로 보인다), targetName 은 대상이 계정일 때 */
  log: Array<{
    at: string;
    actor: string;
    actorName: string | null;
    action: string;
    target: string | null;
    targetName: string | null;
    detail: unknown;
  }>;
  logPage: {
    total: number;
    page: number;
    pages: number;
    user: string;
    action: string;
    text: string;
    actions: string[];
    /** 대상 이용자로 적은 말에 맞는 계정이 없다 */
    userMissing: boolean;
  };
}

export function esc(v: unknown): string {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 한국 시간 "2026-10-20 09:00" */
const when = (ms: number | string) => kstIso(Number(ms)).slice(0, 16).replace('T', ' ');
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

function doc(title: string, body: string, o: { script?: boolean; flash?: string } = {}): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/admin/admin.css">${o.script ? '\n<script src="/admin/admin.js"></script>' : ''}
</head>
<body${o.flash ? ` data-flash="${o.flash}"` : ''}>
${body}
</body>
</html>`;
}

export function loginPage(o: { error?: string; off?: boolean }): string {
  return doc(
    '페어리 운영자',
    `<main class="narrow">
<h1>페어리 운영자</h1>
${o.error ? `<p class="flash error" role="alert">${esc(o.error)}</p>` : ''}
${
  o.off
    ? ''
    : `<form method="post" action="/admin/login">
<label>운영자 토큰 <input type="password" name="token" autocomplete="current-password" required maxlength="200" autofocus></label>
<button type="submit">로그인</button>
</form>
<p class="hint">로그인은 30분 동안 유지돼요. 틀린 시도는 15분에 5번까지예요.</p>`
}
</main>`,
  );
}

const hidden = (csrf: string) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
const confirmBox = (what: string) =>
  `<label class="confirm"><input type="checkbox" name="confirm" value="yes" required> ${esc(what)}</label>`;

type Flash = NonNullable<AdminView['flash']>;

/** 이 폼의 실패 기록이면 그때 쓴 값 (한 번만 보이고 사라진다). scope 는 같은 모양의 폼이 여럿일 때 대상 (기능 키, 계정) */
const draftOf = (v: Pick<AdminView, 'flash'>, action: string, scope?: string) => {
  const f: Flash | undefined = v.flash;
  return (f?.error || f?.edit) && f.form === action && (scope === undefined || (f.scope ?? '') === scope)
    ? (f.fields ?? {})
    : undefined;
};
type Draft = ReturnType<typeof draftOf>;
const val = (d: Draft, name: string, fallback = ''): string => {
  const x = d?.[name];
  return typeof x === 'string' ? x : fallback;
};
/** 고르는 칸의 선택: 실패한 값이 있으면 그것, 없으면 처음 값 */
const opt = (d: Draft, name: string, value: string, label: string, fallback: string) =>
  `<option value="${esc(value)}"${val(d, name, fallback) === value ? ' selected' : ''}>${esc(label)}</option>`;
/**
 * 결과 글은 누른 폼 안 맨 위에 둔다 (오류는 빨갛게, 성공은 초록으로). 오류는 주소 조각(#form-error)이 아니라 admin.js 가
 * 화면을 그 자리로 가져온다. skipOk 는 성공을 따로 그리는 흐름 폼(flowResult)용
 */
const formErr = (v: Pick<AdminView, 'flash'>, action: string, scope?: string, skipOk = false): string => {
  const f: Flash | undefined = v.flash;
  if (!f || f.edit || f.form !== action || (scope !== undefined && (f.scope ?? '') !== scope)) return '';
  if (f.error) return `<p class="flash error wide" role="alert" id="form-error">${esc(f.text)}</p>`;
  return skipOk ? '' : `<p class="flash wide" role="status" id="form-ok">${esc(f.text)}</p>`;
};

/**
 * 되돌릴 수 없는 동작: 대상 이름이 적힌 확인 칸을 체크해야 단추가 눌린다 (서버도 웹 폼은 확인이 없으면 거절한다).
 * what 은 "이벤트 '신년' (new-year) 지금 끝낼게요" 처럼 대상과 동작이 한 문장
 */
function sureForm(
  v: Pick<AdminView, 'flash' | 'csrf'>,
  action: string,
  fields: Record<string, string>,
  what: string,
  button: string,
  /** 결과 글을 이 폼 안에 그린다. 같은 모양의 폼이 줄마다 있으면 끄고 표 위에서 한 번만 그린다 */
  showErr = true,
): string {
  const scope = fields.key ?? fields.account ?? fields.id;
  const inputs = Object.entries(fields)
    .map(([k, x]) => `<input type="hidden" name="${esc(k)}" value="${esc(x)}">`)
    .join('');
  return `<form method="post" action="${esc(action)}" class="sure">${showErr ? formErr(v, action, scope) : ''}${hidden(v.csrf)}${inputs}<label class="confirm"><input type="checkbox" name="confirm" value="${esc((fields.id ?? fields.account ?? '').trim())}" required> ${esc(what)}</label><button type="submit" class="danger">${esc(button)}</button></form>`;
}

function postButton(
  csrf: string,
  action: string,
  fields: Record<string, string>,
  label: string,
  danger = false,
): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<form method="post" action="${esc(action)}" class="inline">${hidden(csrf)}${inputs}<button type="submit"${danger ? ' class="danger"' : ''}>${esc(label)}</button></form>`;
}

const KIND_KO: Record<string, string> = {
  info: '알림',
  important: '중요',
  update: '업데이트 권장',
  force: '강제 업데이트',
};
const MODE_KO: Record<string, string> = {
  off: '끔 (아무도)',
  allowlist: '허용 목록만 (목록과 운영자 계정)',
  everyone: '모두 (만 18세 이상 로그인)',
};

/** 앱 공지 창 모양 미리 보기 (src/renderer/src/notice 의 창과 같은 칸: 표, 제목, 본문, 단추) */
function noticePreview(n: DocNotice, lang: 'ko' | 'en'): string {
  const buttons =
    n.kind === 'update'
      ? lang === 'ko'
        ? ['나중에', '업데이트']
        : ['Later', 'Update']
      : n.kind === 'important'
        ? [lang === 'ko' ? '확인' : 'OK']
        : n.kind === 'force'
          ? [lang === 'ko' ? '업데이트 받기' : 'Get update']
          : [lang === 'ko' ? '닫기' : 'Close'];
  if (n.link) buttons.unshift(lang === 'ko' ? '자세히' : 'Details');
  return `<div class="preview ${esc(n.kind)}" lang="${lang}">
<span class="badge">${esc(lang === 'ko' ? KIND_KO[n.kind] : n.kind)}</span>
<strong>${esc(n.title[lang])}</strong>
<p>${esc(n.body[lang]).replaceAll('\n', '<br>')}</p>
<div class="btns">${buttons.map((b, i) => `<span class="${i === buttons.length - 1 ? 'primary' : ''}">${esc(b)}</span>`).join('')}</div>
</div>`;
}

const who = (a: { code: string; nickname: string | null }) =>
  `${esc(a.nickname ?? '(닉네임 없음)')} <code>${esc(a.code)}</code>`;
/** 확인 칸 글에 쓰는 대상 이름 (태그 없이) */
const plain = (a: { code: string; nickname: string | null }) => `${a.nickname ?? '(닉네임 없음)'} ${a.code}`;

const KIND_NOTE_KO: Record<string, string> = { grant: '지급', notice: '알림', subscription: '정기 지급' };

/** 쪽지의 받음 상태: 서버가 아는 것은 연 시각(열면 첨부를 받는다)과 그때 실제로 받은 양뿐이다 */
function trailState(t: GrantTrail): string {
  if (t.withdrawnAt !== null) return `<span class="tag ended">철회됨</span> ${when(t.withdrawnAt)}`;
  if (t.openedAt !== null) {
    const got =
      t.kind === 'notice'
        ? ''
        : ` (받은 코인 ${t.openedCoins ?? 0}, 채팅 이용권 ${t.openedPasses ?? 0}장${
            (t.openedCoins ?? 0) !== t.coins || (t.openedPasses ?? 0) !== t.passes ? ', 보낸 양과 달라요' : ''
          })`;
    return `<span class="tag live">${t.kind === 'notice' ? '읽음' : '받음'}</span> ${when(t.openedAt)}${esc(got)}`;
  }
  if (t.expired) return '<span class="tag bad">안 열고 기한이 지났어요</span>';
  return `<span class="tag soon">아직 안 열었어요</span>${t.expiresAt ? ` <small>${when(t.expiresAt)} 까지</small>` : ''}`;
}

const trailGift = (t: GrantTrail): string =>
  t.kind === 'notice'
    ? ''
    : [
        t.fillTo ? `채팅 이용권 ${t.fillTo}장까지 채우기` : '',
        t.coins ? `코인 ${t.coins}` : '',
        t.passes && !t.fillTo ? `채팅 이용권 ${t.passes}장` : '',
      ]
        .filter(Boolean)
        .join(', ');

/** 코인 회수 미리보기: 대상, 지금 잔액, 회수 뒤 잔액을 보이고 확인 칸을 체크해야 확정된다 */
function coinRevokePreview(v: AdminView, pv: Extract<FlowPreview, { action: 'coins/revoke' }>): string {
  const r = pv.revoke;
  const typed = typeof pv.fields.account === 'string' ? pv.fields.account : '';
  const target =
    r.found && r.code ? `${who({ code: r.code, nickname: r.nickname ?? null })} #${esc(r.id)}` : esc(typed);
  const name = r.found && r.code ? plain({ code: r.code, nickname: r.nickname ?? null }) : typed;
  return `<div class="flow" id="revoke-preview">
<p class="hint">아직 회수하지 않았어요. 아래를 확인하고 확정해 주세요.</p>
<dl class="stats">
<div><dt>대상</dt><dd>${target}${r.mergedFrom ? ` <span class="tag soon">합쳐진 계정 #${esc(r.mergedFrom)}, 남은 계정에서 빼요</span>` : ''}</dd></div>
<div><dt>지금 잔액</dt><dd>${r.balance}</dd></div>
<div><dt>회수</dt><dd>${r.coins}</dd></div>
<div><dt>회수 뒤 잔액</dt><dd>${r.after}</dd></div>
</dl>
<p>회수 사유 (운영 기록에 남아요): <q>${esc(r.reason)}</q></p>
${r.blocked ? `<p class="flash error" role="alert">${esc(r.blocked)}</p>` : ''}
<form method="post" action="/admin/coins/revoke" class="grid">${formErr(v, 'coins/revoke')}${hidden(v.csrf)}${flowKey(pv.nonce)}${carry(pv.fields)}
${confirmBox(`${name} 코인 ${r.coins}개 회수할게요 (되돌릴 수 없어요)`)}
<button type="submit" class="danger"${r.blocked ? ' disabled' : ''}>확정하고 코인 회수</button></form>
${editButton(v.csrf, 'coins/revoke')}
</div>`;
}

/**
 * 쪽지 줄의 철회 단추. 안 열었고 기한 안이고 운영자가 보낸 지급, 알림 쪽지일 때만 단추가 있다.
 * 연 쪽지는 이미 받은 것이라 철회할 수 없다 (받은 코인은 코인 회수로)
 */
function withdrawCell(v: Pick<AdminView, 'flash' | 'csrf'>, t: GrantTrail, code: string): string {
  if (t.withdrawnAt !== null || t.expired || (t.kind !== 'grant' && t.kind !== 'notice')) return '';
  if (t.openedAt !== null) return '<small>연 쪽지는 철회할 수 없어요. 받은 코인은 코인 회수로</small>';
  return sureForm(
    v,
    '/admin/notes/withdraw',
    { id: t.id, account: code },
    `쪽지 #${t.id} 철회할게요`,
    '철회',
    false,
  );
}

/** 이용자 상세 한 화면 (합친 계정 묶음 기준): 개요, 지급, 막기와 허용, 정기 지급, 회수, 신고, 코인과 쪽지 내역, 이 사람의 운영 기록 */
function userDetail(v: AdminView, a: NonNullable<AdminView['account']>): string {
  const csrf = v.csrf;
  const name = a.nickname ?? '(닉네임 없음)';
  const sub = draftOf(v, 'ai/subscribe', a.code);
  const rev = draftOf(v, 'ai/revoke', a.code);
  const h = a.history;
  const coinRows = (h?.coins ?? [])
    .map(
      (x) =>
        `<tr><td data-l="때">${when(x.at)}</td><td data-l="까닭"><code>${esc(x.reason)}</code></td><td data-l="코인">${x.amount > 0 ? '+' : ''}${x.amount}</td><td data-l="상태">${x.status === 'ok' ? '반영' : x.status === 'capped' ? '상한에 걸려 줄었어요' : '거절'}</td></tr>`,
    )
    .join('');
  const noteRows = (h?.notes ?? [])
    .map(
      (t) =>
        `<tr><td data-l="보낸 때">${when(t.sentAt)}</td><td data-l="종류">${esc(KIND_NOTE_KO[t.kind] ?? t.kind)}</td><td data-l="내용">${esc(trailGift(t))}${t.message ? `${trailGift(t) ? ', ' : ''}${esc(t.message)}` : ''}</td><td data-l="받았는지">${trailState(t)}</td><td data-l="철회">${withdrawCell(v, t, a.code)}</td></tr>`,
    )
    .join('');
  const rp = v.preview?.action === 'coins/revoke' && v.preview.revoke.id === a.id ? v.preview : undefined;
  const revokeOpen = !!rp || ['ai/revoke', 'coins/revoke'].includes(v.flash?.form ?? '');
  const rv = draftOf(v, 'coins/revoke');
  const rvMine = rv && val(rv, 'account').trim() === a.code ? rv : undefined;
  const logRows = (h?.log ?? [])
    .map(
      (l) =>
        `<tr><td data-l="때">${when(l.at)}</td><td data-l="누가">${esc(l.actorName ?? l.actor)}</td><td data-l="무엇">${esc(actionKo(l.action))}</td><td data-l="자세히">${logDetailCell(l.action, l.detail)}</td></tr>`,
    )
    .join('');
  const adminLink = placeHref('settings/log', `?lu=${encodeURIComponent(a.code)}`);
  const d = draftOf(v, 'grants/batch');
  const mine = d && val(d, 'accounts').trim() === a.code ? d : undefined;
  return `<section class="detail" id="user-detail">
<p><a class="button-link" href="${esc(placeHref('users/list'))}">이용자 목록으로</a></p>
${a.mergedFrom ? `<p class="flash warn" role="status">찾은 계정 #${esc(a.mergedFrom)} 는 이 계정에 합쳐졌어요. 코인과 내역은 합친 계정을 한 묶음으로 보여요</p>` : ''}
<h2>${esc(name)} <code>${esc(a.code)}</code> <small>#${esc(a.id)}</small>${a.admin ? ' <span class="tag live">운영자</span>' : ''}${a.ai.blocked ? ' <span class="tag ended">막힘</span>' : ''}${a.ai.allowed ? ' <span class="tag live">허용 목록</span>' : ''}</h2>
<nav class="row jump" aria-label="이 화면 안에서 바로 가기"><a class="button-link" href="#user-grant" data-jump="user-grant">지급</a><a class="button-link" href="#user-revoke" data-jump="user-revoke">회수</a><a class="button-link" href="#user-notes" data-jump="user-notes">철회</a></nav>
<dl class="stats">
<div><dt>코인</dt><dd>${a.balance}</dd></div>
<div><dt>채팅 이용권</dt><dd>${a.ai.remaining}장</dd></div>
<div><dt>나이 구분</dt><dd>${esc(a.age)}</dd></div>
<div><dt>로그인</dt><dd>${esc(loginKo(a.logins))}</dd></div>
<div><dt>만든 때</dt><dd>${when(a.created)}</dd></div>
<div><dt>선물, 쿠폰, 쪽지</dt><dd>${a.claims}, ${a.coupons}, ${a.notes}</dd></div>
<div><dt>이번 달 질문, 추정 비용</dt><dd>${a.ai.monthAsks}번, ${usd(a.ai.monthCostMicros)}</dd></div>
<div><dt>신고</dt><dd>${
    a.reports.total === 0
      ? '없음'
      : `${a.reports.total}건: ${a.reports.rows.map((x) => `<a href="${esc(reportHref(x.id))}">#${esc(x.id)}</a> ${reportTag(x.status)}`).join(' ')}`
  }</dd></div>
<div><dt>정기 지급</dt><dd>${a.ai.subscription ? `매달 ${a.ai.subscription.monthly}장 ${a.ai.subscription.mode === 'fill' ? '까지 채우기' : '더하기'}, ${esc(a.ai.subscription.startsOn)} ~ ${esc(a.ai.subscription.endsOn ?? '무기한')}, 다음 ${esc(a.ai.subscription.nextFill ?? '없음')}` : '없음'}</dd></div>
</dl>

<h3 id="user-grant">이 사람에게 지급</h3>
<p class="hint">지급은 쪽지로 가고 이용자가 열 때 받아요. 아래 단추를 누르면 대상과 양을 한 번 더 확인하는 화면이 나와요.</p>
<form method="post" action="/admin/grants/preview" class="grid grant-one">${formErr(v, 'grants/batch', undefined, true)}${hidden(csrf)}<input type="hidden" name="accounts" value="${esc(a.code)}">
<p class="wide target">받는 사람: <strong>${esc(name)}</strong> <code>${esc(a.code)}</code> #${esc(a.id)}</p>
<label>코인 수 <input name="coins" type="number" min="0" max="10000" value="${esc(val(mine, 'coins', '0'))}" required></label>
<label>채팅 이용권 수${a.age === '18+' ? '' : ' (만 18세 미만은 줄 수 없어요)'} <input name="chat_passes" type="number" min="0" max="1000" value="${esc(val(mine, 'chat_passes', '0'))}" required></label>
<label>만료 날수 <input name="days" type="number" min="1" max="365" value="${esc(val(mine, 'days', '30'))}" required></label>
<label class="wide">지급 사유, 이용자에게 보여요 <textarea name="reason" required maxlength="200">${esc(val(mine, 'reason'))}</textarea></label>
<button type="submit">지급 대상 확인하기: ${esc(name)}</button></form>

<h3>막기와 허용</h3>
<div class="row">
${postButton(csrf, '/admin/ai/allow', { account: a.code, allowed: a.ai.allowed ? '0' : '1' }, a.ai.allowed ? '허용 목록에서 빼기' : '허용 목록에 넣기')}
${
  a.ai.blocked
    ? postButton(csrf, '/admin/ai/block', { account: a.code, blocked: '0' }, '채팅 이용권 막기 풀기')
    : sureForm(
        v,
        '/admin/ai/block',
        { account: a.code, blocked: '1' },
        `${plain(a)} 채팅 이용권 막을게요`,
        '채팅 이용권 막기',
      )
}
${a.ai.subscription ? sureForm(v, '/admin/ai/cancel', { account: a.code }, `${plain(a)} 정기 지급 해지할게요`, '정기 지급 해지') : ''}
</div>
<form method="post" action="/admin/ai/subscribe" class="grid">${formErr(v, 'ai/subscribe', a.code)}${hidden(csrf)}<input type="hidden" name="account" value="${esc(a.code)}">
<p class="wide">정기 지급 (한국 달마다 한 번, 쪽지로 가요)</p>
<label>매달 장수 (1~1000) <input name="monthly" type="number" min="1" max="1000" required value="${esc(val(sub, 'monthly'))}"></label>
<label>방식 <select name="mode">${opt(sub, 'mode', 'fill', 'N장까지 채우기 (이월 없음)', 'fill')}${opt(sub, 'mode', 'add', 'N장 더하기', 'fill')}</select></label>
<label>시작일 (비우면 오늘) <input name="starts_on" type="date" value="${esc(val(sub, 'starts_on'))}"></label>
<label>끝일 (비우면 무기한) <input name="ends_on" type="date" value="${esc(val(sub, 'ends_on'))}"></label>
<button type="submit">정기 지급 걸기: ${esc(name)}</button>
</form>
<h3 id="user-notes">받은 쪽지와 받았는지</h3>
<p class="hint">쪽지를 열면 코인과 채팅 이용권을 받아요. 서버가 아는 것은 연 시각과 그때 실제로 받은 양이에요. 앱에서 알림을 봤는지는 알 수 없어요. 아직 안 연 쪽지는 철회할 수 있고, 철회하면 이용자 쪽지함에서 사라져요. 최근 15건.</p>
${formErr(v, 'notes/withdraw', a.code)}
${noteRows ? `<table class="cards"><thead><tr><th>보낸 때</th><th>종류</th><th>내용</th><th>받았는지</th><th>철회</th></tr></thead><tbody>${noteRows}</tbody></table>` : '<p class="empty">보낸 쪽지가 없어요</p>'}

<h3>코인 내역</h3>
<p class="hint">합친 계정까지 한 묶음, 최근 15건. 지금 잔액은 ${a.balance}.</p>
${coinRows ? `<table class="cards"><thead><tr><th>때</th><th>까닭</th><th>코인</th><th>상태</th></tr></thead><tbody>${coinRows}</tbody></table>` : '<p class="empty">코인 기록이 없어요</p>'}

<details class="danger-fold" id="user-revoke"${revokeOpen ? ' open' : ''}><summary>회수 (채팅 이용권, 코인): 되돌릴 수 없어요</summary>
<h4>채팅 이용권 회수</h4>
<form method="post" action="/admin/ai/revoke" class="grid">${formErr(v, 'ai/revoke', a.code)}${hidden(csrf)}<input type="hidden" name="account" value="${esc(a.code)}">
<label>채팅 이용권 회수 (남은 장수까지) <input name="count" type="number" min="1" max="1000" required value="${esc(val(rev, 'count'))}"></label>
${confirmBox(`${plain(a)} 채팅 이용권 회수할게요 (되돌릴 수 없어요)`)}
<button type="submit" class="danger">회수하기</button>
</form>

<h4>코인 회수</h4>
${
  rp
    ? coinRevokePreview(v, rp)
    : `<p class="hint">이용자가 이미 가진 코인을 서버 잔액에서 뺍니다. 잔액 ${a.balance}보다 많이는 뺄 수 없고, 코인 내역에 회수 줄이 남아요. 앱은 다음 맞추기 때 잔액이 바뀌어요. 이미 연 지급 쪽지의 코인을 되돌릴 때 써요. 아직 안 연 쪽지는 위의 받은 쪽지에서 철회해요.</p>
<form method="post" action="/admin/coins/revoke/preview" class="grid">${formErr(v, 'coins/revoke', a.code)}${hidden(csrf)}<input type="hidden" name="account" value="${esc(a.code)}">
<label>회수할 코인 (잔액 ${a.balance}까지) <input name="coins" type="number" min="1"${a.balance > 0 ? ` max="${a.balance}"` : ''} required value="${esc(val(rvMine, 'coins'))}"></label>
<label class="wide">회수 사유, 운영 기록에 남아요 <textarea name="reason" required maxlength="200">${esc(val(rvMine, 'reason'))}</textarea></label>
<button type="submit"${a.balance > 0 ? '' : ' disabled'}>${esc(name)} 코인 회수, 미리보기</button>${a.balance > 0 ? '' : ' <span class="hint">잔액이 0이라 뺄 코인이 없어요</span>'}</form>`
}

</details>

<h3>이 사람의 운영 기록</h3>
${logRows ? `<table class="cards"><thead><tr><th>때</th><th>누가</th><th>무엇</th><th>자세히</th></tr></thead><tbody>${logRows}</tbody></table>` : '<p class="empty">이 사람에 대한 운영 기록이 없어요</p>'}
<p><a class="button-link" href="${esc(adminLink)}">운영 기록에서 모두 보기</a></p>
</section>`;
}

const loginKo = (services: string[]): string => {
  const names = services.map((x) => (x === 'google' ? '구글' : x === 'kakao' ? '카카오' : x));
  return names.join(', ') || '없음';
};

const userOpenHref = (id: string) => placeHref('users/list', `?user=${encodeURIComponent(id)}`);

export function usersTable(v: AdminView): string {
  const u = v.users;
  const params = (page: number) => {
    const p = new URLSearchParams();
    if (u.query) p.set('q', u.query);
    p.set('page', String(page));
    p.set('sort', u.sort);
    p.set('direction', u.direction);
    return placeHref('users/list', `?${p}`);
  };
  // 찾는 칸은 하나다 (번호, 닉네임, 기기 코드). 하나로 좁혀지면 상세 한 화면이 표 자리에 열린다
  const searchForm = `<form method="get" action="/admin#users/list" class="row">
<label>번호, 닉네임 또는 기기 코드 <input name="q" maxlength="40" value="${esc(u.query)}"></label>
<button type="submit">찾기</button>
<details class="sort-fold"${u.sort !== 'active' || u.direction !== 'desc' ? ' open' : ''}><summary>정렬 바꾸기</summary><div class="row">
<label>정렬 <select name="sort"><option value="active"${u.sort === 'active' ? ' selected' : ''}>최근 활동</option><option value="coins"${u.sort === 'coins' ? ' selected' : ''}>코인</option><option value="created"${u.sort === 'created' ? ' selected' : ''}>만든 날</option></select></label>
<label>방향 <select name="direction"><option value="desc"${u.direction === 'desc' ? ' selected' : ''}>큰 값부터</option><option value="asc"${u.direction === 'asc' ? ' selected' : ''}>작은 값부터</option></select></label>
</div></details></form>`;
  const a = v.account;
  // 쓰던 코인 회수 미리보기가 지금 보는 이용자의 것이 아니면 (또는 이용자를 열지 않았으면) 맨 위에 보인다
  const rp = v.preview?.action === 'coins/revoke' ? v.preview : undefined;
  const lone =
    rp && !(a && rp.revoke.id === a.id)
      ? `<section class="flow"><h2>코인 회수 확인</h2>${coinRevokePreview(v, rp)}</section>`
      : '';
  if (a) return `${lone}<section><h2>이용자 찾기</h2>${searchForm}</section>${userDetail(v, a)}`;
  const rows = u.rows
    .map((x) => {
      const nm = x.nickname ?? '닉네임 없음';
      return `<tr><td class="pick"><input type="checkbox" name="pick" value="${esc(x.id)}" form="pick-form" aria-label="${esc(nm)} 지급 대상으로 고르기"></td>
<td class="opt" data-l="번호">${esc(x.id)}</td>
<td class="name"><a href="${esc(userOpenHref(x.id))}">${esc(nm)}</a></td><td data-l="기기 코드"><code>${esc(x.code)}</code></td><td class="opt" data-l="로그인">${esc(loginKo(x.logins))}</td>
<td class="opt" data-l="나이 구분">${esc(x.age)}</td><td data-l="코인">${x.balance}</td><td data-l="채팅 이용권">${x.tickets}</td><td data-l="마지막 활동">${when(x.lastActive)}</td><td class="opt" data-l="만든 날">${when(x.created)}</td>
<td class="opt" data-l="앱 판">${esc(x.appVersion ?? '없음')}</td><td class="act"><a class="button-link" href="${esc(userOpenHref(x.id))}">${esc(nm)} 열기</a> <a class="button-link" href="${esc(placeHref('users/grants', `?account=${encodeURIComponent(x.id)}`))}">${esc(nm)} 지급</a></td></tr>`;
    })
    .join('');
  return `${lone}<section><h2>이용자 ${u.total}명</h2>
${searchForm}
<p class="hint">합쳐져서 닫힌 계정은 목록에 없고, 적으면 남은 계정이 열려요. 한 쪽에 20명씩 보여요.</p>
<form id="pick-form" method="get" action="/admin#users/grants" class="row"><button type="submit">고른 사람에게 지급 (한 번에 20명까지)</button><span class="hint">이름 앞 칸을 눌러 고르면 지급 칸에 받는 사람으로 채워져요. 보내기 전에 대상 확인 화면이 한 번 나와요.</span></form>
<div class="table-scroll"><table class="users cards"><thead><tr><th>고르기</th><th>번호</th><th>닉네임</th><th>기기 코드</th><th>로그인 여부</th><th>나이 구분</th><th>코인 잔액</th><th>채팅 이용권</th><th>마지막 활동</th><th>만든 날</th><th>앱 판</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="12">찾은 이용자가 없어요</td></tr>'}</tbody></table></div>
<nav class="pager" aria-label="쪽 넘기기">${u.page > 1 ? `<a href="${esc(params(u.page - 1))}">이전</a>` : '<span>이전</span>'}<strong>${u.page} / ${u.pages}</strong>${u.page < u.pages ? `<a href="${esc(params(u.page + 1))}">다음</a>` : '<span>다음</span>'}</nav>
</section>`;
}

/** 이번 달 추정 비용이 예산의 50%, 80% 를 넘으면 경고 */
export function budgetWarn(cost: number, budget: number): string {
  if (budget <= 0)
    return '<p class="flash error">월 예산이 0 이라 채팅 이용권 질문이 모두 막혀요. 서버 설정 파일에서 월 예산을 올려 주세요 (.env 의 AI_MONTHLY_BUDGET_USD)</p>';
  const p = cost / budget;
  if (p >= 0.8)
    return `<p class="flash error">이번 달 비용이 예산의 ${Math.floor(p * 100)}% 예요 (80% 넘음)</p>`;
  if (p >= 0.5)
    return `<p class="flash warn">이번 달 비용이 예산의 ${Math.floor(p * 100)}% 예요 (50% 넘음)</p>`;
  return '';
}

const FEATURE_MODE_KO: Record<string, string> = {
  off: '끔 (아무도)',
  allowlist: '허용 목록만',
  everyone: '모두',
};

/** 접근 설정 값의 글. allowlist 에서도 운영자 계정이 켜지는 기능(features.ts admins)은 채팅 이용권처럼 그렇게 적는다 */
const featureModeKo = (key: string, mode: string): string =>
  mode === 'allowlist' && (FEATURES as Record<string, { admins?: boolean }>)[key]?.admins === true
    ? '허용 목록만 (목록과 운영자 계정)'
    : (FEATURE_MODE_KO[mode] ?? mode);

const FEATURE_KO: Record<string, string> = {
  kakao_login: '카카오 로그인',
  coin_reset: '코인 초기화 (설정의 코인, 산 물건 초기화)',
  calendar_link_hint: '다른 기기의 구글 일정 연결 안내',
  friends: '친구 맺기',
  friend_gifts: '친구 선물 (코인, 채팅 이용권)',
  friend_calendar: '친구에게 바쁜 시간 보여 주기',
  friend_visit: '친구 펫 놀러 가기',
  friend_gift_passes: '친구에게 채팅 이용권 선물',
};

/** 결과 글에 쓰는 짧은 이름 (표의 긴 이름 말고) */
const SWITCH_SHORT: Record<string, string> = {
  ai_chat: '채팅 이용권',
  kakao_login: '카카오 로그인',
  coin_reset: '코인 초기화',
  calendar_link_hint: '다른 기기의 구글 일정 연결 안내',
  friends: '친구 맺기',
  friend_gifts: '친구 선물',
  friend_calendar: '친구에게 바쁜 시간 보여 주기',
  friend_visit: '친구 펫 놀러 가기',
  friend_gift_passes: '친구에게 채팅 이용권 선물',
};
const SWITCH_VALUE_KO: Record<string, string> = { off: '끔', allowlist: '허용 목록만', everyone: '모두' };
/** 받침에 따라 을/를, 로/으로 (ㄹ 받침은 로) */
const jongOf = (w: string): number => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 ? c % 28 : 0;
};
const eulReul = (w: string) => (jongOf(w) === 0 ? '를' : '을');
const euroRo = (w: string) => (jongOf(w) === 0 || jongOf(w) === 8 ? '로' : '으로');
/** 기능 스위치를 바꾼 결과 글: "친구 맺기를 허용 목록만에서 모두로 바꿨어요" (키와 영어 값 대신 이름과 화면에 보이는 값) */
export function switchChangeText(key: string, before: string, after: string): string {
  const name = SWITCH_SHORT[key] ?? key;
  const b = SWITCH_VALUE_KO[before] ?? before;
  const a = SWITCH_VALUE_KO[after] ?? after;
  return `${name}${eulReul(name)} ${b}에서 ${a}${euroRo(a)} 바꿨어요`;
}

const FEATURE_HINT: Record<string, string> = {
  kakao_login:
    '접근 설정이 허용 목록만이면 이미 구글로 로그인한 허용 계정이 앱에서 "카카오도 연결"하는 것만 돼요. 모두로 두면 누구나 카카오로 로그인, 가입. 카카오 키가 없으면 켜도 꺼져 있어요.',
  coin_reset: '꺼짐이면 앱이 초기화 칸을 숨기고, 서버도 초기화 기록을 받지 않아요.',
  calendar_link_hint:
    '같은 계정의 다른 기기에서 구글 일정을 연결했으면 새 기기에 "이 기기도 연결할까?"를 보여 줘요. 서버에는 연결 표시만 두고 구글 토큰은 두지 않아요. 허용 목록만이면 운영자 계정도 켜져요.',
  friends:
    '허용 목록만이면 목록의 계정과 운영자 계정만 써요. 신청을 받는 사람도 쓸 수 있어야 해요. 로그인한 계정끼리, 만 14~17세끼리와 성인끼리만 친구가 돼요.',
  friend_gifts:
    '보내는 사람 기준이에요. 하루 코인 500, 채팅 이용권 5장 (보내기, 받기 각각). 이용권은 받는 사람이 만 18세 이상이고 둘 다 채팅 이용권을 쓸 수 있을 때만.',
  friend_calendar:
    '보여 주는 사람과 보는 사람 모두 켜져 있어야 해요. 바쁜 시간대(시작, 끝)만 올라오고 제목은 없어요. 끄면 바로 지워요.',
  friend_visit:
    '보내는 사람과 받는 사람 모두 켜져 있어야 해요. 친구마다 따로 켜고 기본은 꺼짐이에요. 서버에는 펫 종류, 이름, 네 발 서기 여부만 올라오고 사진이나 그림 파일은 받지 않아요. 만 14~17세끼리, 성인끼리만. 끄거나 친구를 끊으면 바로 지워요.',
  friend_gift_passes:
    '보내는 사람과 받는 사람이 모두 허용돼야 해요(허용 목록만이면 둘 다 목록이나 운영자 계정). 지금 이용권은 모두 운영자 지급분이라 이 스위치가 운영자 지급분 선물 여부까지 정해요. 받는 사람은 만 18세 이상이고 채팅 이용권을 쓸 수 있어야 해요.',
};

/** 표에 보일 한 줄 설명 (긴 설명은 "자세히" 안에 둔다) */
const FEATURE_SHORT: Record<string, string> = {
  ai_chat: '채팅 이용권으로 AI 에게 묻는 기능',
  kakao_login: '카카오로 로그인하고 가입하기',
  coin_reset: '설정의 코인, 산 물건 초기화',
  calendar_link_hint: '다른 기기의 구글 일정 연결 안내',
  friends: '친구 맺기',
  friend_gifts: '친구에게 코인, 채팅 이용권 선물',
  friend_calendar: '친구에게 바쁜 시간 보여 주기',
  friend_visit: '친구 펫이 서로 화면에 놀러 가기',
  friend_gift_passes: '친구에게 채팅 이용권 선물',
};

/** 채팅 이용권(ai_chat)의 긴 설명 */
const AI_CHAT_HINT =
  '1장 = 질문 1번. 허용 목록만이면 목록의 계정과 서버 설정에 적어 둔 운영자 계정(ADMIN_GOOGLE_SUBS)만 써요. 첫 로그인 선물 10장은 허용된 계정이 처음 물을 때 한 번 받아요.';

/** 표의 상태 배지 글 (자세한 뜻은 영향 칸에) */
const SWITCH_TAG_KO: Record<string, string> = { off: '끔', allowlist: '허용 목록', everyone: '모두' };

/** 이 설정이면 누가 쓰는가 (표의 "영향" 칸). n 은 허용 목록의 계정 수 */
function switchImpact(key: string, mode: string, n: number): string {
  if (mode === 'off') return '아무도 쓸 수 없어요';
  const admins =
    key === 'ai_chat' || (FEATURES as Record<string, { admins?: boolean }>)[key]?.admins === true;
  if (mode === 'allowlist')
    return `허용 목록 ${n}명${admins ? '과 운영자 계정' : ''}만 써요${n === 0 && !admins ? ' (지금은 아무도 못 써요)' : ''}`;
  return key === 'ai_chat' ? '로그인한 만 18세 이상 모두 써요' : '모두 써요';
}

/** 표의 한 줄: 이름, 설명, 상태, 영향, 바로 바꾸기와 되돌리기. ai_chat 도 같은 모양이다 (쓰기 주소만 다르다) */
function switchRow(
  v: AdminView,
  o: {
    key: string;
    name: string;
    mode: string;
    env: boolean;
    allowCount: number;
    action: string;
    hint: string;
  },
): string {
  const d = draftOf(v, o.action, o.key);
  const last = v.switchLast[o.key];
  const modeKo = (m: string) => (o.key === 'ai_chat' ? (MODE_KO[m] ?? m) : featureModeKo(o.key, m));
  const label = `${o.name} 접근 설정을 바꿀게요 (지금 ${modeKo(o.mode)})`;
  const hidden2 = `${hidden(v.csrf)}<input type="hidden" name="key" value="${esc(o.key)}"><input type="hidden" name="from" value="${esc(o.mode)}">`;
  const change = `<form method="post" action="${esc(`/admin/${o.action}`)}" class="sw-form">${formErr(v, o.action, o.key)}${hidden2}
<select name="mode" aria-label="${esc(o.name)} 접근 설정">${(['off', 'allowlist', 'everyone'] as const).map((m) => opt(d, 'mode', m, modeKo(m), o.mode)).join('')}</select>
${confirmBox(label)}
<button type="submit" class="danger">바꾸기</button></form>`;
  const undo =
    last && last.after === o.mode && last.before !== o.mode
      ? `<form method="post" action="${esc(`/admin/${o.action}`)}" class="sw-form">${hidden2}<input type="hidden" name="mode" value="${esc(last.before)}"><input type="hidden" name="revert" value="1">
${confirmBox(`${o.name} 을 이전 값 ${modeKo(last.before)} 으로 되돌릴게요`)}
<button type="submit" class="ghost">이전 값으로 되돌리기</button></form>`
      : '';
  const prev = last
    ? `<br><small class="prev">이전 값: ${esc(modeKo(last.before))}<br>${esc(when(last.at))}, ${esc(last.actorName ?? last.actor)}</small>`
    : '';
  return `<tr class="sw" data-key="${esc(o.key)}">
<td class="name" data-l="기능">${esc(o.name)}<br><code>${esc(o.key)}</code></td>
<td data-l="설명">${esc(FEATURE_SHORT[o.key] ?? '')}<details><summary>자세히</summary><p class="hint">${esc(o.hint)}</p></details></td>
<td data-l="상태"><span class="tag nowrap ${o.mode === 'off' ? 'ended' : o.mode === 'everyone' ? 'live' : 'soon'}">${esc(SWITCH_TAG_KO[o.mode] ?? o.mode)}</span>${o.env ? '<br><small>서버 설정 기본값</small>' : ''}${prev}</td>
<td data-l="영향">${esc(switchImpact(o.key, o.mode, o.allowCount))}</td>
<td class="act" data-l="바꾸기">${change}${undo}</td></tr>`;
}

/** 기능 하나의 허용 계정 (#102). 접근 설정을 바꾸는 폼은 표 줄에 있다 */
function featureAllow(x: FeatureView, v: AdminView): string {
  const csrf = v.csrf;
  const da = draftOf(v, 'features/allow', x.key);
  const name = FEATURE_KO[x.key] ?? x.key;
  return `<details class="allow"><summary>${esc(name)} 허용 계정 (${x.accounts.length}명)</summary>
<form method="post" action="/admin/features/allow" class="row">${formErr(v, 'features/allow', x.key)}${hidden(csrf)}<input type="hidden" name="key" value="${esc(x.key)}"><input type="hidden" name="allowed" value="1">
<label>허용할 계정 번호나 기기 코드 <input name="account" required maxlength="20" value="${esc(val(da, 'account'))}"></label><button type="submit">허용 목록에 넣기</button>
</form>
<ul class="plain">${x.accounts.map((id) => `<li><a href="${esc(placeHref('users/list', `?q=${id}`))}">#${id}</a> ${postButton(csrf, '/admin/features/allow', { key: x.key, account: String(id), allowed: '0' }, '빼기', true)}</li>`).join('') || '<li>허용 목록이 비었어요</li>'}</ul></details>`;
}

function aiSections(v: AdminView): { features: string; tickets: string } {
  const ai = v.ai;
  const csrf = v.csrf;
  const dLim = draftOf(v, 'ai/limits');
  const dPol = draftOf(v, 'ai/policy');
  const rows = [
    switchRow(v, {
      key: 'ai_chat',
      name: '채팅 이용권 (AI 대화권)',
      mode: ai.mode,
      env: false,
      allowCount: ai.allow.length,
      action: 'ai/mode',
      hint: AI_CHAT_HINT,
    }),
    ...v.features.map((x) =>
      switchRow(v, {
        key: x.key,
        name: FEATURE_KO[x.key] ?? x.key,
        mode: x.mode,
        env: x.from === 'env',
        allowCount: x.accounts.length,
        action: 'features/mode',
        hint: FEATURE_HINT[x.key] ?? '',
      }),
    ),
  ].join('\n');
  const features = `<section><h2>기능 스위치</h2>
<p class="hint">한 표에서 바로 바꿔요. 바꿀 때는 확인 칸을 체크해야 하고, 운영 기록에 누가 무엇을 어떻게 바꿨는지 남아요. 바꾼 줄에는 이전 값이 보이고 한 번에 되돌릴 수 있어요. 채팅 이용권의 허용 목록은 <a href="#settings/ai">예산, 정책</a> 칸에 있어요.</p>
<div class="table-scroll"><table class="switches cards"><thead><tr><th>기능</th><th>설명</th><th>상태</th><th>영향</th><th>바꾸기</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<h3>허용 계정</h3>
<p class="hint">접근 설정이 허용 목록만인 기능에서 쓸 계정을 넣고 빼요.</p>
${v.features.map((x) => featureAllow(x, v)).join('\n')}
</section>`;
  const tickets = `<section><h2>예산과 정책</h2>
<p class="hint">채팅 이용권을 누가 쓰는지(접근 설정)는 <a href="#settings/features">기능 스위치</a> 표에서 바꿔요. 지금 설정: <strong>${esc(MODE_KO[ai.mode])}</strong>. 허용 목록만이면 목록의 계정과 서버 설정에 적어 둔 운영자 계정(ADMIN_GOOGLE_SUBS)만 써요.</p>
<form method="post" action="/admin/ai/limits" class="grid">${formErr(v, 'ai/limits')}${hidden(csrf)}
<label>월 예산 달러 (서버 설정 파일의 상한 ${usd(ai.capBudgetMicros)} 이하, 비우면 상한, .env) <input name="budget_usd" inputmode="decimal" value="${esc(val(dLim, 'budget_usd', ai.setBudgetMicros === null ? '' : (ai.setBudgetMicros / 1e6).toString()))}"></label>
<label>사람마다 하루 질문 (서버 설정 파일의 상한 ${ai.capDailyLimit} 이하, 비우면 상한, .env) <input name="daily_limit" type="number" min="0" value="${esc(val(dLim, 'daily_limit', String(ai.setDailyLimit ?? '')))}"></label>
<label>질문 한 번에 쓸 글자 수 (서버 설정 파일의 상한 ${ai.capInputChars} 이하, 비우면 상한, .env) <input name="input_chars" type="number" min="1" max="${ai.capInputChars}" value="${esc(val(dLim, 'input_chars', String(ai.setInputChars ?? '')))}"></label>
<button type="submit">예산 저장</button>
</form>
<p class="hint">지금 쓰는 값: 월 ${usd(ai.monthlyBudgetMicros)}, 하루 ${ai.dailyLimit}번, 질문 ${ai.inputChars}자 이하. 이번 달(UTC 기준) ${usd(v.summary.aiCostMicros)} 썼어요.</p>
${budgetWarn(v.summary.aiCostMicros, ai.monthlyBudgetMicros)}
<form method="post" action="/admin/ai/policy" class="grid">${formErr(v, 'ai/policy')}${hidden(csrf)}
<p class="wide">정책: 허용된 계정은 매달 1일(한국) N장까지 채우기 정기 지급이 저절로 걸려요 (쪽지로, 이월 없음). 자리는 ${ai.seatsUsed}/${ai.seatLimit}.</p>
<label>매달 장수 <input name="auto_monthly" type="number" min="1" max="1000" value="${esc(val(dPol, 'auto_monthly', String(ai.autoMonthly)))}"></label>
<label>자리 수 (정기 지급 계정 상한) <input name="seat_limit" type="number" min="0" max="100000" value="${esc(val(dPol, 'seat_limit', String(ai.seatLimit)))}"></label>
<label>첫 로그인 선물 10장 <select name="first_gift">${opt(dPol, 'first_gift', '0', '끔', ai.firstGift ? '1' : '0')}${opt(dPol, 'first_gift', '1', '켬', ai.firstGift ? '1' : '0')}</select></label>
<button type="submit">정책 저장</button>
</form>
<h3>대기 목록 (${ai.waitlist.length})</h3>
<ul class="plain">${ai.waitlist.map((x) => `<li><a href="${esc(placeHref('users/list', `?q=${encodeURIComponent(x.code)}`))}">#${esc(x.id)}</a> ${who(x)} ${postButton(csrf, '/admin/ai/allow', { account: x.code, allowed: '1' }, '허용하기')}</li>`).join('') || '<li>비었어요</li>'}</ul>
<h3>허용 목록 (${ai.allow.length})</h3>
<ul class="plain">${ai.allow.map((x) => `<li><a href="${esc(placeHref('users/list', `?q=${encodeURIComponent(x.code)}`))}">#${esc(x.id)}</a> ${who(x)} ${postButton(csrf, '/admin/ai/allow', { account: x.code, allowed: '0' }, '빼기', true)}</li>`).join('') || '<li>비었어요 (운영자 계정은 늘 허용)</li>'}</ul>
</section>`;
  return { features, tickets };
}

// ---- 다섯 칸 (이슈 #150) ----

const EVENT_SOON_MS = 3 * 86_400_000;

/** 홈의 "지금 확인할 것". 신고 건수, 예산 경고, 3일 안에 끝나는 이벤트와 쿠폰 (앱 요약과 같은 계산을 쓴다) */
export function todoOf(o: {
  reports: number;
  costMicros: number;
  budgetMicros: number;
  events: Array<{ starts: number; ends: number }>;
  coupons: Array<{ starts: number; ends: number; disabled: boolean }>;
  now: number;
  /** 서버 백업이 상한의 얼마나 찼나 (켜져 있고 상한이 있을 때만) */
  backup?: Pick<BackupStatus, 'bytes' | 'maxBytes'>;
  /** 밖에서 도는 백업(덤프, 외장 디스크 사본)의 상태. 상태 파일이 없으면(unknown) 카드를 만들지 않는다 */
  external?: ExternalBackup;
}): AdminTodo[] {
  const out: AdminTodo[] = [];
  if (o.reports > 0) out.push({ kind: 'reports', level: 'warn', n: o.reports, place: 'reports' });
  // 예산 0 이면 n 은 -1 (질문이 모두 막힌다), 아니면 쓴 비율(%)
  if (o.budgetMicros <= 0) out.push({ kind: 'budget', level: 'bad', n: -1, place: 'settings/ai' });
  else {
    const p = o.costMicros / o.budgetMicros;
    if (p >= 0.5)
      out.push({
        kind: 'budget',
        level: p >= 0.8 ? 'bad' : 'warn',
        n: Math.floor(p * 100),
        place: 'settings/ai',
      });
  }
  const soon = (starts: number, ends: number) =>
    starts <= o.now && ends > o.now && ends <= o.now + EVENT_SOON_MS;
  const events = o.events.filter((e) => soon(e.starts, e.ends)).length;
  if (events > 0) out.push({ kind: 'ending_events', level: 'warn', n: events, place: 'announce/posts' });
  const coupons = o.coupons.filter((c) => !c.disabled && soon(c.starts, c.ends)).length;
  if (coupons > 0) out.push({ kind: 'ending_coupons', level: 'warn', n: coupons, place: 'announce/posts' });
  // 상한 0 이면 서버는 모든 올리기를 507 로 막는다 (n 은 -1)
  if (o.backup?.maxBytes === 0) out.push({ kind: 'backup', level: 'bad', n: -1, place: 'settings/backup' });
  const used = o.backup ? backupPercent(o.backup) : null;
  if (used !== null && used >= BACKUP_WARN_PERCENT)
    out.push({
      kind: 'backup',
      level: used >= BACKUP_BAD_PERCENT ? 'bad' : 'warn',
      n: used,
      place: 'settings/backup',
    });
  // 밖에서 도는 백업: 마지막이 실패면 bad (n -1), 오래 성공 못 했으면 warn (n 은 마지막 성공 뒤 시간. 한 번도 없으면 -2)
  for (const [kind, job] of [
    ['backup_db', o.external?.db],
    ['backup_files', o.external?.files],
  ] as const) {
    if (!job || job.state === 'unknown' || job.state === 'ok') continue;
    if (job.state === 'failed') out.push({ kind, level: 'bad', n: -1, place: 'settings/backup' });
    else
      out.push({
        kind,
        level: 'warn',
        n: job.lastOkAt === null ? -2 : Math.floor((o.now - job.lastOkAt) / 3_600_000),
        place: 'settings/backup',
      });
  }
  return out;
}

export function todoText(t: AdminTodo): string {
  switch (t.kind) {
    case 'reports':
      return `처리하지 않은 신고가 ${t.n}건 있어요`;
    case 'budget':
      return t.n < 0
        ? '월 예산이 0 이라 채팅 이용권 질문이 모두 막혀요'
        : `이번 달 비용이 예산의 ${t.n}% 예요`;
    case 'ending_events':
      return `3일 안에 끝나는 이벤트가 ${t.n}개 있어요`;
    case 'ending_coupons':
      return `3일 안에 끝나는 쿠폰이 ${t.n}개 있어요`;
    case 'backup':
      return t.n < 0
        ? '서버 백업 상한이 0 이라 새 백업 올리기가 모두 막혀요'
        : `서버 백업이 상한의 ${t.n}%를 썼어요`;
    case 'backup_db':
    case 'backup_files': {
      const what = t.kind === 'backup_db' ? '데이터베이스 덤프' : '백업 파일 외장 디스크 사본';
      if (t.n === -1) return `${what} 백업이 마지막에 실패했어요`;
      return t.n < 0
        ? `${what} 백업이 성공한 기록이 없어요`
        : `${what} 백업이 ${t.n}시간째 성공하지 못했어요`;
    }
  }
}

/** 칸 안 자리로 가는 주소. query 는 "?q=..." 처럼 붙인다 */
const placeHref = (place: AdminPlace, query = '') => `/admin${query}#${place}`;

function homeSection(v: AdminView): string {
  const s = v.summary;
  const todo = v.todo.length
    ? `<ul class="todo">${v.todo.map((t) => `<li class="${t.level}"><a href="#${esc(t.place)}">${esc(todoText(t))}</a></li>`).join('')}</ul>`
    : '<p class="empty">지금 확인할 것이 없어요</p>';
  const recent = v.recent.length
    ? `<div class="table-scroll"><table class="log"><thead><tr><th>때</th><th>누가</th><th>무엇</th><th>대상</th></tr></thead><tbody>${v.recent
        .map(
          (l) =>
            `<tr><td>${when(l.at)}</td><td>${esc(l.actorName ?? l.actor)}</td><td>${esc(actionKo(l.action))}</td><td>${esc(l.targetName ?? l.target ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="empty">아직 운영 기록이 없어요</p>';
  return `<section><h2>지금 확인할 것</h2>${todo}</section>
${trendSection(v)}
<section><h2>백업</h2>${backupGlance(v.backup)}</section>
<section><h2>사용량</h2>
<dl class="stats">
<div><dt>계정</dt><dd>${s.accounts}</dd></div>
<div><dt>코인 잔액 합</dt><dd>${s.coins}</dd></div>
<div><dt>남은 채팅 이용권 합</dt><dd>${s.tickets}</dd></div>
<div><dt>지난 24시간 번 코인</dt><dd>${s.earnedDay}</dd></div>
<div><dt>지난 24시간 쓴 코인</dt><dd>${s.spentDay}</dd></div>
<div><dt>이번 달 질문 (UTC 기준)</dt><dd>${s.aiAsks}</dd></div>
<div><dt>이번 달 추정 비용 (UTC 기준)</dt><dd>${usd(s.aiCostMicros)} / ${usd(v.ai.monthlyBudgetMicros)}</dd></div>
<div><dt>남은 예산</dt><dd>${usd(Math.max(0, v.ai.monthlyBudgetMicros - s.aiCostMicros))}</dd></div>
</dl>
${versionTable(v)}</section>
<section><h2>최근 운영 기록</h2>${recent}
<p><a class="button-link" href="#settings/log">운영 기록 모두 보기</a></p></section>`;
}

const bytesText = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)}GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)}MB`
      : `${Math.ceil(n / 1024)}KB`;

/** 오늘(마지막 날)의 값과 어제 값. 어제가 0 이면 변화 글은 없다 */
function trendCard(
  label: string,
  days: string[],
  values: number[],
  fmt: (n: number) => string,
  esc2: (v: unknown) => string,
): string {
  const today = values[values.length - 1] ?? 0;
  const yest = values[values.length - 2] ?? 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return `<div class="trend-card"><div class="trend-head"><span class="trend-label">${esc2(label)}</span><strong class="trend-today">${esc2(fmt(today))}</strong></div>
${barChart(label, days, values, fmt, esc2)}
<small class="hint">어제 ${esc2(fmt(yest))}, 14일 합 ${esc2(fmt(sum))}</small></div>`;
}

/** 오늘 숫자와 최근 14일 추이 (한국 시간 하루). 막대는 서버가 그린 SVG, 표는 같은 숫자를 글로 */
function trendSection(v: AdminView): string {
  const d = v.trend.days;
  const days = d.map((x) => x.day);
  const n = (x: number) => String(x);
  const rows = [...d]
    .reverse()
    .map(
      (x) =>
        `<tr><td>${esc(x.day)}</td><td>${x.signups}</td><td>${x.active}</td><td>${x.asks}</td><td>${usd(x.costMicros)}</td></tr>`,
    )
    .join('');
  return `<section id="trend"><h2>오늘과 최근 ${d.length}일</h2>
<div class="trend">
${trendCard(
  '가입',
  days,
  d.map((x) => x.signups),
  n,
  esc,
)}
${trendCard(
  '활동 계정',
  days,
  d.map((x) => x.active),
  n,
  esc,
)}
${trendCard(
  '질문',
  days,
  d.map((x) => x.asks),
  n,
  esc,
)}
${trendCard(
  '추정 비용',
  days,
  d.map((x) => x.costMicros),
  usd,
  esc,
)}
</div>
<p class="hint">하루는 한국 시간 기준이에요. 활동 계정은 그날 코인 기록이나 질문을 서버에 보낸 계정이라 앱만 켜 둔 사람은 빠져요. 아래 이번 달 합계는 UTC 달 기준이라 달 경계에서 며칠 어긋나요.</p>
<details><summary>숫자로 보기</summary><div class="table-scroll"><table class="trend-table"><thead><tr><th>날짜</th><th>가입</th><th>활동 계정</th><th>질문</th><th>추정 비용</th></tr></thead><tbody>${rows}</tbody></table></div></details></section>`;
}

/** 밖에서 도는 백업 한 작업의 이름 */
const JOB_KO = { db: '데이터베이스 덤프', files: '백업 파일 외장 디스크 사본' } as const;

/** 마지막 성공 뒤 지난 시간 (시간, 내림) */
const hoursSince = (at: number, now = Date.now()) => Math.max(0, Math.floor((now - at) / 3_600_000));

/** 홈 백업 카드의 한 줄: 마지막 성공, 마지막 실패와 까닭, 오래 성공 못 함 */
function jobGlance(kind: keyof typeof JOB_KO, j: BackupJob): string {
  const name = JOB_KO[kind];
  const ok = j.lastOkAt === null ? '성공한 기록이 없어요' : `마지막 성공 ${when(j.lastOkAt)}`;
  if (j.state === 'failed')
    return `<li class="bad"><a href="#settings/backup">${esc(name)}: 마지막 실패 ${j.lastFailAt === null ? '' : esc(when(j.lastFailAt))}, 까닭 ${esc(j.lastFailReason ?? '')}. ${esc(ok)}</a></li>`;
  if (j.state === 'stale')
    return `<li class="warn"><a href="#settings/backup">${esc(name)}: ${esc(ok)}${j.lastOkAt === null ? '' : `, ${hoursSince(j.lastOkAt)}시간째 성공하지 못했어요`}</a></li>`;
  return `<li><a href="#settings/backup">${esc(name)}: ${esc(ok)}</a></li>`;
}

/** 홈에 보이는 백업 (서버가 받은 이용자 백업 한 줄, 밖에서 도는 백업 한 줄씩. 설정의 백업 현황으로 가는 링크) */
function backupGlance(b: BackupStatus): string {
  const outside = b.external.db.state === 'unknown' && b.external.files.state === 'unknown';
  const ext = outside
    ? `<p class="hint">데이터베이스 덤프와 외장 디스크 사본의 결과는 아직 못 읽었어요 (상태 파일이 없어요). <a href="#settings/backup">백업 현황</a></p>`
    : `<ul class="todo">${jobGlance('db', b.external.db)}${jobGlance('files', b.external.files)}</ul>`;
  if (!b.enabled)
    return `<p class="hint">서버 백업이 꺼져 있어요. 서버 설정에 백업 암호 키를 넣으면 켜져요 (BACKUP_ENC_KEY 가 비었어요). <a href="#settings/backup">백업 현황</a></p>${ext}`;
  const used = backupPercent(b);
  const blocked = b.maxBytes === 0;
  const last =
    b.lastUploadAt === null ? '아직 올라온 백업이 없어요' : `마지막으로 올라온 때 ${when(b.lastUploadAt)}`;
  const level =
    blocked || (used !== null && used >= BACKUP_BAD_PERCENT)
      ? 'bad'
      : used !== null && used >= BACKUP_WARN_PERCENT
        ? 'warn'
        : '';
  return `<ul class="todo"><li class="${level}"><a href="#settings/backup">${esc(last)}, 파일 ${b.files}개, ${bytesText(b.bytes)}${blocked ? ', 상한 0 (모두 막힘)' : used === null ? '' : ` (상한의 ${used}%)`}</a></li></ul>${ext}`;
}

const JOB_STATE_TAG: Record<BackupJob['state'], string> = {
  ok: '<span class="tag live">정상</span>',
  stale: '<span class="tag soon">오래 성공하지 못했어요</span>',
  failed: '<span class="tag bad">마지막이 실패</span>',
  unknown: '알 수 없어요 (상태 파일이 없어요)',
};

/** 설정의 백업 현황의 밖에서 도는 백업 한 작업 */
function jobSection(kind: keyof typeof JOB_KO, j: BackupJob): string {
  const row = (k: string, val: string) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`;
  return `<h3>${esc(JOB_KO[kind])}</h3>
<dl class="stats">
${row('상태', JOB_STATE_TAG[j.state])}
${row('마지막 성공', j.lastOkAt === null ? '기록 없음' : `${esc(when(j.lastOkAt))}${j.lastOkNote ? `, ${esc(j.lastOkNote)}` : ''}`)}
${row('마지막 실패', j.lastFailAt === null ? '기록 없음' : `${esc(when(j.lastFailAt))}, ${esc(j.lastFailReason ?? '')}`)}
${row('작업이 확인한 때', j.checkedAt === null ? '기록 없음' : esc(when(j.checkedAt)))}
</dl>`;
}

/** 설정의 백업 현황: 서버가 아는 것과 밖에서 도는 백업이 남긴 결과. 모르는 것은 모른다고 쓴다 */
function backupSection(v: AdminView): string {
  const b = v.backup;
  const used = backupPercent(b);
  const row = (k: string, val: string) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`;
  const unknown = b.external.db.state === 'unknown' && b.external.files.state === 'unknown';
  return `<section id="backup-status"><h2>백업 현황</h2>
<h3>이용자 서버 백업 (앱에서 올린 .fairybackup)</h3>
<dl class="stats">
${row('상태', b.enabled ? '켜짐' : '꺼짐 (서버 설정에 백업 암호 키가 없어요, BACKUP_ENC_KEY 가 비었어요)')}
${row('마지막으로 올라온 때', b.lastUploadAt === null ? '없어요' : esc(when(b.lastUploadAt)))}
${row('파일', `${b.files}개 (${b.accounts}명)`)}
${row('총 크기', `${esc(bytesText(b.bytes))}${b.maxBytes === 0 ? ' / 상한 0 (모두 막힘)' : b.maxBytes ? ` / 상한 ${esc(bytesText(b.maxBytes))}` : ' (상한 없음)'}`)}
${row('상한 사용', b.maxBytes === 0 ? '0, 새 백업 올리기가 모두 막혀요 (507)' : used === null ? '알 수 없어요' : `${used}%`)}
${row('올리기 실패', '기록 없음 (서버가 실패를 남기지 않아요)')}
</dl>
<p class="hint">상한을 넘거나 상한이 0 이면 새 백업 올리기가 막혀요(507). 올린 지 1년 지난 계정의 백업은 서버가 지워요.</p>
${jobSection('db', b.external.db)}
${jobSection('files', b.external.files)}
<p class="hint">${
    unknown
      ? '데이터베이스 덤프(fairy-backup)와 백업 파일 사본(fairy-backup-files)은 다른 컨테이너가 맥미니 외장 디스크(FAIRY_BACKUP_DIR)에 써요. 그 컨테이너가 남기는 상태 파일(BACKUP_STATUS_DIR)이 아직 없어서 결과를 알 수 없어요. 서버 배포 뒤 맥미니에서 백업 컨테이너를 새로 올리면 한 시간 안에 보여요.'
      : '두 작업이 외장 디스크에 쓴 결과를 상태 파일로 남기면 서버가 읽어 보여요. 마지막 성공이 26시간을 넘기면 홈에서 경고해요. 덤프는 가장 새 덤프 파일의 시각과 압축이 온전한지로, 사본은 맞추기가 끝났는지로 정해요.'
  }</p></section>`;
}

const reportTag = (st: ReportState) =>
  `<span class="tag ${st === 'pending' ? 'bad' : st === 'seen' ? 'soon' : 'live'}">${REPORT_STATE_KO[st]}</span>`;
const reportHref = (id: string) => placeHref('reports', `?report=${encodeURIComponent(id)}`);
const userHref = (code: string) => placeHref('users/list', `?q=${encodeURIComponent(code)}`);
const FILTER_KO: Record<ReportFilter, string> = {
  all: '전체',
  pending: '미처리',
  seen: '확인',
  done: '조치',
};

/** 신고 하나를 열었을 때: 질문과 답, 상태 바꾸기, 이용자로 가기, 막기. 열면 운영 기록에 남는다 */
function reportDetail(v: AdminView, o: ReportOpen): string {
  const nameText = `${o.nickname ?? '(닉네임 없음)'} ${o.code}`;
  // 결과 글은 아래 한 곳에만 그린다 (단추마다 그리면 같은 글이 여럿 생긴다)
  const move = (to: ReportState, label: string, ghost = false, next = false) =>
    `<form method="post" action="/admin/reports/status" class="inline">${hidden(v.csrf)}<input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="from" value="${o.status}"><input type="hidden" name="to" value="${to}">${next ? '<input type="hidden" name="next" value="1">' : ''}<button type="submit"${ghost ? ' class="ghost"' : ''}>${esc(label)}</button></form>`;
  const moves =
    o.status === 'pending'
      ? move('seen', '확인했어요') +
        move('done', '조치했어요') +
        move('done', '조치하고 다음 미처리 열기', false, true)
      : o.status === 'seen'
        ? move('done', '조치했어요') +
          move('done', '조치하고 다음 미처리 열기', false, true) +
          move('pending', '미처리로 되돌리기', true)
        : move('pending', '미처리로 되돌리기', true);
  const nextLink =
    v.reports.next === undefined
      ? ''
      : v.reports.next === null
        ? '<span class="hint">다른 미처리 신고는 없어요</span>'
        : `<a class="button-link" href="${esc(reportHref(v.reports.next))}">다음 미처리 열기</a>`;
  const blockFields = { account: o.code, blocked: '1', ret: 'reports' };
  const block = o.blocked
    ? `<span class="tag ended">채팅 이용권 막힘</span> ${postButton(v.csrf, '/admin/ai/block', { account: o.code, blocked: '0', ret: 'reports' }, '막기 풀기')}`
    : `${sureForm(v, '/admin/ai/block', blockFields, `${nameText} 채팅 이용권 막을게요`, '채팅 이용권 막기', false)}
${
  o.status === 'done'
    ? ''
    : sureForm(
        v,
        '/admin/ai/block',
        { ...blockFields, mark_report: o.id },
        `${nameText} 채팅 이용권 막고 신고 #${o.id} 조치로 표시할게요`,
        '막고 조치로 표시',
        false,
      )
}`;
  const others = o.others.length
    ? `<p class="hint">이 이용자의 다른 신고: ${o.others.map((x) => `<a href="${esc(reportHref(x.id))}">#${esc(x.id)} (${REPORT_STATE_KO[x.status]})</a>`).join(', ')}</p>`
    : '';
  return `<div class="report-open" id="report-open">
<h3>신고 #${esc(o.id)}</h3>
<p class="hint">이 신고의 질문과 답을 열었어요. 연 기록이 운영 기록에 남아요 (누가, 언제, 어느 신고). 대화 글은 기록에 복사하지 않아요.</p>
<dl class="stats">
<div><dt>받은 때</dt><dd>${when(o.at)}</dd></div>
<div><dt>이용자</dt><dd><a href="${esc(userHref(o.code))}">${esc(o.nickname ?? '(닉네임 없음)')} <code>${esc(o.code)}</code></a></dd></div>
<div><dt>상태</dt><dd>${reportTag(o.status)}</dd></div>
<div><dt>처리</dt><dd>${o.handledAt ? `${esc(o.handledName ?? o.handledBy ?? '')}, ${when(o.handledAt)}` : '아직 없어요'}</dd></div>
</dl>
${
  o.closed
    ? '<p class="flash error" role="alert">이 이용자는 지금 만 18세 이상이 아니라서 질문과 답을 열지 않아요. 처리 상태와 막기는 그대로 할 수 있어요</p>'
    : `<h3>질문</h3>
<pre class="convo">${esc(o.question || '(질문 없이 신고했어요)')}</pre>
<h3>답</h3>
<pre class="convo">${esc(o.answer)}</pre>`
}
${others}
${formErr(v, 'reports/status', o.id)}${formErr(v, 'ai/block', o.code)}
<div class="row">${moves}</div>
<div class="row">${block}</div>
<div class="row">${nextLink}<a class="button-link" href="${esc(userHref(o.code))}">이용자 보기</a><a class="button-link" href="${esc(placeHref('reports'))}">목록으로</a></div>
</div>`;
}

/**
 * 신고 칸 (#151): 미처리부터 목록, 한 건을 열면 질문과 답, 처리 상태 바꾸기, 이용자로 가기, 채팅 이용권 막기.
 * 목록에는 대화 글이 없고 열어 봐야 보인다 (연 기록은 운영 기록에 남는다)
 */
function reportsSection(v: AdminView): string {
  const r = v.reports;
  const open =
    r.open === null
      ? '<p class="flash error" role="alert">없는 신고예요. 받은 지 30일이 지나 지워졌거나 번호가 틀렸어요</p>'
      : r.open
        ? reportDetail(v, r.open)
        : '';
  const filters = (['all', 'pending', 'seen', 'done'] as const)
    .map(
      (f) =>
        `<a class="button-link${r.filter === f ? ' current' : ''}" href="${esc(placeHref('reports', f === 'all' ? '' : `?rs=${f}`))}"${r.filter === f ? ' aria-current="true"' : ''}>${FILTER_KO[f]} ${f === 'all' ? r.total : r[f]}</a>`,
    )
    .join('');
  const rows = r.rows
    .map(
      (x) =>
        `<tr><td data-l="번호"><a href="${esc(reportHref(x.id))}">#${esc(x.id)}</a></td><td data-l="받은 때">${when(x.at)}</td>
<td data-l="이용자"><a href="${esc(userHref(x.code))}">${esc(x.nickname ?? '(닉네임 없음)')} <code>${esc(x.code)}</code></a>${x.sameUser > 1 ? ` <span class="tag">신고 ${x.sameUser}건</span>` : ''}${x.blocked ? ' <span class="tag ended">막힘</span>' : ''}</td>
<td data-l="상태">${reportTag(x.status)}</td><td data-l="처리">${x.handledAt ? `${esc(x.handledName ?? x.handledBy ?? '')}, ${when(x.handledAt)}` : ''}</td>
<td><a class="button-link" href="${esc(reportHref(x.id))}">열어 보기</a></td></tr>`,
    )
    .join('');
  const table = r.rows.length
    ? `<table class="cards"><thead><tr><th>번호</th><th>받은 때</th><th>이용자</th><th>상태</th><th>처리</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">${r.total === 0 ? '접수된 신고가 없어요' : `${FILTER_KO[r.filter]} 신고가 없어요`}</p>`;
  return `<section id="reports-list"><h2>신고</h2>
<p class="hint">이용자가 따로 동의하고 신고한 AI 대화예요. 신고된 질문과 답 하나씩만 받은 날부터 30일 보관하고 그 뒤 지워요. 목록에는 대화 글이 없어요. 열어 보면 운영 기록에 남아요.</p>
<p class="hint">상태 뜻: <strong>미처리</strong>는 아직 안 본 신고, <strong>확인</strong>은 읽었지만 아직 처리 중, <strong>조치</strong>는 막기 같은 처리를 마친 신고예요. 상태는 운영자끼리 보는 표시이고 이용자에게는 알리지 않아요.</p>
${open}
<div class="row">${filters}</div>
${table}
</section>`;
}

/** 흐름의 단계 표시 (작성, 대상 확인, 미리보기, 확정, 결과 확인). current 는 1부터 */
function flowSteps(current: number): string {
  return `<ol class="steps" aria-label="진행 단계">${['작성', '대상 확인', '미리보기', '확정', '결과 확인']
    .map(
      (name, i) =>
        `<li class="${i + 1 < current ? 'done' : i + 1 === current ? 'now' : ''}"${i + 1 === current ? ' aria-current="step"' : ''}>${i + 1}. ${name}</li>`,
    )
    .join('')}</ol>`;
}

/** 작성 화면 위: 방금 이 흐름을 마쳤으면 결과 확인 단계(성공 글과 운영 기록 링크), 아니면 1단계 */
function flowHead(v: AdminView, action: string, logAction: string): string {
  const f = v.flash;
  if (f && !f.error && !f.edit && f.form === action)
    return `<div class="flow-result">${flowSteps(5)}<p class="flash" role="status" id="form-ok">${esc(f.text)}</p>
<p><a class="button-link" href="${esc(placeHref('settings/log', logAction ? `?la=${encodeURIComponent(logAction)}` : ''))}">운영 기록에서 확인</a></p></div>`;
  return flowSteps(1);
}

/** 미리보기 단계의 숨은 칸: 작성 때 쓴 값을 그대로 확정 폼으로 넘긴다 */
const carry = (fields: Record<string, string | string[]>) =>
  Object.entries(fields)
    .flatMap(([k, x]) =>
      ([] as string[]).concat(x).map((y) => `<input type="hidden" name="${esc(k)}" value="${esc(y)}">`),
    )
    .join('');

/** 확정 폼이 싣는 한 번만 쓰는 번호 */
const flowKey = (nonce: string) => `<input type="hidden" name="flow" value="${esc(nonce)}">`;

/** "고치기": 미리보기를 닫고 쓰던 값이 채워진 작성 화면으로 */
const editButton = (csrf: string, action: string) =>
  `<form method="post" action="/admin/flow/cancel" class="inline">${hidden(csrf)}<input type="hidden" name="action" value="${esc(action)}"><button type="submit" class="ghost">고치기</button></form>`;

function grantsSection(v: AdminView): string {
  const pv = v.preview?.action === 'grants/batch' ? v.preview : undefined;
  if (pv) {
    const g = pv.grant;
    const rows = g.targets
      .map(
        (t) =>
          `<tr class="${t.found ? '' : 'bad'}"><td data-l="적은 말"><code>${esc(t.ref)}</code></td><td data-l="대상">${
            t.found
              ? `${who({ code: t.code ?? '', nickname: t.nickname ?? null })} #${esc(t.id)}`
              : '<span class="tag bad">찾지 못함</span>'
          }${t.duplicate ? ' <span class="tag">중복</span> <small>한 번만 보내요</small>' : ''}${t.mergedFrom ? ` <span class="tag soon">합쳐진 계정 #${esc(t.mergedFrom)}, 남은 계정이 받아요</span>` : ''}</td><td data-l="나이 구분">${esc(t.age ?? '')}</td></tr>`,
      )
      .join('');
    const found = g.targets.filter((t) => t.found);
    const single =
      g.people === 1 && found[0]
        ? plain({ code: found[0].code ?? '', nickname: found[0].nickname ?? null })
        : '';
    const count = {
      lines: g.targets.length,
      missing: g.targets.filter((t) => !t.found).length,
      dup: g.targets.filter((t) => t.duplicate).length,
      merged: g.targets.filter((t) => t.mergedFrom).length,
    };
    const other =
      v.grantRef && !g.targets.some((t) => t.ref === v.grantRef || t.code === v.grantRef)
        ? `<div class="flash warn" role="status"><p>쓰던 지급이 있어요 (${esc(
            g.targets
              .map((t) => t.ref)
              .join(', ')
              .slice(0, 80),
          )}). 이어서 할까요, 버리고 <code>${esc(v.grantRef)}</code> 로 새로 쓸까요?</p>
<div class="row"><a class="button-link" href="${placeHref('users/grants')}">이어서</a> <form method="post" action="/admin/flow/cancel" class="inline">${hidden(v.csrf)}<input type="hidden" name="action" value="grants/batch"><input type="hidden" name="discard" value="1"><button type="submit">버리고 ${esc(v.grantRef)} 로</button></form></div></div>`
        : '';
    return `<section class="flow"><h2>코인과 채팅 이용권 지급</h2>
${other}${flowSteps(3)}
<p class="hint">아직 보내지 않았어요. 아래 대상과 양을 확인하고 확정해 주세요.</p>
<dl class="stats">
<div><dt>받는 사람</dt><dd>${g.people}명</dd></div>
<div><dt>한 사람마다</dt><dd>코인 ${g.coins}, 채팅 이용권 ${g.passes}장</dd></div>
<div><dt>모두 합쳐</dt><dd>코인 ${g.coins * g.people}, 채팅 이용권 ${g.passes * g.people}장</dd></div>
<div><dt>쪽지 만료</dt><dd>${g.days}일</dd></div>
</dl>
<p class="hint">적은 ${count.lines}줄: 찾지 못한 ${count.missing}, 중복 ${count.dup}, 합쳐진 계정 ${count.merged}.</p>
<p>지급 사유 (이용자에게 보여요): <q>${esc(g.reason)}</q></p>
<table class="targets"><thead><tr><th>적은 말</th><th>대상</th><th>나이 구분</th></tr></thead><tbody>${rows}</tbody></table>
${g.blocked ? `<p class="flash error" role="alert">${esc(g.blocked)}</p>` : ''}
<form method="post" action="/admin/grants/batch" class="grid">${formErr(v, 'grants/batch')}${hidden(v.csrf)}${flowKey(pv.nonce)}${carry(pv.fields)}
${
  g.people === 1
    ? ''
    : `<label class="count wide">받는 사람 수를 숫자로 다시 적어 주세요 (위 표의 ${g.people}명) <input name="people" inputmode="numeric" pattern="${g.people}" title="${g.people}" autocomplete="off" required></label>`
}
${confirmBox(single ? `위 표의 ${single}에게 코인 ${g.coins}, 채팅 이용권 ${g.passes}장 지급할게요` : `위 ${g.people}명에게 지급할게요`)}
<button type="submit"${g.blocked ? ' disabled' : ''}>확정하고 지급 쪽지 보내기</button></form>
${editButton(v.csrf, 'grants/batch')}</section>`;
  }
  const selected = v.account;
  const value = v.grantRef ?? '';
  // 찾던 이용자와 칸에 채운 받는 사람이 같을 때만 "선택한 이용자" 로 이름을 보인다 (다르면 칸의 말만 믿는다)
  const same = (x: string) =>
    x.trim() === selected?.id || x.trim().toLowerCase() === selected?.code.toLowerCase();
  const chosen = v.picked?.length
    ? `<p class="selected">고른 ${v.picked.length}명${v.pickedDropped ? ` (한 번에 20명까지만 넣을 수 있어 ${v.pickedDropped}명은 빠졌어요)` : ''}: ${v.picked.map((x) => `${esc(x.nickname ?? '(닉네임 없음)')} <code>${esc(x.code)}</code>`).join(', ')}</p>`
    : selected && value && same(value)
      ? `<p class="selected">선택한 이용자: #${esc(selected.id)} ${who(selected)}</p>`
      : '';
  const d = draftOf(v, 'grants/batch');
  return `<section><h2>코인과 채팅 이용권 지급</h2>
${flowHead(v, 'grants/batch', 'grant.batch')}
<p class="hint">지급은 쪽지함으로 보내며 이용자가 열 때 받아요. 먼저 대상을 확인하는 화면이 나오고, 그곳에서 확정해야 보내요. 한 번에 20명, 한 사람마다 코인 10000개와 채팅 이용권 1000장까지예요.</p>
${chosen}
<form method="post" action="/admin/grants/preview" class="grid">${formErr(v, 'grants/batch', undefined, true)}${hidden(v.csrf)}
<label class="wide">받을 계정 번호 또는 기기 코드, 한 줄에 하나씩 최대 20명 (닉네임은 같은 이름이 있을 수 있어 쓸 수 없어요. 이용자 칸에서 찾아 고르면 채워져요) <textarea name="accounts" required maxlength="400">${esc(val(d, 'accounts', value))}</textarea></label>
<label>코인 수 <input name="coins" type="number" min="0" max="10000" value="${esc(val(d, 'coins', '0'))}" required></label>
<label>채팅 이용권 수 <input name="chat_passes" type="number" min="0" max="1000" value="${esc(val(d, 'chat_passes', '0'))}" required></label>
<label>만료 날수 <input name="days" type="number" min="1" max="365" value="${esc(val(d, 'days', '30'))}" required></label>
<label class="wide">지급 사유, 이용자에게 보여요 <textarea name="reason" required maxlength="200">${esc(val(d, 'reason'))}</textarea></label>
<button type="submit">대상 확인하기</button></form>
${recentGrantsTable(v)}</section>`;
}

/** 최근 지급 쪽지와 받았는지 (열었는지) */
function recentGrantsTable(v: AdminView): string {
  const rows = (v.recentGrants ?? [])
    .map(
      (t) =>
        `<tr><td data-l="보낸 때">${when(t.sentAt)}</td><td data-l="받는 사람"><a href="${esc(userOpenHref(t.accountId))}">${esc(t.nickname ?? '(닉네임 없음)')}</a> <code>${esc(t.code)}</code></td><td data-l="내용">${esc(trailGift(t))}</td><td data-l="받았는지">${trailState(t)}</td><td data-l="철회">${withdrawCell(v, t, t.code)}</td></tr>`,
    )
    .join('');
  return `<h3>최근 지급과 받았는지</h3>
<p class="hint">보낸 쪽지 20건. 이용자가 쪽지를 열면 받은 것으로 쳐요. 서버가 아는 것은 연 시각과 실제로 받은 양이에요. 아직 안 연 쪽지는 철회할 수 있어요.</p>
${rows ? `<table class="cards"><thead><tr><th>보낸 때</th><th>받는 사람</th><th>내용</th><th>받았는지</th><th>철회</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">아직 보낸 지급이 없어요</p>'}`;
}

// ---- 알리기 (이슈 #154): 게시물 목록과 만들기 ----

const POST_KIND_LABEL = { notice: '공지', event: '이벤트', coupon: '쿠폰', version: '버전 기준' } as const;
const POST_STATE_TAG: Record<string, string> = {
  live: '<span class="tag live">진행 중</span>',
  soon: '<span class="tag soon">예정</span>',
  ended: '<span class="tag ended">끝남</span>',
};

/** 게시물 목록 주소 (찾기 조건을 바꿔서) */
function postsHref(f: PostsView['filter'], patch: Partial<PostsView['filter']> = {}): string {
  const x = { ...f, ...patch };
  const p = new URLSearchParams();
  if (x.kind !== 'all') p.set('pk', x.kind);
  if (x.state !== 'all') p.set('ps', x.state);
  if (x.q) p.set('pq', x.q);
  const q = p.toString();
  return `/admin${q ? `?${q}` : ''}#announce/posts`;
}

/** 저장과 앱 반영은 다르다: 서버에 저장되는 때, 홈페이지 파일이 바뀌는 때, 앱이 받는 때를 나눠 보인다 */
function reachBox(kind: 'notice' | 'event' | 'coupon' | 'version', savedAt?: number): string {
  const hm = (ms: number) => when(ms);
  const WEB = 15 * 60_000;
  const items: Array<[string, string]> = [];
  if (kind === 'coupon') {
    items.push(['서버에 저장', '만든 순간부터 쿠폰 코드를 쓸 수 있어요. 앱이 받는 것을 기다리지 않아요.']);
    items.push([
      '앱에 닿음',
      '쿠폰은 홈페이지 파일을 거치지 않아요. 사용자가 코드를 넣으면 서버가 바로 받아 줘요.',
    ]);
  } else if (kind === 'version') {
    items.push([
      '서버에 저장',
      '확정하는 순간 서버 관문이 새 기준을 써요. 낮은 앱의 다음 요청부터 막히거나 안내가 떠요(5초 안).',
    ]);
    items.push([
      '앱에 닿음',
      '앱이 서버에 요청할 때마다 기준을 보니 앱이 새로 받을 파일은 없어요. 안내문은 공지와 같은 길로 가요.',
    ]);
  } else {
    const file = kind === 'notice' ? 'notices.json' : 'events.json';
    const every = kind === 'notice' ? '4시간' : '6시간';
    const homeAt = savedAt !== undefined ? ` (늦어도 ${hm(savedAt + WEB)} 쯤)` : '';
    const appAt =
      savedAt !== undefined
        ? ` (모두에게는 늦어도 ${hm(savedAt + WEB + (kind === 'notice' ? 4 : 6) * 3_600_000)})`
        : '';
    items.push([
      '서버에 저장',
      `확정하는 순간 서버의 ${file} 에 들어가요.${savedAt !== undefined ? ` (${hm(savedAt)})` : ''}`,
    ]);
    items.push([
      '홈페이지 파일',
      `공개 레포가 10분마다 서버에서 받아 검사하고 홈페이지에 올려요. 보통 10~15분 걸려요${homeAt}. 검사에 걸리거나 보호된 main 에 승인이 필요하면 더 걸려요.`,
    ]);
    items.push([
      '앱에 닿음',
      `앱은 켤 때와 ${every}마다 홈페이지 파일을 받아요${appAt}.${kind === 'event' ? ' 선물 받기와 배수는 서버가 바로 받아 주지만, 앱 목록에 보이기 전에는 받기 단추가 안 떠요.' : ''}`,
    ]);
  }
  return `<div class="reach" role="note"><h3>저장과 앱 반영은 달라요</h3><ol>${items
    .map(([a, b]) => `<li><strong>${esc(a)}</strong> ${esc(b)}</li>`)
    .join('')}</ol></div>`;
}

function postRowHtml(v: AdminView, r: PostRow): string {
  const period =
    r.from === null && r.until === null
      ? '기간 없음'
      : `${r.from !== null ? when(r.from) : '처음부터'} ~ ${r.until !== null ? when(r.until) : '끝없이'}`;
  const note = r.note ? ` <small>${esc(r.note)}</small>` : '';
  // 공지는 문서 하나라 마지막 저장 뒤 15분 안이면 홈페이지에 아직 안 닿았을 수 있다 (서버는 홈페이지 쪽 결과를 알 수 없다)
  const pending =
    r.kind === 'notice' && v.noticesUpdated !== undefined && Date.now() < v.noticesUpdated + 15 * 60_000
      ? ' <span class="tag soon">홈페이지 반영 대기</span>'
      : '';
  const load = `<a class="button-link" href="/admin?load=${encodeURIComponent(r.load)}#announce/new">${r.kind === 'notice' || r.kind === 'version' ? '불러와 고치기' : '복사해서 새로 만들기'}</a>`;
  let close = '';
  if (r.kind === 'notice')
    close = sureForm(
      v,
      '/admin/notices/delete',
      { id: r.id },
      `공지 "${r.title}" (${r.id}) 지울게요`,
      '지우기',
    );
  else if (r.kind === 'event' && r.closable)
    close = sureForm(
      v,
      '/admin/events/end',
      { id: r.id },
      r.from !== null && Date.now() < r.from
        ? `이벤트 "${r.title}" (${r.id}) 지울게요`
        : `이벤트 "${r.title}" (${r.id}) 지금 끝낼게요`,
      r.from !== null && Date.now() < r.from ? '지우기' : '지금 끝내기',
    );
  else if (r.kind === 'coupon' && r.closable)
    close = sureForm(
      v,
      '/admin/coupons/disable',
      { id: r.id },
      `쿠폰 #${r.id} (${r.title}) 끌게요, 다시 켤 수 없어요`,
      '끄기',
    );
  return `<tr${r.state === 'ended' ? ' class="off"' : ''}><td data-l="종류">${esc(POST_KIND_LABEL[r.kind])}</td>
<td class="name" data-l="제목">${esc(r.title)}<br><small>${esc(r.sub)}</small></td>
<td data-l="상태">${POST_STATE_TAG[r.state]}${note}${pending}</td><td data-l="기간">${esc(period)}</td>
<td class="act">${load} ${close}</td></tr>`;
}

function postsSection(v: AdminView): string {
  const p = v.posts;
  if (!p) return '<section><h2>게시물</h2><p class="empty">불러오지 못했어요</p></section>';
  const f = p.filter;
  const chip = (label: string, patch: Partial<typeof f>, on: boolean) =>
    `<a class="button-link${on ? ' current' : ''}" href="${esc(postsHref(f, patch))}"${on ? ' aria-current="true"' : ''}>${esc(label)}</a>`;
  const kinds = [
    chip('모두', { kind: 'all' }, f.kind === 'all'),
    ...(['notice', 'event', 'coupon', 'version'] as const).map((k) =>
      chip(`${POST_KIND_LABEL[k]} ${p.totals[k]}`, { kind: k }, f.kind === k),
    ),
  ].join('');
  const states = [
    chip('모든 상태', { state: 'all' }, f.state === 'all'),
    chip('진행 중', { state: 'live' }, f.state === 'live'),
    chip('예정', { state: 'soon' }, f.state === 'soon'),
    chip('끝남', { state: 'ended' }, f.state === 'ended'),
  ].join('');
  const body = p.rows.map((r) => postRowHtml(v, r)).join('');
  const filtered = f.kind !== 'all' || f.state !== 'all' || f.q !== '';
  const docInfo = v.notices
    ? `공지 문서는 ${when(v.noticesUpdated ?? 0)} 에 마지막으로 저장했어요. 홈페이지에는 늦어도 ${when((v.noticesUpdated ?? 0) + 15 * 60_000)} 쯤, 앱에는 켤 때와 4시간마다 닿아요.`
    : '공지 문서를 여기서 저장한 적이 없어요. 처음 저장하면 홈페이지 notices.json 전체가 이 화면의 내용으로 바뀌어요.';
  const dRw = draftOf(v, 'rewards/policy');
  return `<section><h2>게시물</h2>
<p class="hint">공지, 이벤트, 쿠폰, 앱 버전 기준을 한 목록에서 봐요. 진행 중이 위, 끝난 것이 아래예요. ${esc(docInfo)}</p>
<p class="hint">저장하면 서버에는 바로 들어가지만 홈페이지 파일에는 10~15분 뒤에 닿아요(공지, 이벤트). 방금 저장한 공지에는 "홈페이지 반영 대기" 표시가 붙고, 15분이 지나면 사라져요. 서버는 홈페이지 쪽 결과를 직접 확인하지 못해요.</p>
<form method="get" action="/admin" class="row posts-find">
<input type="hidden" name="pk" value="${esc(f.kind === 'all' ? '' : f.kind)}">
<input type="hidden" name="ps" value="${esc(f.state === 'all' ? '' : f.state)}">
<label>찾기 (제목, 본문, id, 메모) <input name="pq" type="search" maxlength="60" value="${esc(f.q)}" placeholder="예: 신년"></label>
<button type="submit">찾기</button>${f.q ? ` <a class="button-link" href="${esc(postsHref(f, { q: '' }))}">찾기 지우기</a>` : ''}
</form>
<div class="chips" aria-label="종류">${kinds}</div>
<div class="chips" aria-label="상태">${states}</div>
${
  body
    ? `<div class="table-scroll"><table class="cards posts"><thead><tr><th>종류</th><th>제목</th><th>상태</th><th>기간</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="empty">${filtered ? '조건에 맞는 게시물이 없어요' : '아직 게시물이 없어요'}</p>`
}
${p.hidden > 0 ? `<p class="hint">종류마다 ${POSTS_PER_KIND}건까지 보여요. ${p.hidden}건이 더 있어요. 찾기나 상태로 좁혀 주세요.</p>` : ''}
<p><a class="button-link current" href="#announce/new">새로 만들기</a></p>
</section>
<section><h2>선물과 쿠폰을 받는 계정</h2>
<form method="post" action="/admin/rewards/policy" class="row">${formErr(v, 'rewards/policy')}${hidden(v.csrf)}
<label>선물과 쿠폰 받는 계정 <select name="login_only">${opt(dRw, 'login_only', '1', '로그인 계정만 (기본)', v.rewardsLoginOnly ? '1' : '0')}${opt(dRw, 'login_only', '0', '기기 계정도', v.rewardsLoginOnly ? '1' : '0')}</select></label>
<button type="submit">저장</button>
</form>
<p class="hint">쿠폰 코드는 서버가 해시만 두어서 만든 뒤에는 다시 볼 수 없어요. 만든 직후 결과 화면에서 복사해 두세요. 목록에는 코드 앞 4자만 보여요.</p>
</section>
${reachBox('notice')}`;
}

const MAKE_KINDS = [
  ['notices', '공지', '앱 알림 창에 떠요'],
  ['events', '이벤트', '선물이나 배수'],
  ['coupons', '쿠폰', '코드로 코인 받기'],
  ['versions', '버전', '강제와 권장 업데이트'],
] as const;
const MAKE_LOG: Record<string, string> = {
  notices: 'notice.create',
  events: 'event.create',
  coupons: 'coupon.create',
  versions: 'versions',
};
const REACH_KIND = { notices: 'notice', events: 'event', coupons: 'coupon', versions: 'version' } as const;

/** 쓰던 초안이 있으면 불러오기와 지우기 */
function draftBar(v: AdminView, kind: string): string {
  const at = v.draftTimes?.[kind];
  if (at === undefined) return '';
  return `<form method="post" action="/admin/drafts/load" class="row draft-bar">${hidden(v.csrf)}<input type="hidden" name="draft" value="${esc(kind)}">
<span>저장한 초안이 있어요 (${esc(when(at))})</span>
<button type="submit" class="ghost">초안 불러오기</button><button type="submit" formaction="/admin/drafts/delete" class="ghost">초안 지우기</button></form>`;
}

/** 폼 맨 아래 단추: 미리보기 하나와 초안 저장 */
const makeButtons = (kind: string) =>
  `<div class="wide actions"><button type="submit">미리보기</button><button type="submit" formaction="/admin/drafts/save" formnovalidate class="ghost">초안 저장</button><input type="hidden" name="draft" value="${esc(kind)}"></div>`;

function noticeForm(v: AdminView, d: Draft, dflt: ReturnType<typeof formDefaults>): string {
  const more = ['link', 'from', 'until', 'versions', 'platforms'].some((k) => val(d, k) !== '');
  return `<form method="post" action="/admin/notices/preview" class="grid mk-f mk-notices">${formErr(v, 'notices', undefined, true)}${hidden(v.csrf)}
<label>id (영문, 숫자, ., _, - 80자. 같은 id 면 바꿔요) <input name="id" required maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,79}" value="${esc(val(d, 'id', `notice-${dflt.day}`))}"></label>
<label>종류 <select name="kind">${opt(d, 'kind', 'info', '알림 (한 번)', 'info')}${opt(d, 'kind', 'important', '중요 (확인할 때까지)', 'info')}${opt(d, 'kind', 'update', '업데이트 권장 (권장 버전보다 낮은 앱)', 'info')}${opt(d, 'kind', 'force', '강제 업데이트 창의 글 (잠금은 최소 버전)', 'info')}</select></label>
<label>제목 ko (80자) <input name="title_ko" required maxlength="80" value="${esc(val(d, 'title_ko'))}"></label>
<label>제목 en (80자) <input name="title_en" required maxlength="80" value="${esc(val(d, 'title_en'))}"></label>
<label class="wide">본문 ko (1000자, 글자만) <textarea name="body_ko" required maxlength="1000">${esc(val(d, 'body_ko'))}</textarea></label>
<label class="wide">본문 en (1000자, 글자만) <textarea name="body_en" required maxlength="1000">${esc(val(d, 'body_en'))}</textarea></label>
<details class="wide"${more ? ' open' : ''}><summary>링크, 기간, 대상 (선택, 비우면 모두에게 계속)</summary>
<div class="sub-grid">
<label class="wide">링크 (https://fairy.moilga.com 이나 https://github.com/milcho0604/ 아래만) <input name="link" type="url" maxlength="500" value="${esc(val(d, 'link'))}"></label>
<label>시작 (한국 시간) <input name="from" type="datetime-local" value="${esc(val(d, 'from'))}"></label>
<label>끝 (한국 시간) <input name="until" type="datetime-local" value="${esc(val(d, 'until'))}"></label>
<label>대상 버전 (예: &lt;0.5.0) <input name="versions" maxlength="60" value="${esc(val(d, 'versions'))}"></label>
<label>운영체제 (예: darwin,win32) <input name="platforms" maxlength="40" value="${esc(val(d, 'platforms'))}"></label>
</div></details>
${makeButtons('notices')}</form>`;
}

function eventForm(v: AdminView, d: Draft, dflt: ReturnType<typeof formDefaults>): string {
  const reasonsRaw = d?.reasons;
  const reasons = d ? ([] as string[]).concat(reasonsRaw ?? []) : ['meet', 'focus'];
  return `<form method="post" action="/admin/events/preview" class="grid mk-f mk-events">${formErr(v, 'events', undefined, true)}${hidden(v.csrf)}
<label>id (영문, 숫자, ., _, - 40자) <input name="id" required maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,39}" value="${esc(val(d, 'id', `event-${dflt.day}`))}"></label>
<fieldset class="kindpick"><legend>종류</legend><label><input type="radio" name="kind" value="gift"${val(d, 'kind', 'gift') === 'gift' ? ' checked' : ''}> 선물 (모두에게 코인)</label><label><input type="radio" name="kind" value="boost"${val(d, 'kind', 'gift') === 'boost' ? ' checked' : ''}> 배수 (출석, 집중 코인)</label></fieldset>
<label>제목 ko (60자) <input name="title_ko" required maxlength="60" value="${esc(val(d, 'title_ko'))}"></label>
<label>제목 en (60자) <input name="title_en" required maxlength="60" value="${esc(val(d, 'title_en'))}"></label>
<label class="wide">본문 ko (300자) <textarea name="body_ko" required maxlength="300">${esc(val(d, 'body_ko'))}</textarea></label>
<label class="wide">본문 en (300자) <textarea name="body_en" required maxlength="300">${esc(val(d, 'body_en'))}</textarea></label>
<label>시작 (한국 시간) <input name="from" type="datetime-local" required value="${esc(val(d, 'from', dflt.start))}"></label>
<label>끝 (한국 시간) <input name="until" type="datetime-local" required value="${esc(val(d, 'until', dflt.weekLater))}"></label>
<label class="only-gift">선물 코인 (1~1000) <input name="coins" type="number" min="1" max="1000" value="${esc(val(d, 'coins', '50'))}"></label>
<fieldset class="only-boost"><legend>배수 까닭</legend><label><input type="checkbox" name="reasons" value="meet"${reasons.includes('meet') ? ' checked' : ''}> 출석</label><label><input type="checkbox" name="reasons" value="focus"${reasons.includes('focus') ? ' checked' : ''}> 집중</label></fieldset>
<label class="only-boost">배수 <select name="times">${opt(d, 'times', '2', '2배', '2')}${opt(d, 'times', '3', '3배', '2')}</select></label>
${makeButtons('events')}</form>`;
}

function couponForm(v: AdminView, d: Draft, dflt: ReturnType<typeof formDefaults>): string {
  return `<form method="post" action="/admin/coupons/preview" class="grid mk-f mk-coupons">${formErr(v, 'coupons', undefined, true)}${hidden(v.csrf)}
<label class="wide">메모 (80자, 사용자에게 안 보임) <input name="label" required maxlength="80" value="${esc(val(d, 'label'))}"></label>
<label>코인 (0~1000) <input name="coins" type="number" min="0" max="1000" value="${esc(val(d, 'coins', '50'))}"></label>
<label>채팅 이용권 (0~50장) <input name="tickets" type="number" min="0" max="50" value="${esc(val(d, 'tickets', '0'))}"></label>
<label>전체 사용 상한 <input name="max_uses" type="number" min="1" max="100000" required value="${esc(val(d, 'max_uses', '100'))}"></label>
<label>시작 (비우면 만드는 순간부터) <input name="from" type="datetime-local" value="${esc(val(d, 'from'))}"></label>
<label>끝 (한국 시간) <input name="until" type="datetime-local" required value="${esc(val(d, 'until', dflt.monthLater))}"></label>
<p class="wide hint">코드는 서버가 12자로 만들어요. 서버에는 해시만 남아서 만든 직후 한 번만 볼 수 있어요. 계정마다 한 번, 채팅 이용권은 만 18세 이상 계정에만 가요.</p>
${makeButtons('coupons')}</form>`;
}

function versionForm(v: AdminView, d: Draft): string {
  const n = v.notices;
  const msgOpen = ['msg_kind', 'msg_title_ko', 'msg_body_ko'].some((k) => val(d, k) !== '');
  return `<form method="post" action="/admin/versions/preview" class="grid mk-f mk-versions">${formErr(v, 'versions', undefined, true)}${hidden(v.csrf)}
<p class="wide">최신 릴리스: <strong>${esc(v.latest ?? '읽지 못함')}</strong>. 올리는 값은 이보다 높을 수 없어요. 내리거나 지우기는 언제나 돼요. 순서는 최소 &le; 기능 제한 &le; 권장이에요.</p>
<label>최소 버전 (강제: 이보다 낮으면 앱 잠금) <input name="minVersion" pattern="\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}" value="${esc(val(d, 'minVersion', n?.minVersion ?? ''))}" placeholder="비우면 없음"></label>
<label>기능 제한 버전 (이보다 낮으면 서버 기능 거절) <input name="restrictVersion" pattern="\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}" value="${esc(val(d, 'restrictVersion', n?.restrictVersion ?? ''))}" placeholder="비우면 없음"></label>
<label>권장 버전 (업데이트 권장 알림) <input name="recommendVersion" pattern="\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}" value="${esc(val(d, 'recommendVersion', n?.recommendVersion ?? ''))}" placeholder="비우면 없음"></label>
<details class="wide"${msgOpen ? ' open' : ''}><summary>안내문을 같이 넣기 (선택)</summary>
<div class="sub-grid">
<label>안내문 종류 <select name="msg_kind">${opt(d, 'msg_kind', '', '넣지 않음', '')}${opt(d, 'msg_kind', 'force', '강제 업데이트 안내 (최소 버전보다 낮은 앱)', '')}${opt(d, 'msg_kind', 'update', '업데이트 권장 안내 (권장 버전보다 낮은 앱)', '')}</select></label>
<label>제목 ko (80자) <input name="msg_title_ko" maxlength="80" value="${esc(val(d, 'msg_title_ko'))}"></label>
<label>제목 en (80자) <input name="msg_title_en" maxlength="80" value="${esc(val(d, 'msg_title_en'))}"></label>
<label class="wide">본문 ko (1000자) <textarea name="msg_body_ko" maxlength="1000">${esc(val(d, 'msg_body_ko'))}</textarea></label>
<label class="wide">본문 en (1000자) <textarea name="msg_body_en" maxlength="1000">${esc(val(d, 'msg_body_en'))}</textarea></label>
<label class="wide">링크 (선택) <input name="msg_link" type="url" maxlength="500" value="${esc(val(d, 'msg_link'))}"></label>
</div></details>
${makeButtons('versions')}</form>
${versionTable(v)}`;
}

/** 만들기 칸: 종류를 고르고, 고른 종류에 필요한 입력만 보인다. 미리보기 단계가 있으면 그것을 보인다 */
function newSection(v: AdminView): string {
  const pv =
    v.preview && v.preview.action !== 'grants/batch' && v.preview.action !== 'coins/revoke'
      ? v.preview
      : undefined;
  if (pv) return flowPreviewSection(v, pv);
  const f = v.flash;
  const picked = f?.form && MAKE_KINDS.some(([k]) => k === f.form) ? f.form : 'notices';
  const dflt = formDefaults();
  const d = (k: string) => draftOf(v, k);
  const done =
    f && !f.error && !f.edit && MAKE_KINDS.some(([k]) => k === f.form)
      ? `${flowHead(v, f.form as string, MAKE_LOG[f.form as string] ?? '')}${f.copy ? copyBox(f.copy) : ''}${reachBox(REACH_KIND[f.form as keyof typeof REACH_KIND], Date.now())}`
      : flowSteps(1);
  const note = f?.edit && f.text ? `<p class="flash" role="status" id="form-ok">${esc(f.text)}</p>` : '';
  const radios = MAKE_KINDS.map(
    ([k, label]) =>
      `<input type="radio" name="mk" id="mk-${k}" class="mk-radio"${picked === k ? ' checked' : ''}><label for="mk-${k}" class="mk-tab">${esc(label)}</label>`,
  ).join('');
  const hints = MAKE_KINDS.map(([k, , hint]) => `<span class="mk-hint mk-${k}">${esc(hint)}</span>`).join('');
  return `<section class="mk"><h2>만들기</h2>
${done}${note}
<div class="mk-pick" role="radiogroup" aria-label="무엇을 알릴까요">${radios}</div>
<p class="hint">${hints}</p>
<div class="mk-body mk-notices">${draftBar(v, 'notices')}${noticeForm(v, d('notices'), dflt)}</div>
<div class="mk-body mk-events">${draftBar(v, 'events')}${eventForm(v, d('events'), dflt)}</div>
<div class="mk-body mk-coupons">${draftBar(v, 'coupons')}${couponForm(v, d('coupons'), dflt)}</div>
<div class="mk-body mk-versions">${draftBar(v, 'versions')}${versionForm(v, d('versions'))}</div>
</section>`;
}

/** 쿠폰 원본 코드: 서버에 해시만 있어 이 화면이 마지막이다 */
function copyBox(code: string): string {
  return `<div class="copybox"><p class="flash warn" role="alert">쿠폰 코드는 서버에 해시만 남아서 다시 볼 수 없어요. 지금 복사해서 따로 적어 두세요.</p>
<p><code class="coupon-code" id="coupon-code">${esc(code)}</code> <button type="button" data-copy="${esc(code)}">복사</button></p></div>`;
}

/** 이벤트 모양 미리 보기 (앱 이벤트 카드의 칸: 배지, 제목, 본문) */
function eventPreview(e: SiteEvent, lang: 'ko' | 'en'): string {
  const badge =
    e.kind === 'gift'
      ? lang === 'ko'
        ? `선물 ${e.coins} 코인`
        : `Gift ${e.coins} coins`
      : lang === 'ko'
        ? `${(e.boost?.reasons ?? []).map((r) => (r === 'meet' ? '출석' : '집중')).join(', ')} x${e.boost?.times}`
        : `${(e.boost?.reasons ?? []).map((r) => (r === 'meet' ? 'Check-in' : 'Focus')).join(' + ')} x${e.boost?.times}`;
  const btn = e.kind === 'gift' ? (lang === 'ko' ? '받기' : 'Claim') : '';
  return `<div class="preview event" lang="${lang}"><span class="badge">${esc(badge)}</span><strong>${esc(e.title[lang])}</strong>
<p>${esc(e.body[lang]).replaceAll('\n', '<br>')}</p>${btn ? `<div class="btns"><span class="primary">${esc(btn)}</span></div>` : ''}</div>`;
}

const kstText = (ms: number) => kstIso(ms).slice(0, 16).replace('T', ' ');

/** 확정 폼의 공통: 숨은 칸(작성 값), 번호, 막힌 까닭이 있으면 단추 없음 */
function confirmForm(
  v: AdminView,
  pv: Extract<FlowPreview, { nonce: string }>,
  path: string,
  button: string,
  extra = '',
  blocked: string | null = null,
): string {
  const bad = blocked ? `<p class="flash error wide" role="alert">${esc(blocked)}</p>` : '';
  return `<form method="post" action="${esc(path)}" class="grid">${formErr(v, pv.action)}${hidden(v.csrf)}${flowKey(pv.nonce)}${carry(pv.fields)}${extra}${bad}
${blocked ? '' : `<button type="submit">${esc(button)}</button>`}</form>
${editButton(v.csrf, pv.action)}`;
}

const lvl = (x: string) => (x ? esc(x) : '없음');

function flowPreviewSection(
  v: AdminView,
  pv: Exclude<FlowPreview, { action: 'grants/batch' | 'coins/revoke' }>,
): string {
  if (pv.action === 'notices') return noticeFlowSection(v, pv);
  if (pv.action === 'events') {
    const e = pv.event;
    return `<section class="flow"><h2>이벤트 만들기</h2>
${flowSteps(3)}
<p class="hint">아직 저장하지 않았어요. 앱에 보이는 모양과 받는 사람을 확인하고 확정해 주세요.</p>
<dl class="stats">
<div><dt>id</dt><dd><code>${esc(e.id)}</code></dd></div>
<div><dt>종류</dt><dd>${e.kind === 'gift' ? `선물 ${e.coins} 코인` : `배수 x${e.boost?.times} (${esc((e.boost?.reasons ?? []).map((r) => (r === 'meet' ? '출석' : '집중')).join(', '))})`}</dd></div>
<div><dt>기간 (한국 시간)</dt><dd>${esc(kstText(e.from))} ~ ${esc(kstText(e.until))}</dd></div>
<div><dt>받는 계정</dt><dd>${pv.loginOnly ? '로그인 계정만' : '기기 계정도'}</dd></div>
<div><dt>같은 id</dt><dd>${pv.exists ? '있음, 만들 수 없어요' : '없음 (새로 만들어요)'}</dd></div>
</dl>
<div class="previews">${eventPreview(e, 'ko')}${eventPreview(e, 'en')}</div>
${reachBox('event')}
${confirmForm(v, pv, '/admin/events', '확정하고 이벤트 만들기', '', pv.exists ? '같은 id 의 이벤트가 있어요. 고치기로 돌아가 id 를 바꿔 주세요' : null)}</section>`;
  }
  if (pv.action === 'coupons') {
    const c = pv.coupon;
    const gives = [c.coins ? `코인 ${c.coins}` : '', c.tickets ? `채팅 이용권 ${c.tickets}장` : ''].filter(
      Boolean,
    );
    return `<section class="flow"><h2>쿠폰 만들기</h2>
${flowSteps(3)}
<p class="hint">아직 만들지 않았어요. 코드는 확정하는 순간 한 번만 보여요. 서버에는 해시만 남아요.</p>
<dl class="stats">
<div><dt>메모</dt><dd>${esc(c.label)}</dd></div>
<div><dt>주는 것</dt><dd>${esc(gives.join(', '))}</dd></div>
<div><dt>기간 (한국 시간)</dt><dd>${c.from === null ? '만드는 순간' : esc(kstText(c.from))} ~ ${esc(kstText(c.until))}</dd></div>
<div><dt>전체 사용 상한</dt><dd>${c.maxUses}번 (계정마다 한 번)</dd></div>
<div><dt>받는 계정</dt><dd>${pv.loginOnly ? '로그인 계정만' : '기기 계정도'}</dd></div>
</dl>
<div class="previews">
<div class="preview" lang="ko"><span class="badge">쿠폰 사용</span><strong>쿠폰을 받았어요</strong><p>${esc(gives.join(', '))}을 받아요${c.tickets ? ' (채팅 이용권은 만 18세 이상 계정만)' : ''}.</p></div>
<div class="preview" lang="en"><span class="badge">Coupon</span><strong>Coupon redeemed</strong><p>You get ${esc([c.coins ? `${c.coins} coins` : '', c.tickets ? `${c.tickets} chat pass${c.tickets > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' and '))}.</p></div>
</div>
${reachBox('coupon')}
${confirmForm(v, pv, '/admin/coupons', '확정하고 쿠폰 만들기')}</section>`;
  }
  // versions
  const row = (name: string, a: string, b: string, up: boolean) =>
    `<tr><td>${esc(name)}</td><td>${lvl(a)}</td><td>${lvl(b)}${up ? ' <span class="tag bad">올림</span>' : a !== b ? ' <span class="tag">바뀜</span>' : ''}</td></tr>`;
  const n0 = pv.impactNow;
  const n1 = pv.impactAfter;
  const diff = (a: number, b: number) => `${a}명 &rarr; <strong>${b}명</strong>`;
  const confirmLabel = [
    pv.raises.min ? '최소 버전을 올려요. 낮은 앱이 잠겨요' : '',
    pv.raises.restrict ? '기능 제한 버전을 올려요. 낮은 앱의 서버 기능이 막혀요' : '',
    pv.message?.kind === 'force' ? '강제 업데이트 안내문이 홈페이지에 올라가요' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `<section class="flow"><h2>버전 기준 저장</h2>
${flowSteps(3)}
<p class="hint">아직 저장하지 않았어요. 바뀌는 기준과 영향받는 인원을 확인하고 확정해 주세요.</p>
<table class="plain-table"><thead><tr><th>기준</th><th>지금</th><th>저장하면</th></tr></thead><tbody>
${row('최소 (강제)', pv.before.min, pv.after.min, pv.raises.min)}${row('기능 제한', pv.before.restrict, pv.after.restrict, pv.raises.restrict)}${row('권장', pv.before.rec, pv.after.rec, pv.raises.rec)}
</tbody></table>
<dl class="stats">
<div><dt>앱이 잠기는 계정</dt><dd>${diff(n0.locked, n1.locked)}</dd></div>
<div><dt>서버 기능만 막히는 계정</dt><dd>${diff(n0.restricted, n1.restricted)}</dd></div>
<div><dt>업데이트 권장 알림을 받는 계정</dt><dd>${diff(n0.recommended, n1.recommended)}</dd></div>
<div><dt>최근 30일 활동 계정</dt><dd>${n1.active}명</dd></div>
</dl>
<p class="hint">순서(최소 &le; 기능 제한 &le; 권장)는 맞아요. 최신 릴리스는 ${esc(pv.latest ?? '읽지 못함')} 이에요.${n1.unknown > 0 ? ` 판을 모르는 ${n1.unknown}명은 가장 낮은 판으로 세요.` : ''} 판은 앱이 하루에 한 번 알려 줘서 방금 업데이트한 계정은 이전 판으로 남아 있을 수 있어요.</p>
${pv.message ? `<h3>같이 넣는 안내문 (${esc(KIND_KO[pv.message.kind])}, id ${esc(pv.message.id)}, 대상 ${esc(pv.message.versions ?? '')})</h3>${pv.replaces !== null ? `<p class="flash warn" role="note">같은 id 의 공지를 바꿔요 (지금 제목 ${esc(pv.replaces)})</p>` : ''}${pv.message.kind === 'force' ? '<p class="hint">강제 안내문은 하나만 두어서 버전 저장이 만든 이전 강제 안내문(force-판)은 지워져요. 공지 폼으로 따로 만든 강제 공지는 그대로예요.</p>' : ''}<div class="previews">${noticePreview(pv.message, 'ko')}${noticePreview(pv.message, 'en')}</div>` : '<p class="hint">안내문은 같이 넣지 않아요.</p>'}
${reachBox('version')}
${confirmForm(v, pv, '/admin/versions', '확정하고 버전 기준 저장', pv.needsConfirm ? `<label class="confirm wide"><input type="checkbox" name="confirm" value="yes" required> ${esc(confirmLabel)}</label>` : '', pv.blocked)}</section>`;
}

/** 공지 흐름: 미리보기(공지 창 모양과 바뀌는 것), 확정. 강제 업데이트 글은 확정에서 확인 칸을 체크해야 한다 */
function noticeFlowSection(v: AdminView, pv: Extract<FlowPreview, { action: 'notices' }>): string {
  const n = pv.notice;
  const period = n.from || n.until ? `${n.from ?? '처음부터'} ~ ${n.until ?? '끝없이'}` : '기간 없음';
  return `<section class="flow"><h2>공지 넣기</h2>
${flowSteps(3)}
<p class="hint">아직 저장하지 않았어요. 앱에 뜨는 모양과 대상을 확인하고 확정해 주세요.</p>
<dl class="stats">
<div><dt>id</dt><dd><code>${esc(n.id)}</code></dd></div>
<div><dt>종류</dt><dd>${esc(KIND_KO[n.kind])}</dd></div>
<div><dt>기간 (한국 시간)</dt><dd>${esc(period)}</dd></div>
<div><dt>대상 버전</dt><dd>${esc(n.versions ?? '모든 판')}</dd></div>
<div><dt>운영체제</dt><dd>${esc(n.platforms ? n.platforms.join(', ') : '모두')}</dd></div>
<div><dt>같은 id</dt><dd>${pv.replaces === null ? '없음 (새로 넣어요)' : `있음, 바꿔요 (지금 제목 ${esc(pv.replaces)})`}</dd></div>
</dl>
<div class="previews">${noticePreview(n, 'ko')}${noticePreview(n, 'en')}</div>
${n.link ? `<p class="hint">링크: ${esc(n.link)}</p>` : ''}
${reachBox('notice')}
<form method="post" action="/admin/notices" class="grid">${formErr(v, 'notices')}${hidden(v.csrf)}${flowKey(pv.nonce)}${carry(pv.fields)}
${n.kind === 'force' ? `<label class="confirm"><input type="checkbox" name="confirm" value="yes" required> 강제 업데이트 글이에요. 홈페이지에 올라가요</label>` : ''}
<button type="submit">확정하고 공지 저장</button></form>
${editButton(v.csrf, 'notices')}</section>`;
}

function renderPanels(v: AdminView): Record<AdminCell, string> {
  const ai = aiSections(v);
  const sub = (cell: AdminCell, rows: Record<string, string>) =>
    `<nav class="subnav" aria-label="${esc(CELL_LABEL[cell])} 안">${CELL_SUBS[cell]
      .map(([id, label]) => `<a href="#${cell}/${id}" data-sub="${cell}/${id}">${esc(label)}</a>`)
      .join('')}</nav>
${CELL_SUBS[cell].map(([id]) => `<div class="sub" id="sub-${cell}-${id}" data-sub="${cell}/${id}">${rows[id] ?? ''}</div>`).join('\n')}`;
  return {
    home: homeSection(v),
    users: sub('users', { list: usersTable(v), grants: grantsSection(v) }),
    reports: reportsSection(v),
    announce: sub('announce', { posts: postsSection(v), new: newSection(v) }),
    settings: sub('settings', {
      features: ai.features,
      ai: ai.tickets,
      backup: backupSection(v),
      log: logSection(v),
    }),
  };
}

export function mainPage(v: AdminView): string {
  const panels = renderPanels(v);
  // 결과 글을 단 폼이 화면에 없으면(예: 끝낸 이벤트의 단추) 그 일을 한 칸 맨 위에 대신 보인다
  const f = v.flash;
  const marker = f?.error ? 'id="form-error"' : 'id="form-ok"';
  const head = (v.flashPlace ?? '').split('/')[0] ?? '';
  const lostIn: AdminCell = (ADMIN_CELLS as readonly string[]).includes(head) ? (head as AdminCell) : 'home';
  const lost =
    f && !f.edit && !Object.values(panels).some((x) => x.includes(marker))
      ? `<p class="flash${f.error ? ' error' : ''}" role="${f.error ? 'alert' : 'status'}" ${marker}>${esc(f.text)}</p>`
      : '';
  const nav = `<nav class="cells" aria-label="운영자 칸">${ADMIN_CELLS.map((c) => `<a href="#${c}" data-cell="${c}">${esc(CELL_LABEL[c])}</a>`).join('')}</nav>`;
  const cells = ADMIN_CELLS.map(
    (c) =>
      `<div class="panel" id="cell-${c}" data-cell="${c}" role="region" aria-label="${esc(CELL_LABEL[c])}">${c === lostIn ? lost : ''}${panels[c]}</div>`,
  ).join('\n');
  return doc(
    '페어리 운영자',
    `<div class="shell">${nav}
<main><header><h1>페어리 운영자</h1>
<form method="post" action="/admin/logout" class="inline">${hidden(v.csrf)}<button type="submit">로그아웃</button></form></header>
${cells}</main></div>`,
    { script: true, flash: f ? (f.error ? 'error' : 'ok') : v.preview ? 'ok' : '' },
  );
}

const ACTION_KO: Record<string, string> = {
  'draft.save': '알리기 초안 저장',
  'draft.delete': '알리기 초안 지우기',
  'event.create': '이벤트 만들기',
  'event.end': '이벤트 끝내기',
  'event.delete': '이벤트 지우기',
  'coupon.create': '쿠폰 만들기',
  'coupon.disable': '쿠폰 끄기',
  'note.send': '쪽지 보내기',
  'grant.batch': '지급 묶음',
  'notice.create': '공지 넣기',
  'notice.update': '공지 바꾸기',
  'notice.delete': '공지 지우기',
  versions: '업데이트 기준 저장',
  'ai.mode': '채팅 이용권 접근 설정',
  'ai.limits': '예산 저장',
  'ai.policy': '정책 저장',
  'ai.revoke': '채팅 이용권 회수',
  'coins.revoke': '코인 회수',
  'note.withdraw': '쪽지 철회',
  'ai.subscribe': '정기 지급 걸기',
  'ai.cancel': '정기 지급 해지',
  'ai.block': '채팅 이용권 막기',
  'ai.unblock': '채팅 이용권 막기 풀기',
  'ai.allow': '채팅 이용권 허용',
  'ai.disallow': '채팅 이용권 허용 빼기',
  'feature.mode': '기능 접근 설정',
  'feature.allow': '기능 허용',
  'feature.disallow': '기능 허용 빼기',
  'rewards.policy': '선물과 쿠폰 받는 계정',
  'report.view': '신고 대화 열어 봄',
  'report.seen': '신고 확인',
  'report.done': '신고 조치',
  'report.reopen': '신고 미처리로 되돌림',
  login: '로그인',
  logout: '로그아웃',
  'login.fail': '로그인 실패',
  'login.flood': '로그인 실패 많음 (15분 요약)',
  'csrf.fail': '요청 확인 실패',
};
/** 기록의 동작 이름을 운영자 말로 (모르면 코드 그대로) */
export const actionKo = (a: string): string => ACTION_KO[a] ?? a;

/**
 * 운영 기록 "자세히" 를 동작마다 한 줄 문장으로 (영어 키와 날 JSON 대신). 모르는 동작이나 빠진 값은 null 이라 원본만 보인다.
 * 값은 기록에 남은 그대로 읽고, 없는 값은 말하지 않는다
 */
export function logDetailKo(action: string, detail: unknown): string | null {
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  const num = (k: string): number | undefined => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
  const str = (k: string): string | undefined => (typeof d[k] === 'string' ? (d[k] as string) : undefined);
  const gift = (coins: number | undefined, passes: number | undefined) =>
    [coins ? `코인 ${coins}` : '', passes ? `채팅 이용권 ${passes}장` : ''].filter(Boolean).join(', ') ||
    '받을 것 없음';
  const quote = (t: string | undefined) => (t ? `, 사유 "${t.slice(0, 80)}"` : '');
  const revert = d.revert === true ? ' (이전 값으로 되돌림)' : '';
  switch (action) {
    case 'note.send': {
      const n = num('note');
      if (n === undefined) return null;
      const days = num('days');
      return `쪽지 #${n}${d.batch === true ? ' (묶음 지급의 한 건)' : ''}: ${gift(num('coins'), num('chatPasses'))}${days ? `, 만료 ${days}일` : ''}${quote(str('message'))}`;
    }
    case 'grant.batch': {
      const people = num('recipients');
      if (people === undefined) return null;
      return `${people}명에게 지급: ${gift(num('coins'), num('chatPasses'))}, 만료 ${num('days') ?? '?'}일`;
    }
    case 'note.withdraw': {
      const n = num('note');
      return n === undefined ? null : `쪽지 #${n} 철회 (${gift(num('coins'), num('chatPasses'))})`;
    }
    case 'coins.revoke': {
      const coins = num('coins');
      if (coins === undefined) return null;
      const b = num('before');
      const a = num('after');
      return `코인 ${coins} 회수${b !== undefined && a !== undefined ? ` (잔액 ${b}에서 ${a}로)` : ''}${quote(str('reason'))}`;
    }
    case 'ai.revoke': {
      const n = num('count');
      return n === undefined
        ? null
        : `채팅 이용권 ${n}장 회수${num('remaining') !== undefined ? ` (남은 ${num('remaining')}장)` : ''}`;
    }
    case 'ai.subscribe': {
      const m = num('monthly');
      if (m === undefined) return null;
      return `매달 ${m}장 ${str('mode') === 'add' ? '더하기' : '까지 채우기'}, ${str('startsOn') ?? '오늘'}부터 ${str('endsOn') ?? '무기한'}`;
    }
    case 'ai.cancel':
      return '정기 지급 해지';
    case 'ai.mode': {
      const b = str('before');
      const a = str('after');
      return b && a ? `${switchChangeText('ai_chat', b, a)}${revert}` : null;
    }
    case 'feature.mode': {
      const k = str('key');
      const b = str('before');
      const a = str('after');
      return k && b && a ? `${switchChangeText(k, b, a)}${revert}` : null;
    }
    case 'feature.allow':
    case 'feature.disallow': {
      const k = str('key');
      return k ? `${SWITCH_SHORT[k] ?? k} 허용 목록에서 ${action === 'feature.allow' ? '넣음' : '뺌'}` : null;
    }
    case 'rewards.policy': {
      if (typeof d.before !== 'boolean' || typeof d.after !== 'boolean') return null;
      const t = (x: boolean) => (x ? '로그인 계정만' : '기기 계정도');
      return `선물과 쿠폰 받는 계정을 ${t(d.before)}에서 ${t(d.after)}${euroRo(t(d.after))} 바꿈`;
    }
    case 'report.view':
      return num('report') === undefined ? null : `신고 #${num('report')} 대화를 열어 봄`;
    case 'report.seen':
    case 'report.done':
    case 'report.reopen': {
      const r = num('report');
      const f = str('from');
      const t = str('to');
      if (r === undefined || !f || !t) return null;
      const ko = (x: string) => REPORT_STATE_KO[x as ReportState] ?? x;
      return `신고 #${r} ${ko(f)}에서 ${ko(t)}로${d.withBlock === true ? ' (채팅 이용권 막기와 함께)' : ''}`;
    }
    case 'event.create': {
      const coins = num('coins');
      const boost = num('boost');
      const kind = str('kind') === 'boost' ? '배수' : '선물';
      return `${kind} 이벤트${coins ? `, 코인 ${coins}` : ''}${boost ? `, 배수 ${boost}` : ''}, ${str('from') ?? '?'} ~ ${str('until') ?? '?'}`;
    }
    case 'coupon.create': {
      const label = str('label');
      if (label === undefined) return null;
      return `쿠폰 "${label}": ${gift(num('coins'), num('tickets'))}, 최대 ${num('maxUses') ?? '?'}번`;
    }
    case 'notice.create':
    case 'notice.update': {
      const t = str('title');
      return t ? `${action === 'notice.create' ? '새' : '고친'} 공지 "${t}"` : null;
    }
    default:
      return null;
  }
}

/** 운영 기록 칸: 문장이 있으면 문장 + 접힌 원본, 없으면 원본만 */
export function logDetailCell(action: string, detail: unknown): string {
  const raw = detail ? JSON.stringify(detail) : '';
  const text = logDetailKo(action, detail);
  if (text === null) return `<code>${esc(raw)}</code>`;
  return `${esc(text)}<details class="raw"><summary>원본</summary><code>${esc(raw)}</code></details>`;
}

/** 운영 기록: 누가(이름), 대상 이용자, 동작 종류, 글 검색 */
function logSection(v: AdminView): string {
  const p = v.logPage;
  const q = (page: number) => {
    const x = new URLSearchParams();
    if (p.user) x.set('lu', p.user);
    if (p.action) x.set('la', p.action);
    if (p.text) x.set('lt', p.text);
    x.set('lp', String(page));
    return placeHref('settings/log', `?${x}`);
  };
  const rows = v.log
    .map(
      (l) => `<tr><td data-l="때">${when(l.at)}</td>
<td data-l="누가">${l.actorName ? `${esc(l.actorName)}<br><small><code>${esc(l.actor)}</code></small>` : `<code>${esc(l.actor)}</code>`}</td>
<td data-l="무엇">${esc(actionKo(l.action))}${(l.detail as { revert?: unknown } | null)?.revert === true ? ' (되돌림)' : ''}<br><small><code>${esc(l.action)}</code></small></td>
<td data-l="대상">${l.targetName ? `${esc(l.targetName)}<br><small><code>${esc(l.target ?? '')}</code></small>` : esc(l.target ?? '')}</td>
<td data-l="자세히">${logDetailCell(l.action, l.detail)}</td></tr>`,
    )
    .join('');
  const filtered = !!(p.user || p.action || p.text);
  return `<section><h2>운영 기록 ${p.total}건</h2>
<form method="get" action="/admin#settings/log" class="row">
<label>대상 이용자 (번호, 기기 코드, 닉네임) <input name="lu" maxlength="40" value="${esc(p.user)}"></label>
<label>동작 종류 <select name="la"><option value="">전체</option>${(p.action && !p.actions.includes(p.action) ? [...p.actions, p.action] : p.actions).map((a) => `<option value="${esc(a)}"${a === p.action ? ' selected' : ''}>${esc(actionKo(a))}${actionKo(a) === a ? '' : ` (${esc(a)})`}</option>`).join('')}</select></label>
<label>글 검색 (이름, 대상, 자세히) <input name="lt" maxlength="60" value="${esc(p.text)}"></label>
<button type="submit">찾기</button>${filtered ? `<a class="button-link" href="${placeHref('settings/log')}">모두 보기</a>` : ''}
</form>
<p class="hint">한 쪽에 50건씩 보여요. 옛 기록은 이름 없이 세션 표시만 있어요.</p>
${p.userMissing ? '<p class="flash error">그 이용자를 찾지 못했어요</p>' : ''}
<div class="table-scroll"><table class="log cards"><thead><tr><th>때</th><th>누가</th><th>무엇</th><th>대상</th><th>자세히</th></tr></thead><tbody>
${rows || `<tr><td colspan="5">${filtered ? '조건에 맞는 기록이 없어요' : '아직 없어요'}</td></tr>`}
</tbody></table></div>
<nav class="pager" aria-label="쪽 넘기기">${p.page > 1 ? `<a href="${esc(q(p.page - 1))}">이전</a>` : '<span>이전</span>'}<strong>${p.page} / ${p.pages}</strong>${p.page < p.pages ? `<a href="${esc(q(p.page + 1))}">다음</a>` : '<span>다음</span>'}</nav>
</section>`;
}

/** 앱 판 분포 표 (최근 30일 활동 계정) */
function versionTable(v: AdminView): string {
  const x = v.versions;
  if (x.active === 0) return `<h3>앱 판 분포</h3><p class="hint">최근 30일 활동한 계정이 없어요.</p>`;
  const rows = x.rows.map((r) => `<tr><td>${esc(r.version)}</td><td>${r.count}</td></tr>`).join('');
  const l = x.locked;
  const lock =
    l.min || l.restrict
      ? `<p class="${l.locked > 0 ? 'warn-text' : 'hint'}">지금 기준으로 ${l.min ? `최소 ${esc(l.min)} 보다 낮아 앱이 잠기는 계정 <strong>${l.locked}명</strong>` : '강제 기준 없음'}${l.restrict ? `, 기능 제한 ${esc(l.restrict)} 보다만 낮아 서버 기능이 거절되는 계정 <strong>${l.restricted}명</strong>` : ''}${l.unknown > 0 ? ` (판을 모르는 ${l.unknown}명 포함, 판 표시가 없으면 가장 낮은 판으로 봐요)` : ''}. 판은 앱이 하루에 한 번 알려 줘서, 방금 업데이트한 계정은 최대 하루 동안 이전 판으로 남아 있어요. <a href="/admin?load=version#announce/new">버전 기준 고치기</a></p>`
      : `<p class="hint">최소 버전과 기능 제한 버전이 없어서 잠기는 계정이 없어요. <a href="/admin?load=version#announce/new">버전 기준 고치기</a></p>`;
  return `<h3>앱 판 분포 (최근 30일 활동 ${x.active}명)</h3>${lock}
<table><tr><th>앱 판</th><th>계정</th></tr>${rows}<tr><td>판 없음 (옛 앱)</td><td>${x.unknown}</td></tr></table>`;
}

/** 현재 칸과 하위만 보이게 하는 규칙. admin.js 가 html 에 data-cell, data-sub 를 달아야 켜진다 (스크립트가 없으면 모두 보인다) */
function viewCss(): string {
  const rules = ['html[data-cell] .panel, html[data-cell] .sub { display: none; }'];
  for (const c of ADMIN_CELLS) {
    rules.push(`html[data-cell="${c}"] #cell-${c} { display: block; }`);
    for (const [id] of CELL_SUBS[c])
      rules.push(`html[data-sub="${c}/${id}"] #sub-${c}-${id} { display: block; }`);
  }
  return `${rules.join('\n')}\n`;
}

/** 칸 이동 (주소 해시). 머리에서 바로 돌아 첫 그림부터 맞는 칸이 보인다. 해시가 없으면 주소의 찾기 조건으로 정한다 */
function routerJs(): string {
  const subs = JSON.stringify(
    Object.fromEntries(ADMIN_CELLS.map((c) => [c, CELL_SUBS[c].map(([id]) => id)])),
  );
  return `  const SUBS = ${subs};
  const root = document.documentElement;
  const route = () => {
    let h = '';
    try { h = decodeURIComponent(location.hash.slice(1)); } catch { h = ''; }
    const parts = h.split('/');
    let c = parts[0];
    let s = parts[1];
    if (!Object.prototype.hasOwnProperty.call(SUBS, c)) {
      const q = new URLSearchParams(location.search);
      s = undefined;
      if (['lu', 'la', 'lt', 'lp'].some((k) => q.has(k))) { c = 'settings'; s = 'log'; }
      else if (q.has('load')) { c = 'announce'; s = 'new'; }
      else if (['pk', 'ps', 'pq'].some((k) => q.has(k))) { c = 'announce'; s = 'posts'; }
      else if (q.has('account') || q.has('pick')) { c = 'users'; s = 'grants'; }
      else if (['q', 'page', 'sort', 'direction', 'user'].some((k) => q.has(k))) { c = 'users'; s = 'list'; }
      else c = 'home';
    }
    let place = c;
    if (SUBS[c].length) {
      if (SUBS[c].indexOf(s) < 0) s = SUBS[c][0];
      place = c + '/' + s;
    }
    root.dataset.cell = c;
    root.dataset.sub = place;
    return place;
  };
  const mark = () => {
    for (const a of document.querySelectorAll('nav.cells a')) {
      if (a.dataset.cell === root.dataset.cell) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const a of document.querySelectorAll('.subnav a')) {
      if (a.dataset.sub === root.dataset.sub) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
  route();
  window.addEventListener('hashchange', () => { route(); mark(); window.scrollTo(0, 0); });
  document.addEventListener('DOMContentLoaded', () => {
    mark();
    // 방금 쓴 결과(오류, 성공)는 그 폼 자리로 화면을 가져온다
    const note = document.getElementById('form-error') || document.getElementById('form-ok');
    if (note && note.getClientRects().length > 0) note.scrollIntoView({ block: 'center' });
  });`;
}

export const adminCss = `${viewCss()}:root { color-scheme: light dark; --bg: #faf8f5; --fg: #2b2622; --muted: #6f655c; --line: #e2dbd2; --card: #fff;
  --accent: #b5532f; --on-accent: #fff; --ok: #2f7a4a; --bad: #b3261e; --warn: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --bg: #1d1a17; --fg: #eee6dd; --muted: #a99e92; --line: #3a342e; --card: #26221e; --accent: #e58c63; --on-accent: #1d1a17; --ok: #6cc28a; --bad: #f2867c; --warn: #e0a84a; } }
* { box-sizing: border-box; }
a { color: var(--accent); }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 16px; }
main.narrow { max-width: 420px; padding-top: 12vh; }
.shell { max-width: 1480px; margin: 0 auto; display: grid; grid-template-columns: 168px minmax(0, 1fr); align-items: start; }
.shell > main { max-width: none; width: 100%; min-width: 0; margin: 0; }
nav.cells { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 6px; padding: 16px 0 16px 16px; }
nav.cells a { color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; text-decoration: none; background: var(--card); font-weight: 600; }
nav.cells a[aria-current=page] { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
.subnav { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
.subnav a { color: var(--fg); border: 1px solid var(--line); border-radius: 7px; padding: 7px 10px; text-decoration: none; background: var(--card); }
.subnav a[aria-current=page] { color: var(--accent); border-color: var(--accent); font-weight: 700; }
.panel { min-width: 0; }
.empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; padding: 14px; text-align: center; margin: 8px 0; }
ul.todo { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
ul.todo li { border: 1px solid var(--line); border-left-width: 4px; border-radius: 8px; padding: 10px 12px; background: var(--bg); }
ul.todo li.warn { border-left-color: #b7791f; }
ul.todo li.bad { border-left-color: var(--bad); }
ul.todo a { color: var(--fg); text-decoration: none; display: block; }
ol.steps { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0 0 10px; font-size: 13px; }
ol.steps li { border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; color: var(--muted); }
ol.steps li.done { color: var(--ok); border-color: var(--ok); }
ol.steps li.now { color: var(--on-accent); background: var(--accent); border-color: var(--accent); font-weight: 700; }
.flow-result { margin: 0 0 8px; }
.flow-result .flash { margin: 6px 0; }
tr.bad td { color: var(--bad); }
button.ghost { background: transparent; color: var(--fg); border-color: var(--line); }
small.working { margin-left: 8px; color: var(--muted); }
form.grid small.working { grid-column: 1 / -1; }
.flash.wide { grid-column: 1 / -1; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 22px; margin: 8px 0 16px; }
h2 { font-size: 17px; margin: 0 0 8px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin: 0 0 16px; overflow-x: auto; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
.tabs a, .button-link { color: var(--fg); border: 1px solid var(--line); border-radius: 7px; padding: 7px 10px; text-decoration: none; background: var(--card); }
.tabs a.current { color: var(--on-accent); background: var(--accent); border-color: var(--accent); font-weight: 700; }
.table-scroll { width: 100%; overflow-x: auto; }
.table-scroll table { min-width: 980px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 14px; }
.pager a, .pager span { min-width: 54px; text-align: center; }
.selected { border: 1px solid var(--ok); border-radius: 8px; padding: 10px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
input, select, textarea { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
textarea { min-height: 64px; resize: vertical; }
button { font: inherit; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
button.danger { background: transparent; color: var(--bad); border-color: var(--bad); }
form.inline { display: inline; }
form.sure { display: inline-flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 2px 0; }
form.sure .flash { flex: 1 0 100%; margin: 0; }
form.sure label.confirm { color: var(--bad); }
button:disabled { background: var(--line); color: var(--fg); border-color: var(--line); cursor: progress; }
form.busy button[type=submit]::after { content: ""; display: inline-block; width: 0.8em; height: 0.8em; margin-left: 0.5em; vertical-align: -0.1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { form.busy button[type=submit]::after { animation: none; border-right-color: currentColor; } }
form .flash.error { margin: 0 0 4px; }
.flash.warn { margin: 8px 0; }
:target { scroll-margin-top: 12px; }
form.row { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; margin-bottom: 12px; }
form.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; align-items: end; margin-top: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
form.grid .wide { grid-column: 1 / -1; }
fieldset { border: 1px solid var(--line); border-radius: 6px; display: flex; gap: 12px; }
fieldset label, label.confirm { flex-direction: row; align-items: center; gap: 6px; }
ul.plain { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
h3 { font-size: 15px; margin: 12px 0 6px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 6px; vertical-align: top; }
tr.off td { color: var(--muted); }
code { font-size: 12px; word-break: break-all; }
.hint { color: var(--muted); font-size: 13px; }
.flash { border: 1px solid var(--ok); color: var(--ok); border-radius: 8px; padding: 10px 12px; font-weight: 600; }
.flash.error { border-color: var(--bad); color: var(--bad); }
.flash.warn { border-color: #b7791f; color: #b7791f; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 0; }
.stats div { border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.stats dt { font-size: 12px; color: var(--muted); }
.stats dd { margin: 0; font-size: 17px; font-weight: 600; }
.trend { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.trend-card { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: var(--bg); }
.trend-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.trend-label { font-size: 13px; color: var(--muted); }
.trend-today { font-size: 20px; }
.trend-svg { width: 100%; height: 64px; display: block; margin: 6px 0 2px; }
.trend-svg .bar { fill: var(--muted); }
.trend-svg .bar.today { fill: var(--accent); }
.trend-svg .bar.zero { fill: var(--line); }
.warn-text { color: var(--warn); }
details > summary { cursor: pointer; margin: 8px 0; color: var(--muted); }
.tag { white-space: nowrap; font-size: 11px; border-radius: 4px; padding: 1px 6px; border: 1px solid var(--line); }
.tag.live { border-color: var(--ok); color: var(--ok); }
.tag.ended { color: var(--muted); }
.tag.bad { border-color: var(--bad); color: var(--bad); }
.tag.soon { border-color: var(--warn); color: var(--warn); }
.button-link.current { color: var(--on-accent); background: var(--accent); border-color: var(--accent); font-weight: 700; }
pre.convo { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 4px 0 8px; font: inherit; max-height: 50vh; overflow: auto; }
.report-open { border: 1px solid var(--accent); border-radius: 10px; padding: 12px; margin: 8px 0 14px; }
.notice { border-top: 1px solid var(--line); padding: 12px 0; }
.previews { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 8px; }
.preview { width: 100%; max-width: 360px; border: 1px solid var(--line); border-radius: 14px; padding: 14px; background: var(--bg); display: flex; flex-direction: column; gap: 6px; }
.preview .badge { align-self: flex-start; font-size: 11px; border-radius: 999px; padding: 1px 8px; background: var(--line); }
.preview.force .badge, .preview.important .badge { background: var(--bad); color: var(--on-accent); }
.preview p { margin: 0; color: var(--muted); font-size: 13px; }
.preview .btns { display: flex; gap: 6px; justify-content: flex-end; }
.preview .btns span { border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; font-size: 13px; }
.preview .btns span.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
td.pick { width: 1%; }
td.pick input { width: 18px; height: 18px; }
.grant-one .target { margin: 0; padding: 8px 10px; border: 1px solid var(--ok); border-radius: 8px; overflow-wrap: anywhere; }
.detail h3 { margin-top: 18px; }
table.users td.name { font-weight: 600; }
td.act { white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.posts-find { margin-bottom: 4px; }
table.posts td.name { font-weight: 600; overflow-wrap: anywhere; }
table.posts td.name small { font-weight: 400; color: var(--muted); }
.sub-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; align-items: end; margin-top: 8px; }
.sub-grid .wide { grid-column: 1 / -1; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.draft-bar { align-items: center; border: 1px dashed var(--line); border-radius: 8px; padding: 8px 10px; }
.mk-pick { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.mk-radio { position: absolute; opacity: 0; width: 1px; height: 1px; }
.mk-tab { flex-direction: row; border: 1px solid var(--line); border-radius: 7px; padding: 8px 14px; background: var(--card); color: var(--fg); font-size: 15px; font-weight: 600; cursor: pointer; }
.mk-radio:checked + .mk-tab { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
.mk-radio:focus-visible + .mk-tab { outline: 2px solid var(--accent); outline-offset: 2px; }
.kindpick { margin: 0; }
.reach { border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 8px 12px; margin: 12px 0; background: var(--bg); }
.reach h3 { margin: 0 0 4px; }
.reach ol { margin: 0; padding-left: 20px; font-size: 13px; }
.copybox { margin: 8px 0; }
.coupon-code { font-size: 20px; font-weight: 700; letter-spacing: 0.04em; border: 1px solid var(--accent); border-radius: 8px; padding: 6px 10px; user-select: all; }
.preview.event .badge { background: var(--accent); color: var(--on-accent); }
table.plain-table { max-width: 560px; margin-bottom: 12px; }
table.switches td.name { font-weight: 600; }
table.switches td.act { white-space: normal; }
.tag.nowrap { white-space: nowrap; }
table.switches details { margin: 4px 0 0; }
table.switches details summary { margin: 0; font-size: 12px; }
table.switches small.prev { color: var(--muted); }
form.sw-form { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin: 0 0 8px; }
form.sw-form .flash { margin: 0; }
details.allow { border: 1px solid var(--line); border-radius: 8px; padding: 2px 10px; margin: 0 0 8px; }
.jump { padding: 6px 0; margin: 0 0 8px; border-bottom: 1px solid var(--line); }
details.danger-fold { border: 1px solid var(--bad); border-radius: 8px; padding: 2px 10px; margin: 18px 0 8px; }
details.danger-fold > summary { color: var(--bad); font-weight: 600; }
details.raw { margin: 2px 0 0; }
details.raw summary { margin: 0; font-size: 12px; }
details.sort-fold { flex: 1 0 100%; margin: 0; }
details.sort-fold > summary { margin: 4px 0; font-size: 13px; }
@supports selector(:has(a)) {
  .mk-body, .mk-hint { display: none; }
  .mk:has(#mk-notices:checked) .mk-notices, .mk:has(#mk-events:checked) .mk-events,
  .mk:has(#mk-coupons:checked) .mk-coupons, .mk:has(#mk-versions:checked) .mk-versions { display: block; }
  .mk-events:has(input[name=kind][value=gift]:checked) .only-boost,
  .mk-events:has(input[name=kind][value=boost]:checked) .only-gift { display: none; }
}
@media (max-width: 600px) {
  main { padding: 10px; }
  .table-scroll table.cards { min-width: 0; }
  table.users tr { border: 1px solid var(--line); border-radius: 8px; margin: 0 0 10px; padding: 8px 6px; }
  table.cards td.opt { display: none; }
  table.users tr { position: relative; }
  table.cards td.pick { display: block; width: auto; position: absolute; top: 10px; right: 10px; }
  table.users td.name { padding-right: 40px; }
  table.users td.name { font-size: 16px; overflow-wrap: anywhere; }
  table.cards td.act { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 8px; }
  table.cards td.act .button-link { flex: 1 1 45%; text-align: center; min-height: 42px; display: flex; align-items: center; justify-content: center; overflow-wrap: anywhere; }
  table.cards td { overflow-wrap: anywhere; }
  table.switches tr { border: 1px solid var(--line); border-radius: 8px; margin: 0 0 10px; padding: 8px 6px; }
  table.switches td.name { font-size: 16px; }
  table.switches td.act { display: block; }
  table.switches td, table.switches form.sw-form, table.switches form.sw-form label { min-width: 0; max-width: 100%; }
  table.switches { table-layout: fixed; }
  form.sw-form { align-items: stretch; }
  form.sw-form label.confirm { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; overflow-wrap: anywhere; }
  form.sw-form button, form.sw-form select { width: 100%; }
  section { padding: 12px; }
  .tabs a { flex: 1 1 42%; text-align: center; }
  html { scroll-padding-bottom: 72px; }
  main { padding-bottom: calc(80px + env(safe-area-inset-bottom)); }
  .shell { display: block; padding-bottom: 72px; }
  nav.cells { position: fixed; z-index: 10; inset: auto 0 0 0; flex-direction: row; gap: 4px; padding: 6px 8px calc(6px + env(safe-area-inset-bottom)); background: var(--card); border-top: 1px solid var(--line); }
  nav.cells a { flex: 1 1 0; text-align: center; padding: 10px 2px; font-size: 14px; }
  .subnav a { flex: 1 1 auto; text-align: center; }
  table.targets thead { display: none; }
  table.targets tr { display: block; border-bottom: 1px solid var(--line); padding: 6px 0; }
  table.targets td { display: block; border: 0; padding: 2px 6px; }
  table.targets td:first-child { color: var(--muted); }
  table.cards thead { display: none; }
  table.cards tr { display: block; border-bottom: 1px solid var(--line); padding: 6px 0; }
  table.cards td { display: block; border: 0; padding: 2px 6px; }
  table.cards td[data-l]::before { content: attr(data-l) " "; color: var(--muted); font-size: 12px; }
  table.cards td:empty { display: none; }
  input, select, textarea, button { min-height: 42px; }
}
@media (pointer: coarse) {
  nav.cells a, .subnav a, .tabs a, .button-link, .pager a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  nav.cells a { display: flex; }
  td a:not(.button-link), dl.stats dd a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  ul.todo a { display: flex; align-items: center; min-height: 44px; }
  details > summary { box-sizing: border-box; min-height: 44px; padding-block: 10px; margin: 0; }
  input:not([type=checkbox]):not([type=radio]), select, textarea, button { min-height: 44px; }
  label.confirm, fieldset label { min-height: 44px; min-width: 44px; }
  input[type=checkbox], input[type=radio] { width: 22px; height: 22px; }
  td.pick input { width: 44px; height: 44px; margin: 0; }
}
@media (pointer: coarse) and (max-width: 600px) {
  nav.cells a, .subnav a, .tabs a, .button-link { justify-content: center; }
  table.cards td.act .button-link { min-height: 44px; }
  table.users td.name { padding-right: 56px; }
  table.cards td.pick { top: 0; right: 4px; }
}
`;

/**
 * 운영자 화면의 바깥 스크립트 (인라인 스크립트 없음, CSP script-src 'self').
 * 1) 제출하면 그 폼의 단추를 막고 진행 표시를 켠다 (두 번 눌러 두 번 쓰지 않게). 뒤로 오면 풀린다.
 * 2) 제출한 값을 탭 안(sessionStorage)에 잠깐 둔다. 서버가 결과 글(성공, 오류)을 돌려준 화면이면 지우고,
 *    네트워크가 끊겨 결과 없이 돌아온 화면이면 같은 폼에 쓰던 값을 되살리고 안내한다.
 */
export const adminJs = `(() => {
${routerJs()}
  const KEY = 'fairy-admin-pending';
  const MAX_AGE = 10 * 60 * 1000;
  const store = (fn) => { try { return fn(window.sessionStorage); } catch { return undefined; } };
  const skip = new Set(['csrf', 'confirm']);
  const hiddenSig = (form) => [...form.querySelectorAll('input[type=hidden]')].filter((i) => i.name !== 'csrf').map((i) => i.name + '=' + i.value).join('&');

  const release = () => {
    for (const w of document.querySelectorAll('small.working')) w.remove();
    for (const form of document.querySelectorAll('form.busy')) {
      form.classList.remove('busy');
      form.removeAttribute('aria-busy');
      for (const b of form.querySelectorAll('button[type=submit]')) {
        b.disabled = false;
        if (b.dataset.label) b.textContent = b.dataset.label;
      }
    }
  };

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || (form.method || '').toLowerCase() !== 'post') return;
    if (form.classList.contains('busy')) { e.preventDefault(); return; }
    const fields = [];
    for (const [k, v] of new FormData(form)) if (typeof v === 'string' && !skip.has(k)) fields.push([k, v]);
    store((s) => s.setItem(KEY, JSON.stringify({ action: form.getAttribute('action'), sig: hiddenSig(form), fields, at: Date.now() })));
    form.classList.add('busy');
    form.setAttribute('aria-busy', 'true');
    // 누른 단추 바로 옆에 진행 글 (맨 위가 아니라 눌린 자리에서 보이게)
    const last = form.querySelector('button[type=submit]:last-of-type');
    if (last && !form.querySelector('.working')) {
      const w = document.createElement('small');
      w.className = 'working';
      w.setAttribute('role', 'status');
      w.textContent = '처리하고 있어요';
      last.after(w);
    }
    for (const b of form.querySelectorAll('button[type=submit]')) {
      b.dataset.label = b.textContent;
      b.textContent = '처리 중';
      // 이 제출 이벤트가 끝난 뒤에 막는다 (막힌 단추는 제출을 취소하지 않지만 안전하게)
      setTimeout(() => { b.disabled = true; }, 0);
    }
  });

  const restore = () => {
    const raw = store((s) => s.getItem(KEY));
    if (!raw) return;
    store((s) => s.removeItem(KEY));
    // 서버가 결과 글을 보여 준 화면이면 끝난 것이다 (오류면 서버가 쓴 값을 채워 두었다)
    if (document.body.dataset.flash) return;
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!p || p.fields.length === 0 || Date.now() - p.at > MAX_AGE) return;
    const form = [...document.querySelectorAll('form')].find((f) => f.getAttribute('action') === p.action && hiddenSig(f) === p.sig);
    if (!form) return;
    const seen = new Set();
    for (const [k, v] of p.fields) {
      const els = [...form.elements].filter((el) => el.name === k && el.type !== 'hidden');
      if (els.length === 0) continue;
      const first = els[0];
      if (first.type === 'checkbox') {
        if (!seen.has(k)) for (const el of els) el.checked = false;
        for (const el of els) if (el.value === v) el.checked = true;
      } else first.value = v;
      seen.add(k);
    }
    const note = document.createElement('p');
    note.className = 'flash warn';
    note.setAttribute('role', 'status');
    note.textContent = '방금 보낸 내용이 서버에 닿았는지 확인하지 못했어요. 쓰던 글을 되살렸어요. 운영 기록에서 먼저 확인한 뒤 다시 보내 주세요.';
    form.before(note);
    note.scrollIntoView({ block: 'center' });
  };

  document.addEventListener('click', (e) => {
    const j = e.target instanceof Element ? e.target.closest('a[data-jump]') : null;
    if (!j) return;
    const el = document.getElementById(j.dataset.jump);
    if (!el) return;
    e.preventDefault();
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ block: 'start' });
  });

  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button[data-copy]') : null;
    if (!b) return;
    const done = (ok) => { b.textContent = ok ? '복사했어요' : '복사하지 못했어요. 글자를 직접 골라 복사해 주세요'; };
    try { navigator.clipboard.writeText(b.dataset.copy).then(() => done(true), () => done(false)); } catch { done(false); }
  });

  window.addEventListener('pageshow', (e) => { release(); if (!e.persisted) restore(); });
})();
`;
