// 의견 보내기에 진단 기록 붙이기 (설정의 베타 기록 칸, 사용자가 켤 때만).
// 기록을 읽어 가리는 일은 모두 여기(메인)에서 한다. 화면에는 가린 글만 넘기고,
// 복사와 저장은 화면이 보여 준 바로 그 글(마지막 미리 보기)을 쓴다: 미리 본 것과 나가는 것이 같다.
import { readFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { app, type BrowserWindow, clipboard, dialog } from 'electron';
import { feedbackText } from '../shared/feedback.ts';
import { t } from '../shared/i18n/index.ts';
import { DIAG_MAX_BYTES, DIAG_MAX_LINES, redactLogDetail, tailLines } from '../shared/redact-log.ts';
import { localDay } from '../shared/todo-store.ts';
import { writeFileAtomic } from './safe-file.ts';

export interface DiagnosticsPreview {
  text: string;
  lines: number;
  hidden: number;
}

/** 읽지 못하면 빈 글 (아직 기록이 없거나 지워졌다) */
function readOr(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

export function createDiagnostics(o: {
  logDir: string;
  /** 베타 기록 글 (reportText) */
  statsText: () => string;
  /** 글자 그대로 가릴 사용자 글: 할 일, 일정, 메모 제목, 캘린더 주소 */
  secrets: () => string[];
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let last: DiagnosticsPreview | undefined;

  function preview(): DiagnosticsPreview {
    // 돌린 앞 파일(main.old.log) 다음에 지금 파일: 끝 쪽 줄만 쓰니 둘을 이어 붙여 자른다
    const raw = readOr(join(o.logDir, 'main.old.log')) + readOr(join(o.logDir, 'main.log'));
    let secrets: string[] = [];
    try {
      secrets = o.secrets();
    } catch {
      // 저장 파일을 못 읽어도 나머지 규칙으로 가린다
    }
    // 줄 단위로 넉넉히(줄 수 두 배, 바이트 네 배) 먼저 잘라 가리는 양을 묶는다 (2MB 를 통째로 가리면 메인이 오래 멈출 수 있다).
    // 줄 단위라 토큰 반쪽이 남지 않는다. 가린 뒤 정해진 상한으로 다시 자른다
    const near = tailLines(raw, DIAG_MAX_LINES * 2, DIAG_MAX_BYTES * 4).join('\n');
    const r = redactLogDetail(near, { home: homedir(), user: safeUser(), host: hostname(), secrets });
    const lines = tailLines(r.text);
    // 가린 곳 수는 남긴 줄 안에서 다시 센다 (잘려 나간 줄의 것은 빼고)
    const hidden = lines.reduce(
      (n, l) => n + (l.match(/<(?:private|user|host|secret|redacted|calendar|id|email|ip)>/g)?.length ?? 0),
      0,
    );
    last = { text: feedbackText(o.statsText(), lines, hidden), lines: lines.length, hidden };
    return last;
  }

  /** 마지막 미리 보기를 그대로 복사. 미리 보기가 없으면 복사하지 않는다 (보지 않은 글이 나가지 않게) */
  function copy(): boolean {
    if (!last) return false;
    try {
      clipboard.writeText(last.text);
      o.log('feedback', '진단 기록 복사', last.lines);
      return true;
    } catch {
      return false;
    }
  }

  async function save(win?: BrowserWindow): Promise<{ ok: boolean; message: string }> {
    if (!last) return { ok: false, message: t('feedback.saveFailed') };
    const text = last.text;
    const opts = {
      title: t('feedback.saveTitle'),
      defaultPath: join(app.getPath('downloads'), t('feedback.fileName', { day: localDay(Date.now()) })),
      filters: [{ name: t('feedback.fileType'), extensions: ['txt'] }],
    };
    const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts));
    if (r.canceled || !r.filePath) return { ok: false, message: '' };
    try {
      writeFileAtomic(r.filePath, text);
      o.log('feedback', '진단 기록 저장');
      return { ok: true, message: t('feedback.saved', { file: r.filePath }) };
    } catch (err) {
      o.log('feedback', '저장 실패', err instanceof Error ? err.message : String(err));
      return { ok: false, message: t('feedback.saveFailed') };
    }
  }

  return { preview, copy, save };
}
