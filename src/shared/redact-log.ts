// 의견 보내기에 붙이는 진단 기록 가리기. 메인이 기록을 화면으로 넘기기 전에 이것을 거친다.
// 기록(log-file.ts)은 처음부터 질문, 답, 할 일과 일정 제목을 남기지 않지만, 오류 글과 호출 기록에는
// 경로, 주소, 토큰이 섞여 올 수 있다. 사람 손을 떠나기 전에 한 번 더 가린다 (사용자 규칙: 민감 정보는 잘 관리).
//
// 가리는 것 (앞에서부터 차례로):
// 1. secrets: 메인이 아는 사용자 글(할 일, 일정, 메모 제목, 캘린더 주소 등)이 글자 그대로 있으면 <private>
// 2. 홈 폴더 → ~, 다른 사람 홈(/Users/이름, /home/이름, C:\Users\이름)의 이름 → <user>
// 3. 주소: 아이디:비번@ 은 떼고, 물음표 뒤(쿼리)와 # 뒤는 <redacted>, 긴 아이디 같은 경로 조각은 <id>.
//    캘린더 주소(webcal, .ics, ical)는 경로 전체가 비밀이라 호스트만 남긴다 (<calendar>)
// 4. 토큰: hf_, sk-, ghp_ 같은 머리, JWT, Bearer, "token=", "password:" 같은 키 다음 값 → <secret>
// 5. 이메일 → <email> (%40 으로 바뀐 것도)
// 6. IP (IPv4, IPv6) → <ip>. 이 컴퓨터 자신(127.x, ::1, 0.0.0.0)은 둔다
// 7. 컴퓨터 이름 → <host>, 사용자 이름(낱말로 있을 때) → <user>

export interface RedactOptions {
  /** 홈 폴더 (os.homedir()) */
  home?: string;
  /** 로그인 이름 (os.userInfo().username) */
  user?: string;
  /** 컴퓨터 이름 (os.hostname()). 맥은 "김철수의-MacBook-Pro" 처럼 이름이 들어간다 */
  host?: string;
  /** 글자 그대로 가릴 사용자 글 (할 일, 일정, 메모 제목, 캘린더 주소). 너무 짧은 것은 건너뛴다 */
  secrets?: readonly string[];
}

export interface Redacted {
  text: string;
  /** 가린 곳 수 */
  count: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 영문, 숫자만이면 4자부터, 한글 같은 글자가 섞이면 2자부터 가린다 (짧은 영단어가 기록의 낱말을 다 지우지 않게) */
function longEnough(s: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII 범위를 본다
  return /[^\x00-\x7f]/.test(s) ? s.length >= 2 : s.length >= 4;
}

/** 토큰 머리 (서비스가 정한 꼴) */
const TOKEN_RES: RegExp[] = [
  /\bhf_[A-Za-z0-9]{8,}/g, // Hugging Face
  /\bsk-[A-Za-z0-9_-]{8,}/g, // Anthropic, OpenAI (sk-ant-, sk-proj-)
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bxox[abposre]-[A-Za-z0-9-]{8,}/g, // Slack
  /\bxapp-[A-Za-z0-9-]{8,}/g,
  /\bglpat-[A-Za-z0-9_-]{8,}/g, // GitLab
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google API
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /\bya29\.[\w-]{10,}/g, // Google 접근 토큰
  /(?<![\w/])1\/\/0[\w-]{10,}/g, // Google 새로 받기 토큰
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, // PEM 개인 키
];

/**
 * 이름 없는 긴 비밀: 대소문자, 숫자가 섞인 40자 넘는 덩어리(base64, 무작위 토큰).
 * 슬래시는 넣지 않는다 (긴 경로를 통째로 지우지 않게). 해시(16진수만) 같은 것은 둔다
 */
const BLOB_RE = /(?<![\w+-])[A-Za-z0-9_+-]{40,}={0,2}(?![\w+-])/g;
const looksSecretBlob = (s: string) => /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);

