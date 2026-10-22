// 운영자 화면 HTML (이슈 #101). 스크립트 없이 폼만 쓴다. 바깥 글꼴, CDN, 인라인 스타일 없음 (CSP: style-src 'self').
// 사용자가 넣은 글(공지, 이벤트, 닉네임, 기록)은 모두 esc 로 바꿔 넣는다. 사용자에게 보이는 이름은 "채팅 이용권"
// (서버 코드와 표 이름은 ai_ticket 그대로).
import type { AiSettings, SubscriptionInfo } from './ai-admin';
import { FEATURES, type FeatureView } from './features';
import type { EventRow } from './feeds';
import type { DocNotice, NoticeDoc } from './notice-doc';
import { kstIso } from './shared/site-events';

export interface AdminAccountRow {
  id: string;
  code: string;
  nickname: string | null;
  age: string;
  balance: number;
  merged_into: string | null;
}

export const ADMIN_TABS = [
  'overview',
  'users',
  'grants',
  'notices',
  'events',
  'features',
  'ai',
  'log',
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

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

export interface AdminView {
  tab: AdminTab;
  csrf: string;
  flash?:
    | {
        text: string;
        error: boolean;
        /** 실패한 폼의 쓰기 이름, 대상, 쓴 값 (다시 그릴 때 칸을 채우고 오류를 그 폼 옆에 둔다) */
        form?: string | undefined;
        scope?: string | undefined;
        fields?: Record<string, string | string[]> | undefined;
      }
    | undefined;
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
  latest: string | undefined;
  /** 선물과 쿠폰은 로그인 계정만 */
  rewardsLoginOnly: boolean;
  /** 기능 스위치 (#102, features.ts): kakao_login, coin_reset, calendar_link_hint (#115) */
  features: FeatureView[];
  /** 앱 판 분포 (이슈 #120): 최근 30일 활동 계정의 마지막 앱 판 */
  versions: { active: number; unknown: number; rows: { version: string; count: number }[] };
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
<link rel="stylesheet" href="/admin/admin.css">${o.script ? '\n<script src="/admin/admin.js" defer></script>' : ''}
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
  return f?.error && f.form === action && (scope === undefined || (f.scope ?? '') === scope)
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
/** 오류는 폼 안 맨 위에 둔다. 주소 조각(#form-error)이 화면을 그 자리로 가져온다 */
const formErr = (v: Pick<AdminView, 'flash'>, action: string, scope?: string): string => {
  const f: Flash | undefined = v.flash;
  if (!f?.error || f.form !== action || (scope !== undefined && (f.scope ?? '') !== scope)) return '';
  return `<p class="flash error wide" role="alert" id="form-error">${esc(f.text)}</p>`;
};

/**
 * 되돌릴 수 없는 동작: 대상 이름이 적힌 확인 칸을 체크해야 단추가 눌린다 (서버도 confirm 이 없으면 거절한다).
 * what 은 "이벤트 '신년' (new-year) 지금 끝낼게요" 처럼 대상과 동작이 한 문장
 */
function sureForm(
  v: Pick<AdminView, 'flash' | 'csrf'>,
  action: string,
  fields: Record<string, string>,
  what: string,
  button: string,
): string {
  const scope = fields.key ?? fields.account ?? fields.id;
  const inputs = Object.entries(fields)
    .map(([k, x]) => `<input type="hidden" name="${esc(k)}" value="${esc(x)}">`)
    .join('');
  return `<form method="post" action="${esc(action)}" class="sure">${formErr(v, action, scope)}${hidden(v.csrf)}${inputs}<label class="confirm"><input type="checkbox" name="confirm" value="${esc((fields.id ?? fields.account ?? '').trim())}" required> ${esc(what)}</label><button type="submit" class="danger">${esc(button)}</button></form>`;
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

function phase(starts: number, ends: number): string {
  const now = Date.now();
  if (now < starts) return '<span class="tag soon">곧</span>';
  if (now < ends) return '<span class="tag live">진행 중</span>';
  return '<span class="tag ended">끝남</span>';
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

function accountSection(v: AdminView): string {
  const csrf = v.csrf;
  const a = v.account;
  const list =
    v.accounts.length > 1
      ? `<div class="table-scroll"><table><thead><tr><th>번호</th><th>닉네임, 기기 코드</th><th>나이</th><th>코인</th></tr></thead><tbody>
${v.accounts.map((x) => `<tr><td><a href="/admin/users?q=${esc(x.code)}">${esc(x.id)}</a></td><td>${who(x)}${x.merged_into ? ` (합쳐짐, 남은 계정 #${esc(x.merged_into)})` : ''}</td><td>${esc(x.age)}</td><td>${x.balance}</td></tr>`).join('')}
</tbody></table></div>`
      : '';
  const sub = a ? draftOf(v, 'ai/subscribe', a.code) : undefined;
  const rev = a ? draftOf(v, 'ai/revoke', a.code) : undefined;
  const detail = a
    ? `<dl class="stats">
<div><dt>계정</dt><dd>#${esc(a.id)} ${who(a)}${a.merged_into ? ` (합쳐짐 → #${esc(a.merged_into)})` : ''}${a.admin ? ' <span class="tag live">운영자</span>' : ''}</dd></div>
<div><dt>나이 구분</dt><dd>${esc(a.age)}</dd></div>
<div><dt>코인</dt><dd>${a.balance}</dd></div>
<div><dt>로그인</dt><dd>${esc(a.logins.join(', ') || '없음')}</dd></div>
<div><dt>만든 때</dt><dd>${when(a.created)}</dd></div>
<div><dt>선물, 쿠폰, 쪽지</dt><dd>${a.claims}, ${a.coupons}, ${a.notes}</dd></div>
<div><dt>채팅 이용권</dt><dd>${a.ai.remaining}장${a.ai.blocked ? ' <span class="tag ended">막힘</span>' : ''}${a.ai.allowed ? ' <span class="tag live">허용 목록</span>' : ''}</dd></div>
<div><dt>이번 달 질문, 추정 비용</dt><dd>${a.ai.monthAsks}번, ${usd(a.ai.monthCostMicros)}</dd></div>
<div><dt>정기 지급</dt><dd>${a.ai.subscription ? `매달 ${a.ai.subscription.monthly}장 ${a.ai.subscription.mode === 'fill' ? '까지 채우기' : '더하기'}, ${esc(a.ai.subscription.startsOn)} ~ ${esc(a.ai.subscription.endsOn ?? '무기한')}, 다음 ${esc(a.ai.subscription.nextFill ?? '없음')}` : '없음'}</dd></div>
</dl>
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
<button type="submit">정기 지급 걸기</button>
</form>
<form method="post" action="/admin/ai/revoke" class="grid">${formErr(v, 'ai/revoke', a.code)}${hidden(csrf)}<input type="hidden" name="account" value="${esc(a.code)}">
<label>채팅 이용권 회수 (남은 장수까지) <input name="count" type="number" min="1" max="1000" required value="${esc(val(rev, 'count'))}"></label>
${confirmBox(`${plain(a)} 채팅 이용권 회수할게요 (되돌릴 수 없어요)`)}
<button type="submit" class="danger">회수하기</button>
</form>`
    : a === null
      ? '<p class="flash error">찾는 계정이 없어요</p>'
      : '';
  return `<section><h2>이용자 찾기와 자세히 보기</h2>
<form method="get" action="/admin/users" class="row"><label>번호, 닉네임 또는 기기 코드 <input name="q" maxlength="40" value="${esc(v.query ?? '')}"></label><button type="submit">찾기</button></form>
${list}${detail}</section>`;
}

const loginKo = (services: string[]): string => {
  const names = services.map((x) => (x === 'google' ? '구글' : x === 'kakao' ? '카카오' : x));
  return names.join(', ') || '없음';
};

export function usersTable(v: AdminView): string {
  const u = v.users;
  const params = (page: number) => {
    const p = new URLSearchParams();
    if (u.query) p.set('q', u.query);
    p.set('page', String(page));
    p.set('sort', u.sort);
    p.set('direction', u.direction);
    return `/admin/users?${p}`;
  };
  const rows = u.rows
    .map(
      (x) => `<tr><td><a href="/admin/users?q=${encodeURIComponent(x.code)}">${esc(x.id)}</a></td>
<td>${esc(x.nickname ?? '닉네임 없음')}</td><td><code>${esc(x.code)}</code></td><td>${esc(loginKo(x.logins))}</td>
<td>${esc(x.age)}</td><td>${x.balance}</td><td>${x.tickets}</td><td>${when(x.lastActive)}</td><td>${when(x.created)}</td>
<td>${esc(x.appVersion ?? '없음')}</td><td><a class="button-link" href="/admin/grants?account=${encodeURIComponent(x.code)}">지급</a></td></tr>`,
    )
    .join('');
  return `<section><h2>이용자 ${u.total}명</h2>
<form method="get" action="/admin/users" class="row">
<label>번호, 닉네임 또는 기기 코드 <input name="q" maxlength="40" value="${esc(u.query)}"></label>
<label>정렬 <select name="sort"><option value="active"${u.sort === 'active' ? ' selected' : ''}>최근 활동</option><option value="coins"${u.sort === 'coins' ? ' selected' : ''}>코인</option><option value="created"${u.sort === 'created' ? ' selected' : ''}>만든 날</option></select></label>
<label>방향 <select name="direction"><option value="desc"${u.direction === 'desc' ? ' selected' : ''}>큰 값부터</option><option value="asc"${u.direction === 'asc' ? ' selected' : ''}>작은 값부터</option></select></label>
<button type="submit">보기</button></form>
<p class="hint">합쳐져서 닫힌 계정은 보이지 않아요. 한 쪽에 50명씩 보여요.</p>
<div class="table-scroll"><table class="users"><thead><tr><th>번호</th><th>닉네임</th><th>기기 코드</th><th>로그인 여부</th><th>나이 구분</th><th>코인 잔액</th><th>채팅 이용권</th><th>마지막 활동</th><th>만든 날</th><th>앱 판</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="11">찾은 이용자가 없어요</td></tr>'}</tbody></table></div>
<nav class="pager" aria-label="쪽 넘기기">${u.page > 1 ? `<a href="${esc(params(u.page - 1))}">이전</a>` : '<span>이전</span>'}<strong>${u.page} / ${u.pages}</strong>${u.page < u.pages ? `<a href="${esc(params(u.page + 1))}">다음</a>` : '<span>다음</span>'}</nav>
</section>${v.query ? accountSection(v) : ''}`;
}

function grantsSection(v: AdminView): string {
  const selected = v.account && !v.account.merged_into ? v.account : undefined;
  const value = selected?.code ?? v.query ?? '';
  const chosen = selected
    ? `<p class="selected">선택한 이용자: #${esc(selected.id)} ${who(selected)}</p>`
    : '';
  const d = draftOf(v, 'grants/batch');
  return `<section><h2>코인과 채팅 이용권 지급</h2>
<p class="hint">지급은 쪽지함으로 보내며 이용자가 열 때 받아요. 지급과 운영 기록은 같은 트랜잭션에 남아요. 한 번에 20명, 한 사람마다 코인 10000개와 채팅 이용권 1000장까지예요.</p>
${chosen}
<form method="post" action="/admin/grants/batch" class="grid">${formErr(v, 'grants/batch')}${hidden(v.csrf)}
<label class="wide">받을 계정 번호 또는 기기 코드, 한 줄에 하나씩 최대 20명 <textarea name="accounts" required maxlength="400">${esc(val(d, 'accounts', value))}</textarea></label>
<label>코인 수 <input name="coins" type="number" min="0" max="10000" value="${esc(val(d, 'coins', '0'))}" required></label>
<label>채팅 이용권 수 <input name="chat_passes" type="number" min="0" max="1000" value="${esc(val(d, 'chat_passes', '0'))}" required></label>
<label>만료 날수 <input name="days" type="number" min="1" max="365" value="${esc(val(d, 'days', '30'))}" required></label>
<label class="wide">지급 사유, 이용자에게 보여요 <textarea name="reason" required maxlength="200">${esc(val(d, 'reason'))}</textarea></label>
${confirmBox('위 이용자에게 지급할게요')}
<button type="submit">지급 쪽지 보내기</button></form></section>`;
}

/** 이번 달 추정 비용이 예산의 50%, 80% 를 넘으면 경고 */
export function budgetWarn(cost: number, budget: number): string {
  if (budget <= 0)
    return '<p class="flash error">월 예산이 0 이라 채팅 이용권 질문이 모두 막혀요 (.env AI_MONTHLY_BUDGET_USD)</p>';
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

/** 기능 모드 글. allowlist 에서도 운영자 계정이 켜지는 기능(features.ts admins)은 채팅 이용권처럼 그렇게 적는다 */
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
  friend_gift_passes: '친구에게 채팅 이용권 선물',
};

const FEATURE_HINT: Record<string, string> = {
  kakao_login:
    '허용 목록 모드에서는 이미 구글로 로그인한 허용 계정이 앱에서 "카카오도 연결"하는 것만 돼요. 모두 모드면 누구나 카카오로 로그인, 가입. 카카오 키가 없으면 켜도 꺼져 있어요.',
  coin_reset: '꺼짐이면 앱이 초기화 칸을 숨기고, 서버도 초기화 기록을 받지 않아요.',
  calendar_link_hint:
    '같은 계정의 다른 기기에서 구글 일정을 연결했으면 새 기기에 "이 기기도 연결할까?"를 보여 줘요. 서버에는 연결 표시만 두고 구글 토큰은 두지 않아요. 허용 목록 모드에서는 운영자 계정도 켜져요.',
  friends:
    '허용 목록 모드에서는 목록의 계정과 운영자 계정만 써요. 신청을 받는 사람도 쓸 수 있어야 해요. 로그인한 계정끼리, 만 14~17세끼리와 성인끼리만 친구가 돼요.',
  friend_gifts:
    '보내는 사람 기준이에요. 하루 코인 500, 채팅 이용권 5장 (보내기, 받기 각각). 이용권은 받는 사람이 만 18세 이상이고 둘 다 채팅 이용권을 쓸 수 있을 때만.',
  friend_calendar:
    '보여 주는 사람과 보는 사람 모두 켜져 있어야 해요. 바쁜 시간대(시작, 끝)만 올라오고 제목은 없어요. 끄면 바로 지워요.',
  friend_gift_passes:
    '보내는 사람과 받는 사람이 모두 허용돼야 해요(허용 목록 모드면 둘 다 목록이나 운영자 계정). 지금 이용권은 모두 운영자 지급분이라 이 스위치가 운영자 지급분 선물 여부까지 정해요. 받는 사람은 만 18세 이상이고 채팅 이용권을 쓸 수 있어야 해요.',
};

/** 기능 하나의 모드 바꾸기와 허용 계정 (#102) */
function featureForms(x: FeatureView, v: AdminView): string {
  const csrf = v.csrf;
  const dm = draftOf(v, 'features/mode', x.key);
  const da = draftOf(v, 'features/allow', x.key);
  const name = FEATURE_KO[x.key] ?? x.key;
  return `<h3>${esc(FEATURE_KO[x.key] ?? x.key)} <code>${esc(x.key)}</code></h3>
<p class="hint">${esc(FEATURE_HINT[x.key] ?? '')}</p>
<form method="post" action="/admin/features/mode" class="grid">${formErr(v, 'features/mode', x.key)}${hidden(csrf)}<input type="hidden" name="key" value="${esc(x.key)}">
<label>모드 <select name="mode">${(['off', 'allowlist', 'everyone'] as const).map((m) => opt(dm, 'mode', m, featureModeKo(x.key, m), x.mode)).join('')}</select></label>
${confirmBox(`${name} 접근 설정을 바꿀게요 (지금 ${featureModeKo(x.key, x.mode)})`)}
<button type="submit" class="danger">모드 바꾸기</button>
</form>
<form method="post" action="/admin/features/allow" class="row">${formErr(v, 'features/allow', x.key)}${hidden(csrf)}<input type="hidden" name="key" value="${esc(x.key)}"><input type="hidden" name="allowed" value="1">
<label>허용할 계정 번호나 기기 코드 <input name="account" required maxlength="20" value="${esc(val(da, 'account'))}"></label><button type="submit">허용 목록에 넣기</button>
</form>
<ul class="plain">${x.accounts.map((id) => `<li><a href="/admin/users?q=${id}">#${id}</a> ${postButton(csrf, '/admin/features/allow', { key: x.key, account: String(id), allowed: '0' }, '빼기', true)}</li>`).join('') || '<li>허용 목록이 비었어요</li>'}</ul>`;
}

function aiSection(v: AdminView): string {
  const ai = v.ai;
  const csrf = v.csrf;
  const dMode = draftOf(v, 'ai/mode');
  const dLim = draftOf(v, 'ai/limits');
  const dPol = draftOf(v, 'ai/policy');
  const features = `<section><h2>기능 스위치</h2>
<table><thead><tr><th>기능</th><th>키</th><th>모드</th></tr></thead><tbody>
<tr><td>채팅 이용권 (AI 대화권)</td><td><code>ai_chat</code></td><td>${esc(MODE_KO[ai.mode])}</td></tr>
${v.features.map((x) => `<tr><td>${esc(FEATURE_KO[x.key] ?? x.key)}</td><td><code>${esc(x.key)}</code></td><td>${esc(featureModeKo(x.key, x.mode))}${x.from === 'env' ? ' (서버 설정 기본값)' : ''}</td></tr>`).join('\n')}
</tbody></table>
${v.features.map((x) => featureForms(x, v)).join('\n')}
</section>`;
  const tickets = `<section><h2>채팅 이용권과 예산</h2>
<h3>채팅 이용권 접근</h3>
<p class="hint">지금 모드: <strong>${esc(MODE_KO[ai.mode])}</strong>. 1장 = 질문 1번. 허용 목록 모드에서는 목록의 계정과 운영자 계정(ADMIN_GOOGLE_SUBS)만 써요. 첫 로그인 선물 10장은 허용된 계정이 처음 물을 때 한 번.</p>
<form method="post" action="/admin/ai/mode" class="grid">${formErr(v, 'ai/mode')}${hidden(csrf)}
<label>모드 <select name="mode">${(['off', 'allowlist', 'everyone'] as const).map((m) => opt(dMode, 'mode', m, MODE_KO[m] ?? m, ai.mode)).join('')}</select></label>
${confirmBox(`채팅 이용권 접근 설정을 바꿀게요 (지금 ${MODE_KO[ai.mode]})`)}
<button type="submit" class="danger">모드 바꾸기</button>
</form>
<form method="post" action="/admin/ai/limits" class="grid">${formErr(v, 'ai/limits')}${hidden(csrf)}
<label>월 예산 달러 (.env 상한 ${usd(ai.capBudgetMicros)} 이하, 비우면 상한) <input name="budget_usd" inputmode="decimal" value="${esc(val(dLim, 'budget_usd', ai.setBudgetMicros === null ? '' : (ai.setBudgetMicros / 1e6).toString()))}"></label>
<label>사람마다 하루 질문 (.env 상한 ${ai.capDailyLimit} 이하, 비우면 상한) <input name="daily_limit" type="number" min="0" value="${esc(val(dLim, 'daily_limit', String(ai.setDailyLimit ?? '')))}"></label>
<label>질문 한 번에 쓸 글자 수 (.env 상한 ${ai.capInputChars} 이하, 비우면 상한) <input name="input_chars" type="number" min="1" max="${ai.capInputChars}" value="${esc(val(dLim, 'input_chars', String(ai.setInputChars ?? '')))}"></label>
<button type="submit">예산 저장</button>
</form>
<p class="hint">지금 쓰는 값: 월 ${usd(ai.monthlyBudgetMicros)}, 하루 ${ai.dailyLimit}번, 질문 ${ai.inputChars}자 이하. 이번 달 ${usd(v.summary.aiCostMicros)} 썼어요.</p>
${budgetWarn(v.summary.aiCostMicros, ai.monthlyBudgetMicros)}
<form method="post" action="/admin/ai/policy" class="grid">${formErr(v, 'ai/policy')}${hidden(csrf)}
<p class="wide">정책: 허용된 계정은 매달 1일(한국) N장까지 채우기 정기 지급이 저절로 걸려요 (쪽지로, 이월 없음). 자리는 ${ai.seatsUsed}/${ai.seatLimit}.</p>
<label>매달 장수 <input name="auto_monthly" type="number" min="1" max="1000" value="${esc(val(dPol, 'auto_monthly', String(ai.autoMonthly)))}"></label>
<label>자리 수 (정기 지급 계정 상한) <input name="seat_limit" type="number" min="0" max="100000" value="${esc(val(dPol, 'seat_limit', String(ai.seatLimit)))}"></label>
<label>첫 로그인 선물 10장 <select name="first_gift">${opt(dPol, 'first_gift', '0', '끔', ai.firstGift ? '1' : '0')}${opt(dPol, 'first_gift', '1', '켬', ai.firstGift ? '1' : '0')}</select></label>
<button type="submit">정책 저장</button>
</form>
<h3>대기 목록 (${ai.waitlist.length})</h3>
<ul class="plain">${ai.waitlist.map((x) => `<li><a href="/admin/users?q=${esc(x.code)}">#${esc(x.id)}</a> ${who(x)} ${postButton(csrf, '/admin/ai/allow', { account: x.code, allowed: '1' }, '허용하기')}</li>`).join('') || '<li>비었어요</li>'}</ul>
<h3>허용 목록 (${ai.allow.length})</h3>
<ul class="plain">${ai.allow.map((x) => `<li><a href="/admin/users?q=${esc(x.code)}">#${esc(x.id)}</a> ${who(x)} ${postButton(csrf, '/admin/ai/allow', { account: x.code, allowed: '0' }, '빼기', true)}</li>`).join('') || '<li>비었어요 (운영자 계정은 늘 허용)</li>'}</ul>
</section>`;
  return v.tab === 'features' ? features : tickets;
}

const TAB_LINKS: Array<[AdminTab, string, string]> = [
  ['overview', '개요', '/admin'],
  ['users', '이용자', '/admin/users'],
  ['grants', '지급', '/admin/grants'],
  ['notices', '공지와 업데이트', '/admin/notices'],
  ['events', '이벤트와 쿠폰', '/admin/events'],
  ['features', '기능 스위치', '/admin/features'],
  ['ai', '채팅 이용권과 예산', '/admin/ai'],
  ['log', '운영 기록', '/admin/log'],
];

function tabs(current: AdminTab): string {
  return `<nav class="tabs" aria-label="운영자 화면">${TAB_LINKS.map(([tab, label, href]) => `<a href="${href}"${tab === current ? ' class="current" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

export function mainPage(v: AdminView): string {
  const s = v.summary;
  const csrf = v.csrf;
  const dEv = draftOf(v, 'events');
  const dCp = draftOf(v, 'coupons');
  const dRw = draftOf(v, 'rewards/policy');
  const reasons = ([] as string[]).concat((dEv?.reasons as string | string[] | undefined) ?? []);
  const sections = [
    `<header><h1>페어리 운영자</h1>
<form method="post" action="/admin/logout" class="inline">${hidden(csrf)}<button type="submit">로그아웃</button></form></header>${tabs(v.tab)}`,
    v.flash && !v.flash.error ? `<p class="flash" role="status">${esc(v.flash.text)}</p>` : '',
    v.tab === 'overview'
      ? `<section><h2>사용량</h2>
<dl class="stats">
<div><dt>계정</dt><dd>${s.accounts}</dd></div>
<div><dt>코인 잔액 합</dt><dd>${s.coins}</dd></div>
<div><dt>남은 채팅 이용권 합</dt><dd>${s.tickets}</dd></div>
<div><dt>지난 24시간 번 코인</dt><dd>${s.earnedDay}</dd></div>
<div><dt>지난 24시간 쓴 코인</dt><dd>${s.spentDay}</dd></div>
<div><dt>이번 달 질문</dt><dd>${s.aiAsks}</dd></div>
<div><dt>이번 달 추정 비용</dt><dd>${usd(s.aiCostMicros)} / ${usd(v.ai.monthlyBudgetMicros)}</dd></div>
<div><dt>남은 예산</dt><dd>${usd(Math.max(0, v.ai.monthlyBudgetMicros - s.aiCostMicros))}</dd></div>
</dl></section>`
      : '',
    v.tab === 'users' ? usersTable(v) : '',
    v.tab === 'grants' ? grantsSection(v) : '',
    v.tab === 'features' || v.tab === 'ai' ? aiSection(v) : '',
    v.tab === 'events'
      ? `<section><h2>이벤트</h2>
<p class="hint">앱은 홈페이지 정적 파일(events.json)만 읽어요. 여기서 만들면 10분 안쪽에 홈페이지로 올라가요. 시간은 한국 시간.</p>
<table><thead><tr><th>id</th><th>종류</th><th>제목</th><th>기간</th><th>받은 수</th><th></th></tr></thead><tbody>
${
  v.events
    .map(
      (
        e,
      ) => `<tr><td>${esc(e.id)}</td><td>${e.kind === 'gift' ? `선물 ${e.coins}` : `배수 x${e.boost_times} (${esc((e.boost_reasons ?? []).join(', '))})`}</td>
<td>${esc(e.title_ko)}<br><small>${esc(e.title_en)}</small></td><td>${phase(Number(e.starts), Number(e.ends))} ${when(e.starts)} ~ ${when(e.ends)}</td><td>${e.claims}</td>
<td>${
        Date.now() < Number(e.ends)
          ? Date.now() < Number(e.starts)
            ? sureForm(
                v,
                '/admin/events/end',
                { id: e.id },
                `이벤트 "${e.title_ko}" (${e.id}) 지울게요`,
                '지우기',
              )
            : sureForm(
                v,
                '/admin/events/end',
                { id: e.id },
                `이벤트 "${e.title_ko}" (${e.id}) 지금 끝낼게요`,
                '지금 끝내기',
              )
          : ''
      }</td></tr>`,
    )
    .join('') || '<tr><td colspan="6">아직 없어요</td></tr>'
}
</tbody></table>
<form method="post" action="/admin/events" class="grid">${formErr(v, 'events')}${hidden(csrf)}
<label>id (영문, 숫자, ., _, - 40자) <input name="id" required maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,39}" value="${esc(val(dEv, 'id'))}"></label>
<label>종류 <select name="kind">${opt(dEv, 'kind', 'gift', '선물 (모두에게 코인)', 'gift')}${opt(dEv, 'kind', 'boost', '배수 (출석, 집중 코인)', 'gift')}</select></label>
<label>제목 ko (60자) <input name="title_ko" required maxlength="60" value="${esc(val(dEv, 'title_ko'))}"></label>
<label>제목 en (60자) <input name="title_en" required maxlength="60" value="${esc(val(dEv, 'title_en'))}"></label>
<label class="wide">본문 ko (300자) <textarea name="body_ko" required maxlength="300">${esc(val(dEv, 'body_ko'))}</textarea></label>
<label class="wide">본문 en (300자) <textarea name="body_en" required maxlength="300">${esc(val(dEv, 'body_en'))}</textarea></label>
<label>시작 <input name="from" type="datetime-local" required value="${esc(val(dEv, 'from'))}"></label>
<label>끝 <input name="until" type="datetime-local" required value="${esc(val(dEv, 'until'))}"></label>
<label>선물 코인 (1~1000) <input name="coins" type="number" min="1" max="1000" value="${esc(val(dEv, 'coins'))}"></label>
<fieldset><legend>배수 까닭</legend><label><input type="checkbox" name="reasons" value="meet"${reasons.includes('meet') ? ' checked' : ''}> 출석</label><label><input type="checkbox" name="reasons" value="focus"${reasons.includes('focus') ? ' checked' : ''}> 집중</label></fieldset>
<label>배수 <select name="times">${opt(dEv, 'times', '2', '2배', '2')}${opt(dEv, 'times', '3', '3배', '2')}</select></label>
<button type="submit">이벤트 만들기</button>
</form></section>`
      : '',
    v.tab === 'events'
      ? `<section><h2>쿠폰</h2>
<form method="post" action="/admin/rewards/policy" class="row">${formErr(v, 'rewards/policy')}${hidden(csrf)}
<label>선물과 쿠폰 받는 계정 <select name="login_only">${opt(dRw, 'login_only', '1', '로그인 계정만 (기본)', v.rewardsLoginOnly ? '1' : '0')}${opt(dRw, 'login_only', '0', '기기 계정도', v.rewardsLoginOnly ? '1' : '0')}</select></label>
<button type="submit">저장</button>
</form>
<p class="hint">코드는 서버가 12자로 만들고 만들 때 한 번만 보여요 (서버에는 해시만). 계정마다 한 번, 채팅 이용권은 만 18세 이상 계정에만 가요.</p>
<table><thead><tr><th>#</th><th>코드 앞</th><th>메모</th><th>주는 것</th><th>기간</th><th>사용</th><th></th></tr></thead><tbody>
${
  v.coupons
    .map(
      (
        c,
      ) => `<tr${c.disabled ? ' class="off"' : ''}><td>${esc(c.id)}</td><td>${esc(c.hint)}…</td><td>${esc(c.label)}</td><td>코인 ${c.coins}, 채팅 이용권 ${c.tickets}장</td>
<td>${c.disabled ? '<span class="tag ended">꺼짐</span>' : phase(Number(c.starts), Number(c.ends))} ${when(c.starts)} ~ ${when(c.ends)}</td><td>${c.used} / ${c.max_uses}</td>
<td>${c.disabled ? '' : sureForm(v, '/admin/coupons/disable', { id: c.id }, `쿠폰 #${c.id} (${c.label}) 끌게요, 다시 켤 수 없어요`, '끄기')}</td></tr>`,
    )
    .join('') || '<tr><td colspan="7">아직 없어요</td></tr>'
}
</tbody></table>
<form method="post" action="/admin/coupons" class="grid">${formErr(v, 'coupons')}${hidden(csrf)}
<label class="wide">메모 (80자, 사용자에게 안 보임) <input name="label" required maxlength="80" value="${esc(val(dCp, 'label'))}"></label>
<label>코인 (0~1000) <input name="coins" type="number" min="0" max="1000" value="${esc(val(dCp, 'coins', '0'))}"></label>
<label>채팅 이용권 (0~50장) <input name="tickets" type="number" min="0" max="50" value="${esc(val(dCp, 'tickets', '0'))}"></label>
<label>전체 사용 상한 <input name="max_uses" type="number" min="1" max="100000" required value="${esc(val(dCp, 'max_uses'))}"></label>
<label>시작 (비우면 지금) <input name="from" type="datetime-local" value="${esc(val(dCp, 'from'))}"></label>
<label>끝 <input name="until" type="datetime-local" required value="${esc(val(dCp, 'until'))}"></label>
<button type="submit">쿠폰 만들기</button>
</form></section>`
      : '',
    v.tab === 'notices' ? noticesSection(v) : '',
    v.tab === 'log' ? logSection(v) : '',
  ];
  const body = sections.join('\n');
  // 폼을 못 찾은 오류 (예: 돌아온 화면에 그 폼이 없을 때)는 맨 위에 그대로 보인다
  const lost =
    v.flash?.error && !body.includes('id="form-error"')
      ? `<p class="flash error" role="alert" id="form-error">${esc(v.flash.text)}</p>`
      : '';
  const header = sections[0] as string;
  return doc('페어리 운영자', `<main>${header}\n${lost}${body.slice(header.length)}</main>`, {
    script: true,
    flash: v.flash ? (v.flash.error ? 'error' : 'ok') : '',
  });
}

const ACTION_KO: Record<string, string> = {
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
  login: '로그인',
  logout: '로그아웃',
  'login.fail': '로그인 실패',
  'csrf.fail': '요청 확인 실패',
};
/** 기록의 동작 이름을 운영자 말로 (모르면 코드 그대로) */
export const actionKo = (a: string): string => ACTION_KO[a] ?? a;

/** 운영 기록: 누가(이름), 대상 이용자, 동작 종류, 글 검색 */
function logSection(v: AdminView): string {
  const p = v.logPage;
  const q = (page: number) => {
    const x = new URLSearchParams();
    if (p.user) x.set('user', p.user);
    if (p.action) x.set('action', p.action);
    if (p.text) x.set('text', p.text);
    x.set('page', String(page));
    return `/admin/log?${x}`;
  };
  const rows = v.log
    .map(
      (l) => `<tr><td>${when(l.at)}</td>
<td>${l.actorName ? `${esc(l.actorName)}<br><small><code>${esc(l.actor)}</code></small>` : `<code>${esc(l.actor)}</code>`}</td>
<td>${esc(actionKo(l.action))}<br><small><code>${esc(l.action)}</code></small></td>
<td>${l.targetName ? `${esc(l.targetName)}<br><small><code>${esc(l.target ?? '')}</code></small>` : esc(l.target ?? '')}</td>
<td><code>${esc(l.detail ? JSON.stringify(l.detail) : '')}</code></td></tr>`,
    )
    .join('');
  const filtered = !!(p.user || p.action || p.text);
  return `<section><h2>운영 기록 ${p.total}건</h2>
<form method="get" action="/admin/log" class="row">
<label>대상 이용자 (번호, 기기 코드, 닉네임) <input name="user" maxlength="40" value="${esc(p.user)}"></label>
<label>동작 종류 <select name="action"><option value="">전체</option>${p.actions.map((a) => `<option value="${esc(a)}"${a === p.action ? ' selected' : ''}>${esc(actionKo(a))}${actionKo(a) === a ? '' : ` (${esc(a)})`}</option>`).join('')}</select></label>
<label>글 검색 (이름, 대상, 자세히) <input name="text" maxlength="60" value="${esc(p.text)}"></label>
<button type="submit">찾기</button>${filtered ? '<a class="button-link" href="/admin/log">모두 보기</a>' : ''}
</form>
<p class="hint">한 쪽에 50건씩 보여요. 옛 기록은 이름 없이 세션 표시만 있어요.</p>
${p.userMissing ? '<p class="flash error">그 이용자를 찾지 못했어요</p>' : ''}
<div class="table-scroll"><table class="log"><thead><tr><th>때</th><th>누가</th><th>무엇</th><th>대상</th><th>자세히</th></tr></thead><tbody>
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
  return `<h3>앱 판 분포 (최근 30일 활동 ${x.active}명)</h3>
<table><tr><th>앱 판</th><th>계정</th></tr>${rows}<tr><td>판 없음 (옛 앱)</td><td>${x.unknown}</td></tr></table>`;
}

function noticesSection(v: AdminView): string {
  const d = v.notices;
  const csrf = v.csrf;
  const dv = draftOf(v, 'versions');
  const dn = draftOf(v, 'notices');
  const list = d?.notices ?? [];
  return `<section><h2>공지와 강제 업데이트</h2>
<p class="hint">${
    d
      ? `마지막 저장 ${when(v.noticesUpdated ?? 0)}. 홈페이지 notices.json 은 10분 안쪽에 이 내용으로 바뀌어요.`
      : '아직 여기서 저장한 적이 없어요. 처음 저장하면 홈페이지 notices.json 전체가 이 화면의 내용으로 바뀌어요.'
  } 이미 닫은 알림은 다시 안 뜨니 정정은 새 id 로 올려요.</p>
<form method="post" action="/admin/versions" class="grid">${formErr(v, 'versions')}${hidden(csrf)}
<p class="wide">최신 릴리스: <strong>${esc(v.latest ?? '읽지 못함')}</strong>. 올리는 값은 이보다 높을 수 없어요. 내리거나 지우기는 언제나 돼요.</p>
<label>최소 버전 (이보다 낮으면 잠금) <input name="minVersion" pattern="\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}" value="${esc(val(dv, 'minVersion', d?.minVersion ?? ''))}" placeholder="비우면 없음"></label>
<label>기능 제한 버전 (이보다 낮으면 서버 기능 거절, 앱은 업데이트 안내) <input name="restrictVersion" pattern="\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}" value="${esc(val(dv, 'restrictVersion', d?.restrictVersion ?? ''))}" placeholder="비우면 없음"></label>
<label>권장 버전 (업데이트 권장 공지) <input name="recommendVersion" pattern="\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}" value="${esc(val(dv, 'recommendVersion', d?.recommendVersion ?? ''))}" placeholder="비우면 없음"></label>
<p class="wide hint">순서: 최소 ≤ 기능 제한 ≤ 권장. 올린 값은 다음 맞추기(3분 안)에 서버에 바로 적용돼요.</p>
<label class="confirm"><input type="checkbox" name="confirm" value="yes"> 최소 버전이나 기능 제한 버전을 올리면 낮은 앱이 잠기거나 서버 기능이 막혀요. 올릴 때만 체크</label>
<button type="submit">버전 저장</button>
</form>
${versionTable(v)}
${list
  .map(
    (n) => `<article class="notice">
<header><code>${esc(n.id)}</code> ${esc(KIND_KO[n.kind])} ${n.from || n.until ? `${esc(n.from ?? '')} ~ ${esc(n.until ?? '')}` : '기간 없음'} ${n.versions ? `대상 ${esc(n.versions)}` : ''} ${n.platforms ? esc(n.platforms.join(', ')) : ''}
${sureForm(v, '/admin/notices/delete', { id: n.id }, `공지 "${n.title.ko}" (${n.id}) 지울게요`, '지우기')}</header>
<div class="previews">${noticePreview(n, 'ko')}${noticePreview(n, 'en')}</div>
${n.link ? `<p class="hint">링크: ${esc(n.link)}</p>` : ''}
</article>`,
  )
  .join('')}
<form method="post" action="/admin/notices" class="grid">${formErr(v, 'notices')}${hidden(csrf)}
<p class="wide">공지 넣기 (같은 id 면 바꿔요)</p>
<label>id (영문, 숫자, ., _, - 80자) <input name="id" required maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,79}" value="${esc(val(dn, 'id'))}"></label>
<label>종류 <select name="kind">${opt(dn, 'kind', 'info', '알림 (한 번)', 'info')}${opt(dn, 'kind', 'important', '중요 (확인할 때까지)', 'info')}${opt(dn, 'kind', 'update', '업데이트 권장 (권장 버전보다 낮은 앱)', 'info')}${opt(dn, 'kind', 'force', '강제 업데이트 창의 글 (잠금은 최소 버전)', 'info')}</select></label>
<label>제목 ko (80자) <input name="title_ko" required maxlength="80" value="${esc(val(dn, 'title_ko'))}"></label>
<label>제목 en (80자) <input name="title_en" required maxlength="80" value="${esc(val(dn, 'title_en'))}"></label>
<label class="wide">본문 ko (1000자, 글자만) <textarea name="body_ko" required maxlength="1000">${esc(val(dn, 'body_ko'))}</textarea></label>
<label class="wide">본문 en (1000자, 글자만) <textarea name="body_en" required maxlength="1000">${esc(val(dn, 'body_en'))}</textarea></label>
<label class="wide">링크 (선택, https://fairy.moilga.com 이나 https://github.com/milcho0604/ 아래만) <input name="link" type="url" maxlength="500" value="${esc(val(dn, 'link'))}"></label>
<label>시작 (선택) <input name="from" type="datetime-local" value="${esc(val(dn, 'from'))}"></label>
<label>끝 (선택) <input name="until" type="datetime-local" value="${esc(val(dn, 'until'))}"></label>
<label>대상 버전 (선택, 예: &lt;0.5.0) <input name="versions" maxlength="60" value="${esc(val(dn, 'versions'))}"></label>
<label>운영체제 (선택, 예: darwin,win32) <input name="platforms" maxlength="40" value="${esc(val(dn, 'platforms'))}"></label>
<label class="confirm"><input type="checkbox" name="confirm" value="yes"> 강제 업데이트 글이면 체크</label>
<button type="submit">공지 저장</button>
</form></section>`;
}

export const adminCss = `:root { color-scheme: light dark; --bg: #faf8f5; --fg: #2b2622; --muted: #6f655c; --line: #e2dbd2; --card: #fff;
  --accent: #b5532f; --ok: #2f7a4a; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #1d1a17; --fg: #eee6dd; --muted: #a99e92; --line: #3a342e; --card: #26221e; --accent: #e58c63; --ok: #6cc28a; --bad: #f2867c; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 16px; }
main.narrow { max-width: 420px; padding-top: 12vh; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 22px; margin: 8px 0 16px; }
h2 { font-size: 17px; margin: 0 0 8px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin: 0 0 16px; overflow-x: auto; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
.tabs a, .button-link { color: var(--fg); border: 1px solid var(--line); border-radius: 7px; padding: 7px 10px; text-decoration: none; background: var(--card); }
.tabs a.current { color: #fff; background: var(--accent); border-color: var(--accent); font-weight: 700; }
.table-scroll { width: 100%; overflow-x: auto; }
.table-scroll table { min-width: 980px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 14px; }
.pager a, .pager span { min-width: 54px; text-align: center; }
.selected { border: 1px solid var(--ok); border-radius: 8px; padding: 10px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
input, select, textarea { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
textarea { min-height: 64px; resize: vertical; }
button { font: inherit; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
button.danger { background: transparent; color: var(--bad); border-color: var(--bad); }
form.inline { display: inline; }
form.sure { display: inline-flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 2px 0; }
form.sure .flash { flex: 1 0 100%; margin: 0; }
form.sure label.confirm { color: var(--bad); }
button:disabled { opacity: 0.6; cursor: progress; }
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
tr.off { opacity: 0.55; }
code { font-size: 12px; word-break: break-all; }
.hint { color: var(--muted); font-size: 13px; }
.flash { border: 1px solid var(--ok); color: var(--ok); border-radius: 8px; padding: 10px 12px; font-weight: 600; }
.flash.error { border-color: var(--bad); color: var(--bad); }
.flash.warn { border-color: #b7791f; color: #b7791f; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 0; }
.stats div { border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.stats dt { font-size: 12px; color: var(--muted); }
.stats dd { margin: 0; font-size: 17px; font-weight: 600; }
.tag { font-size: 11px; border-radius: 4px; padding: 1px 6px; border: 1px solid var(--line); }
.tag.live { border-color: var(--ok); color: var(--ok); }
.tag.ended { color: var(--muted); }
.notice { border-top: 1px solid var(--line); padding: 12px 0; }
.previews { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 8px; }
.preview { width: 100%; max-width: 360px; border: 1px solid var(--line); border-radius: 14px; padding: 14px; background: var(--bg); display: flex; flex-direction: column; gap: 6px; }
.preview .badge { align-self: flex-start; font-size: 11px; border-radius: 999px; padding: 1px 8px; background: var(--line); }
.preview.force .badge, .preview.important .badge { background: var(--bad); color: #fff; }
.preview p { margin: 0; color: var(--muted); font-size: 13px; }
.preview .btns { display: flex; gap: 6px; justify-content: flex-end; }
.preview .btns span { border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; font-size: 13px; }
.preview .btns span.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (max-width: 600px) {
  main { padding: 10px; }
  section { padding: 12px; }
  .tabs a { flex: 1 1 42%; text-align: center; }
  input, select, textarea, button { min-height: 42px; }
}
`;

/**
 * 운영자 화면의 바깥 스크립트 (인라인 스크립트 없음, CSP script-src 'self').
 * 1) 제출하면 그 폼의 단추를 막고 진행 표시를 켠다 (두 번 눌러 두 번 쓰지 않게). 뒤로 오면 풀린다.
 * 2) 제출한 값을 탭 안(sessionStorage)에 잠깐 둔다. 서버가 결과 글(성공, 오류)을 돌려준 화면이면 지우고,
 *    네트워크가 끊겨 결과 없이 돌아온 화면이면 같은 폼에 쓰던 값을 되살리고 안내한다.
 */
export const adminJs = `(() => {
  const KEY = 'fairy-admin-pending';
  const MAX_AGE = 10 * 60 * 1000;
  const store = (fn) => { try { return fn(window.sessionStorage); } catch { return undefined; } };
  const skip = new Set(['csrf', 'confirm']);
  const hiddenSig = (form) => [...form.querySelectorAll('input[type=hidden]')].filter((i) => i.name !== 'csrf').map((i) => i.name + '=' + i.value).join('&');

  const release = () => {
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

  window.addEventListener('pageshow', (e) => { release(); if (!e.persisted) restore(); });
})();
`;
