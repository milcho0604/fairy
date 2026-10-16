// 도움 보내기 진단 묶음의 머리 (이슈 #126). 앱 판, 운영체제, 켜진 기능 요약, AI 감지, 서버 연결 상태.
// 여기 모으는 것은 이미 비밀이 아닌 것만이다: 서버 주소, 토큰, 닉네임, 할 일, 메모, 일정, 대화 글은 아예 받지 않는다.
// 이 글도 최종적으로 redactLogDetail 을 한 번 더 거친다 (main/diagnostics.ts).
import type { DetectRow } from './ai/capability.ts';
import { feedbackText } from './feedback.ts';
import { t } from './i18n/index.ts';
import {
  DIAG_MAX_BYTES,
  DIAG_MAX_LINES,
  type RedactOptions,
  redactLogDetail,
  tailLines,
} from './redact-log.ts';
import type { ServerStatus } from './server-account.ts';
import type { Settings } from './settings.ts';

/** 켜짐 꺼짐만 적는 설정 (이름과 값이 모두 비밀이 아닌 것). 사용자 글이 든 설정(규칙, 기억, 주소 등)은 넣지 않는다 */
export const HELP_FLAGS = [
  'wander',
  'aiIsolation',
  'aiKnowsTodos',
  'aiPetTools',
  'myMcp',
  'diaryAi',
  'sysMonitor',
  'osNotify',
  'dailyNotes',
  'typeAlong',
  'sounds',
  'boost',
  'updateCheck',
  'lookAtCursor',
  'launchAtLogin',
  'readAloud',
  'urlScheme',
] as const satisfies readonly (keyof Settings)[];

export interface HelpFacts {
  version: string;
  packaged: boolean;
  /** "macOS 15.1 arm64" 꼴 (판과 칩까지만) */
  os: string;
  arch: string;
  /** 실제 화면 말 */
  lang: string;
  electron: string;
  /** 쓰는 AI 이름 (설정이 아니라 지금 채팅이 고른 것) */
  provider: string;
  settings: Pick<Settings, (typeof HELP_FLAGS)[number] | 'persona' | 'petKind' | 'lang'>;
  detect: readonly DetectRow[];
  /** 서버 연결 상태. 서버 주소가 없는 판이면 undefined */
  server?: Pick<
    ServerStatus,
    'enabled' | 'on' | 'device' | 'signedIn' | 'problem' | 'pending' | 'lastSyncAt' | 'ai' | 'code'
  >;
  now: number;
}

const yn = (b: boolean) => (b ? t('help.pack.on') : t('help.pack.off'));

/** 서버 연결 상태 한 줄. 주소와 토큰은 받지도 않는다 */
export function serverLine(s: HelpFacts['server'], now: number): string {
  if (!s?.enabled) return t('help.pack.serverNone');
  if (!s.on) return t('help.pack.serverOff');
  const sync = s.lastSyncAt
    ? t('help.pack.minutesAgo', { n: Math.max(0, Math.round((now - s.lastSyncAt) / 60_000)) })
    : t('help.pack.never');
  return t('help.pack.serverOn', {
    login: s.signedIn
      ? t('help.pack.google')
      : s.device
        ? t('help.pack.deviceOnly')
        : t('help.pack.noAccount'),
    problem: s.problem ?? t('help.pack.none'),
    pending: s.pending,
    sync,
    ai: yn(s.ai),
  });
}

/** 진단 묶음 머리 줄들 */
export function helpSummary(f: HelpFacts): string[] {
  const flags = HELP_FLAGS.map((k) => `${k}=${f.settings[k] ? 1 : 0}`).join(' ');
  return [
    t('help.pack.title'),
    `${t('help.pack.app')}: ${f.version} (${f.packaged ? t('help.pack.packaged') : t('help.pack.dev')})`,
    `${t('help.pack.os')}: ${f.os}`,
    `${t('help.pack.arch')}: ${f.arch}, Electron ${f.electron}`,
    `${t('help.pack.lang')}: ${f.lang} (${f.settings.lang})`,
    `${t('help.pack.pet')}: ${f.settings.petKind}, ${f.settings.persona}`,
    `${t('help.pack.ai')}: ${f.detect.map((r) => `${r.id}=${r.state}`).join(' ')} (${t('help.pack.chosen')}: ${f.provider})`,
    `${t('help.pack.server')}: ${serverLine(f.server, f.now)}`,
    ...(f.server?.code ? [`${t('help.pack.code')}: ${f.server.code}`] : []),
    `${t('help.pack.flags')}: ${flags}`,
    '',
  ];
}

export interface HelpPack {
  text: string;
  lines: number;
  hidden: number;
}

/** 가린 자리 표시 (redact-log.ts 가 쓰는 꼴). 남은 줄 안에서 센다 */
const HIDDEN_RE = /<(?:private|user|host|secret|redacted|calendar|id|email|ip|meeting|rrn|phone)>/g;

/**
 * 보낼 글 한 벌을 만든다: 머리(판, 운영체제, 기능, 서버, AI) + 베타 기록 + 가린 최근 기록.
 * 모든 것이 redactLogDetail 을 거친다 (사용자 글 그대로, 홈 경로, 주소, 토큰, 이메일, IP 등).
 * 미리 보기와 복사, 저장이 이 글 하나를 같이 쓴다 (main/diagnostics.ts)
 */
export function buildHelpPack(i: {
  summary: readonly string[];
  stats: string;
  rawLog: string;
  redact: RedactOptions;
}): HelpPack {
  // 줄 단위로 넉넉히(줄 수 두 배, 바이트 네 배) 먼저 잘라 가리는 양을 묶는다 (2MB 를 통째로 가리면 메인이 오래 멈출 수 있다).
  // 줄 단위라 토큰 반쪽이 남지 않는다. 가린 뒤 정해진 상한으로 다시 자른다
  const near = tailLines(i.rawLog, DIAG_MAX_LINES * 2, DIAG_MAX_BYTES * 4).join('\n');
  const log = redactLogDetail(near, i.redact);
  const lines = tailLines(log.text);
  const head = redactLogDetail(i.summary.join('\n'), i.redact).text;
  const stats = redactLogDetail(i.stats, i.redact).text;
  const hidden = [head, stats, ...lines].reduce((n, l) => n + (l.match(HIDDEN_RE)?.length ?? 0), 0);
  return { text: [head, feedbackText(stats, lines, hidden)].join('\n'), lines: lines.length, hidden };
}