/** "Bearer 값", "Basic 값" */
const AUTH_SCHEME_RE = /\b(Bearer|Basic|Token)\s+(?!<)[A-Za-z0-9._~+/=-]{6,}/gi;

/** 비밀을 뜻하는 키 다음 값: token=..., "password": "...", api_key: ..., Authorization: ... */
// 키 앞 덧붙은 낱말은 40자까지만 본다 (a-a-a-… 같은 긴 줄에서 시작점마다 끝까지 훑어 느려졌다).
// 따옴표로 시작한 값은 닫는 따옴표까지 통째로 (공백, & 가 든 비밀번호가 반만 가려졌다)
const KEY_VALUE_RE =
  /(?<![\w-])([\w-]{0,40}?(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|apikey|auth(?:orization)?|signature|sig|credential|session[_-]?id|sid|auth[_-]?code|oauth[_-]?code)s?)(["']?\s*[:=]\s*)(?:"([^"\n]*)"|'([^'\n]*)'|(?!<)([^\s"'&,;}<>]+))/gi;

/** 쿠키는 줄 끝까지 (; 로 이어진 다른 쿠키도) */
const COOKIE_RE = /\b((?:set-)?cookie)(["']?\s*[:=]\s*)[^\n]+/gi;

/** 주소 밖에 나온 OAuth 코드 (code=4/0A…) */
const OAUTH_CODE_RE = /\b(code)(\s*[:=]\s*)(4\/[\w-]{10,})/g;

/** 주소: 스킴://나머지. 공백, 따옴표, 꺾쇠, 역따옴표에서 끊는다 */
const URL_RE = /\b([a-z][a-z0-9+.-]{1,15}):\/\/([^\s'"<>`]+)/gi;

// 시작을 낱말 경계에 묶고 길이를 64자로 막는다: 긴 글자 줄에서 시작점마다 끝까지 훑어 메인이 멈췄다 (4000자 줄 20개에 0.6초).
// 한글 같은 글자의 주소(김철수@회사.kr)와 localhost 도
const EMAIL_RE =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}(?:\.\p{L}{2,}|(?<=@localhost))/gu;
const EMAIL_ENCODED_RE =
  /(?<![A-Za-z0-9._%+-])(?:[A-Za-z0-9._+-]|%2B){1,64}%40[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,}/gi;

const IPV4_RE = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g;
const IPV6_RE = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;

/** 다른 사람 홈 폴더의 이름 (log-file.ts redactLine 과 같은 꼴, JSON 의 겹 역슬래시 포함) */
const OTHER_HOME_RE = /(\/Users\/|\/home\/|[A-Za-z]:\\+Users\\+)(?!<user>)[^/\\\s'"`:)]+/gi;

/** 경로 조각이 아이디나 비밀처럼 보이는지: 24자 넘고 글자와 숫자가 섞였다 */
const looksLikeId = (seg: string) =>
  seg.length >= 24 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg);

/** 끝에 붙은 문장 부호, 짝 없는 닫는 괄호는 주소가 아니다 */
function splitTail(url: string): [string, string] {
  let u = url;
  let tail = '';
  for (;;) {
    const last = u.at(-1);
    if (!last) break;
    if (/[.,!?;:]/.test(last)) {
      tail = last + tail;
      u = u.slice(0, -1);
      continue;
    }
    const open = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : undefined;
    if (open && u.split(last).length > u.split(open).length) {
      tail = last + tail;
      u = u.slice(0, -1);
      continue;
    }
    break;
  }
  return [u, tail];
}

function redactUrl(scheme: string, rest: string, bump: () => void): string {
  const lower = scheme.toLowerCase();
  const cut = rest.search(/[/?#]/);
  let authority = cut < 0 ? rest : rest.slice(0, cut);
  let after = cut < 0 ? '' : rest.slice(cut);
  // 아이디:비번@ 은 뗀다
  const at = authority.lastIndexOf('@');
  if (at >= 0) {
    authority = `<secret>@${authority.slice(at + 1)}`;
    bump();
  }
  const hashAt = after.indexOf('#');
  let fragment = '';
  if (hashAt >= 0) {
    // 빈 # 은 그대로 (이미 가린 글을 다시 넣어도 같게)
    fragment = hashAt < after.length - 1 ? '#<redacted>' : '#';
    if (fragment !== '#') bump();
    after = after.slice(0, hashAt);
  }
  const qAt = after.indexOf('?');
  let query = '';
  if (qAt >= 0) {
    query = qAt < after.length - 1 ? '?<redacted>' : '?';
    if (query !== '?') bump();
    after = after.slice(0, qAt);
  }
  const calendar =
    lower === 'webcal' ||
    lower === 'webcals' ||
    /\.ics\b/i.test(after) ||
    /\/ical\b|\/(?:public-)?calendars?\b/i.test(after) ||
    /calendar/i.test(authority);
  if (calendar && after.length > 1) {
    bump();
    return `${scheme}://${authority}/<calendar>`;
  }
  const path = after
    .split('/')
    .map((seg) => {
      if (!looksLikeId(seg)) return seg;
      bump();
      return '<id>';
    })
    .join('/');
  return `${scheme}://${authority}${path}${query}${fragment}`;
}

const isLocalV4 = (a: number, b: number, c: number, d: number) =>
  a === 127 || (a === 0 && b === 0 && c === 0 && d === 0);

/** 진단 기록 글을 가린다. 이미 가린 <...> 는 다시 세지 않는다 (두 번 거쳐도 같은 글) */
export function redactLogDetail(text: string, o: RedactOptions = {}): Redacted {
  let count = 0;
  const bump = () => {
    count++;
  };
  // 맥 파일 이름은 NFD(자모가 갈라진 한글)로 올 수 있어 NFC 로 맞추고, JSON 이 슬래시를 \/ 로 쓴 것도 / 로 본다
  // (그대로면 주소, 홈 폴더 규칙을 비켜 갔다)
  let out = text.normalize('NFC').replace(/\\\//g, '/');

  // 1. 사용자 글 그대로: 긴 것부터 (짧은 것이 긴 것의 일부를 먼저 지우지 않게). 대소문자, 띄어쓰기 수는 가리지 않는다
  const secrets = [
    ...new Set(
      (o.secrets ?? []).map((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).filter(longEnough),
    ),
  ].sort((a, b) => b.length - a.length);
  if (secrets.length > 0) {
    const re = new RegExp(secrets.map((s) => escapeRe(s).replace(/ /g, '\\s+')).join('|'), 'giu');
    out = out.replace(re, () => {
      bump();
      return '<private>';
    });
  }

  // 2. 홈 폴더: 그대로, 역슬래시가 겹친(JSON) 꼴, 슬래시를 바꾼 꼴. 윈도우는 대소문자를 가리지 않는다
  const home = o.home?.replace(/[\\/]+$/, '') ?? '';
  if (home.length > 3) {
    const variants = new Set([
      home,
      home.replace(/\\/g, '\\\\'),
      home.replace(/\\/g, '/'),
      home.replace(/\//g, '\\'),
    ]);
    for (const v of [...variants].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(escapeRe(v), /^[A-Za-z]:/.test(home) ? 'gi' : 'g');
      out = out.replace(re, () => {
        bump();
        return '~';
      });
    }
  }
  out = out.replace(OTHER_HOME_RE, (_m, head: string) => {
    bump();
    return `${head}<user>`;
  });

  // 3. 주소 먼저: 쿼리를 통째로 가린다 (쿼리 속 토큰과 pwd=..#.. 를 따로 가리면 조각이 남는다)
  out = out.replace(URL_RE, (_m, scheme: string, rest: string) => {
    const [body, tail] = splitTail(rest);
    return redactUrl(scheme, body, bump) + tail;
  });
  // 4. 토큰 (주소 경로 속 토큰도 여기서)
  for (const re of TOKEN_RES)
    out = out.replace(re, () => {
      bump();
      return '<secret>';
    });
  out = out.replace(AUTH_SCHEME_RE, (_m, scheme: string) => {
    bump();
    return `${scheme} <secret>`;
  });
  out = out.replace(COOKIE_RE, (_m, key: string, sep: string) => {
    bump();
    return `${key}${sep}<secret>`;
  });
  out = out.replace(OAUTH_CODE_RE, (_m, key: string, sep: string) => {
    bump();
    return `${key}${sep}<secret>`;
  });
  out = out.replace(KEY_VALUE_RE, (m, key: string, sep: string, dq?: string, sq?: string) => {
    // 이미 가린 값은 다시 세지 않는다
    if ((dq ?? sq ?? '').startsWith('<')) return m;
    bump();
    if (dq !== undefined) return `${key}${sep}"<secret>"`;
    if (sq !== undefined) return `${key}${sep}'<secret>'`;
    return `${key}${sep}<secret>`;
  });
  out = out.replace(BLOB_RE, (m) => {
    if (!looksSecretBlob(m)) return m;
    bump();
    return '<secret>';
  });

  // 5. 이메일
  for (const re of [EMAIL_RE, EMAIL_ENCODED_RE])
    out = out.replace(re, () => {
      bump();
      return '<email>';
    });

  // 6. IP
  out = out.replace(IPV4_RE, (m, a: string, b: string, c: string, d: string) => {
    const [w, x, y, z] = [a, b, c, d].map(Number) as [number, number, number, number];
    if (w > 255 || x > 255 || y > 255 || z > 255) return m;
    if (isLocalV4(w, x, y, z)) return m;
    bump();
    return '<ip>';
  });
  out = out.replace(IPV6_RE, (m) => {
    const colons = m.split(':').length - 1;
    // 시각(12:34:56)과 줄:칸(:10:3)을 IP 로 보지 않는다: :: 이 있거나 칸이 여덟이어야 한다
    if (!(m.includes('::') || colons === 7)) return m;
    if (m === '::' || m === '::1' || !/[0-9a-f]/i.test(m.replace(/^::1?$/, ''))) return m;
    bump();
    return '<ip>';
  });

  // 7. 컴퓨터 이름, 사용자 이름 (낱말로 있을 때만)
  const host = o.host?.trim() ?? '';
  const hostBase = host.replace(/\.local$/i, '');
  for (const h of [host, hostBase]) {
    if (h.length < 3 || h.toLowerCase() === 'localhost') continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(h)}(?![\\p{L}\\p{N}_-])`, 'giu'), () => {
      bump();
      return '<host>';
    });
  }
  const user = o.user?.trim() ?? '';
  if (user.length >= 2) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_<])${escapeRe(user)}(?![\\p{L}\\p{N}_>])`, 'giu'), () => {
      bump();
      return '<user>';
    });
  }

  return { text: out, count };
}

export function redactLog(text: string, o: RedactOptions = {}): string {
  return redactLogDetail(text, o).text;
}

/** 진단 기록 글 상한: 최근 200줄, 64KB */
export const DIAG_MAX_LINES = 200;
export const DIAG_MAX_BYTES = 64 * 1024;

/**
 * 글의 끝 쪽 줄만 남긴다: maxLines 줄, 합쳐 maxBytes(UTF-8) 이하. 앞에서부터 덜어 낸다.
 * 한 줄이 maxBytes 보다 길면 그 줄의 끝 쪽만 둔다.
 */
export function tailLines(text: string, maxLines = DIAG_MAX_LINES, maxBytes = DIAG_MAX_BYTES): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const kept = lines.slice(-maxLines);
  const enc = new TextEncoder();
  const size = (l: string) => enc.encode(l).length + 1;
  let bytes = kept.reduce((n, l) => n + size(l), 0);
  while (kept.length > 1 && bytes > maxBytes) {
    bytes -= size(kept.shift() as string);
  }
  if (kept.length === 1 && bytes > maxBytes) {
    const buf = enc.encode(kept[0]);
    // 글자 중간에서 자르면 깨진 글자가 남는다. 앞의 잘린 글자는 버린다
    kept[0] = new TextDecoder().decode(buf.subarray(buf.length - (maxBytes - 1))).replace(/^\uFFFD+/, '');
  }
  return kept;
}
