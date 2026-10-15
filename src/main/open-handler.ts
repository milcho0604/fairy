import { resolve } from 'node:path';
import { app } from 'electron';
import { backupFileFromArgv, isBackupFileName } from '../shared/backup-file.ts';
import {
  isImportFileName,
  isZipFileName,
  petFileFromArgv,
  URL_SCHEMES,
  urlFromArgv,
} from '../shared/url-scheme.ts';

/**
 * 밖에서 페어리에 넘겨주는 것: fairy:// 주소(단축어, Raycast 등, 예전 jjakkung:// 도)와 .fairy 파일(두 번 눌러 열기, 예전 .jjpet 도),
 * Codex 펫 파일(.codex-pet.zip, 맥은 zip 을 "다음으로 열기" 로 고른 것도), 백업 파일 .fairybackup (두 번 눌러 복원, 이슈 #90).
 * - 맥: open-url, open-file 사건. 앱이 꺼져 있다가 이것으로 켜지면 ready 전에 오므로 이 파일을 불러올 때 바로 듣고 모아 둔다
 * - 윈도우, 리눅스: 명령줄 인자. 처음 켤 때는 process.argv, 이미 떠 있으면 second-instance 의 argv
 * 받는 쪽(index.ts)이 준비되면 start 로 넘겨 모아 둔 것을 차례로 처리한다.
 * 운영체제에 주소를 등록하는 것은 설치판만 한다: 개발, 시험 실행(JJ_USER_DATA)이 설치한 페어리의 주소를 가로채지 않게
 */
export type Incoming =
  | { kind: 'url'; url: string }
  | { kind: 'petFile'; path: string }
  | { kind: 'backupFile'; path: string };

let sink: ((item: Incoming) => void) | undefined;
const waiting: Incoming[] = [];
/** 모아 두는 상한 (켜지기 전에 주소가 쏟아져도 메모리가 늘지 않게) */
const WAIT_MAX = 16;

function deliver(item: Incoming) {
  if (sink) sink(item);
  else if (waiting.length < WAIT_MAX) waiting.push(item);
}

/** 명령줄 인자에서 우리 것을 찾는다. 있으면 true (second-instance 가 펫만 다시 부르지 않게) */
export function takeArgv(argv: readonly string[], cwd?: string): boolean {
  const url = urlFromArgv(argv);
  if (url) {
    deliver({ kind: 'url', url });
    return true;
  }
  const file = petFileFromArgv(argv);
  if (file) {
    deliver({ kind: 'petFile', path: cwd ? resolve(cwd, file) : resolve(file) });
    return true;
  }
  const backupFile = backupFileFromArgv(argv);
  if (backupFile) {
    deliver({ kind: 'backupFile', path: cwd ? resolve(cwd, backupFile) : resolve(backupFile) });
    return true;
  }
  return false;
}

/** 이 파일을 불러올 때 한 번: 맥 사건은 ready 전에도 온다 */
export function listenEarly(): void {
  app.on('open-url', (e, url) => {
    e.preventDefault();
    deliver({ kind: 'url', url });
  });
  app.on('open-file', (e, path) => {
    e.preventDefault();
    // zip 은 맥에서 "다음으로 열기" 목록에만 올린다(electron-builder.yml, 기본 앱은 그대로). 고른 zip 은 안을 보고 판단한다
    if (isImportFileName(path) || isZipFileName(path)) deliver({ kind: 'petFile', path });
    else if (isBackupFileName(path)) deliver({ kind: 'backupFile', path });
  });
}

/** 운영체제에 fairy:// 와 예전 jjakkung:// 를 이 앱으로 등록한다 (설치판만, 이미 됐으면 그대로) */
export function registerScheme(log: (tag: string, ...rest: unknown[]) => void): void {
  if (!app.isPackaged || process.env.JJ_USER_DATA) return;
  for (const scheme of URL_SCHEMES)
    try {
      if (!app.isDefaultProtocolClient(scheme)) {
        const ok = app.setAsDefaultProtocolClient(scheme);
        log('url', '주소 등록', scheme, ok);
      }
    } catch (err) {
      log('url', '주소 등록 실패', scheme, err instanceof Error ? err.message : String(err));
    }
}

/** 받는 쪽이 준비됐다. 처음 켤 때 받은 인자와 모아 둔 것을 넘긴다 */
export function startIncoming(handler: (item: Incoming) => void): void {
  sink = handler;
  takeArgv(process.argv);
  for (const item of waiting.splice(0)) handler(item);
}
