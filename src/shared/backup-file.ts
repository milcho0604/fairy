// 개인 백업 파일(.fairybackup, 속은 zip). 기획서 7절 "개인 백업 파일", 이슈 #90.
// 머리 파일 모양과 믿지 않는 입력(남이 준 파일, 깨진 파일) 검사를 둔다. 쓰고 읽기는 메인의 backup-zip.ts 가 한다.

/** 백업 파일 확장자 */
export const BACKUP_FILE_EXT = '.fairybackup';
/** 머리 파일 판. 안의 모양이 바뀌면 올린다. 이 앱보다 높은 판은 "앱을 업데이트해 줘" */
export const BACKUP_FORMAT = 1;
/** zip 맨 위의 머리 파일 이름 */
export const BACKUP_HEADER = 'fairy-backup.json';
/** 머리 파일 안 format 값 (다른 zip 을 백업으로 잘못 읽지 않게) */
const FORMAT_TAG = 'fairybackup';

/**
 * 받아들이는 상한. 운영자 데이터 기준 저장 파일 128KB, 그림 1MB 쯤이라(기획서 7절) 넉넉하게 잡고,
 * 넘으면 풀기 전에 거른다 (작은 파일이 풀면 수 GB 가 되는 zip 폭탄, 항목 수십만 개로 앱 멈추기)
 */
export const BACKUP_LIMITS = {
  /** zip 파일 자체 크기 */
  fileBytes: 1024 * 1024 * 1024,
  /** 풀었을 때 모든 항목 크기 합 */
  totalBytes: 1024 * 1024 * 1024,
  /** 항목 수 (머리 파일 포함) */
  entries: 5000,
  /** 머리 파일 크기 */
  headerBytes: 4 * 1024 * 1024,
  /** 항목 경로 길이 */
  nameLength: 240,
} as const;

export interface BackupEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupHeader {
  format: typeof FORMAT_TAG;
  version: number;
  /** 만든 앱 판 (보여 주기만 한다) */
  app: string;
  /** 만든 때 (ms) */
  at: number;
  entries: BackupEntry[];
}

export function makeHeader(app: string, at: number, entries: BackupEntry[]): BackupHeader {
  return { format: FORMAT_TAG, version: BACKUP_FORMAT, app, at, entries };
}

/** 머리 파일 검사. 더 새 판이면 newer (그 판의 다른 칸은 모를 수 있어 판만 본다) */
export function parseBackupHeader(
  raw: unknown,
): { ok: true; header: BackupHeader } | { ok: false; reason: 'bad' | 'newer' } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'bad' };
  const h = raw as Record<string, unknown>;
  if (h.format !== FORMAT_TAG) return { ok: false, reason: 'bad' };
  if (typeof h.version !== 'number' || !Number.isInteger(h.version) || h.version < 1)
    return { ok: false, reason: 'bad' };
  if (h.version > BACKUP_FORMAT) return { ok: false, reason: 'newer' };
  if (!Array.isArray(h.entries) || h.entries.length >= BACKUP_LIMITS.entries)
    return { ok: false, reason: 'bad' };
  const entries: BackupEntry[] = [];
  for (const e of h.entries as unknown[]) {
    if (typeof e !== 'object' || e === null) return { ok: false, reason: 'bad' };
    const { path, size, sha256 } = e as Record<string, unknown>;
    if (typeof path !== 'string' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))
      return { ok: false, reason: 'bad' };
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)
      return { ok: false, reason: 'bad' };
    entries.push({ path, size, sha256 });
  }
  const app = typeof h.app === 'string' ? h.app.slice(0, 40) : '';
  const at = typeof h.at === 'number' && Number.isFinite(h.at) && h.at > 0 ? h.at : 0;
  return { ok: true, header: { format: FORMAT_TAG, version: h.version, app, at, entries } };
}

/**
 * zip 항목 경로가 풀어도 되는 것인지. 맨 위는 topLevel 에 든 이름만, 그 밖은 pets/ 아래만.
 * 절대 경로, 역슬래시, 드라이브 글자(:), 빈 칸이나 . 과 .. 칸, 숨은 파일, 제어 글자는 모두 거른다
 */
export function entryNameOk(name: string, topLevel: readonly string[]): boolean {
  if (name.length === 0 || name.length > BACKUP_LIMITS.nameLength) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 글자를 거르려는 것
  if (/[\\:\u0000-\u001f\u007f]/.test(name)) return false;
  const parts = name.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return false;
  if (parts.length === 1) return name === BACKUP_HEADER || topLevel.includes(name);
  return parts[0] === 'pets';
}

/** 날짜 칸 (파일 이름용, 그 컴퓨터 시각) */
export function backupDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 백업 파일로 읽을 이름인지 (대소문자 무시) */
export const isBackupFileName = (name: string): boolean => name.toLowerCase().endsWith(BACKUP_FILE_EXT);

/** 명령줄에서 백업 파일 경로 (윈도우, 리눅스에서 두 번 눌러 연 것). 첫 인자와 스위치는 뺀다 */
export function backupFileFromArgv(argv: readonly string[]): string | undefined {
  return argv
    .slice(1)
    .find(
      (a) =>
        typeof a === 'string' &&
        !a.startsWith('-') &&
        a.length < 4096 &&
        !a.includes('\0') &&
        isBackupFileName(a),
    );
}
