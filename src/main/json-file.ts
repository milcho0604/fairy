// 작은 JSON 저장 파일을 쓰고 읽는 한 곳 (2026-10-11 데이터 점검). Electron 없이 돌아 시험에서 그대로 부른다.
// store.ts(설정, 플래너, 채팅 설정 등), hf-token.ts, gcal.ts 토큰이 모두 이것으로 쓴다.
// - 쓰기: 같은 폴더 임시 파일에 쓰고 fsync → 이름 바꾸기 → 폴더 fsync. 쓰다가 전원이 나가도 옛 파일이나 새 파일 둘 중
//   하나가 온전히 남는다 (fsync 없이 이름만 바꾸면 일부 파일 시스템은 빈 파일을 남긴다).
// - 읽기: 깨진 파일(JSON 이 아님)은 지우지 않고 <이름>-broken-<시각>.json 으로 옆에 두고, 마지막으로 잘 읽은
//   복사본(<이름>.json.bak)이 있으면 그것으로 되살린다. 조용히 기본값으로 돌아가지 않고 부르는 쪽이 알린다.
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { writeFileAtomic } from './safe-file.ts';

/** 깨진 JSON 을 만난 일. moved 는 옆에 옮긴 파일, restored 면 .bak 으로 되살렸다 */
export interface JsonTrouble {
  file: string;
  moved: string;
  restored: boolean;
}

/** 임시 파일에 쓰고 fsync → 이름 바꾸기 → 폴더 fsync (safe-file.ts writeFileAtomic). 폴더가 없으면 만든다 */
export function writeFileDurable(
  path: string,
  data: string | Uint8Array,
  opts: { mode?: number } = {},
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, data, opts);
}

/** JSON 으로 저장한다 (사람이 열어 볼 수 있게 들여쓰기) */
export function writeJsonFile(path: string, value: unknown, opts: { mode?: number } = {}): void {
  writeFileDurable(path, JSON.stringify(value, null, 2), opts);
}

const stampOf = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** settings.json → settings-broken-20261011-093000.json (겹치면 -2, -3) */
export function brokenName(path: string, at: number): string {
  const dir = dirname(path);
  const base = basename(path).replace(/\.json$/, '');
  let out = join(dir, `${base}-broken-${stampOf(at)}.json`);
  for (let i = 2; existsSync(out); i++) out = join(dir, `${base}-broken-${stampOf(at)}-${i}.json`);
  return out;
}

export const bakOf = (path: string) => `${path}.bak`;

const isContainer = (v: unknown): boolean => typeof v === 'object' && v !== null;

function parseText(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * JSON 을 읽는다. 없으면 value 없음. 깨졌으면 옆으로 옮기고 trouble 을 같이 돌려준다.
 * keepBak 이면 잘 읽은 내용을 .bak 에 남기고(바뀐 때만), 깨졌을 때 .bak 으로 되살려 원래 자리에 다시 쓴다.
 * 읽을 권한이 없는 것처럼 깨진 게 아닌 오류는 옮기지 않고 value 없음으로 (파일을 건드리지 않는다).
 */
export function readJsonFile(
  path: string,
  opts: { keepBak?: boolean; now?: number } = {},
): { value?: unknown; trouble?: JsonTrouble } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const parsed = parseText(text);
  // 복사본을 두는 파일(설정, 플래너 등)은 늘 객체나 배열이다. JSON 이어도 null, 글, 수면 깨진 것으로 본다:
  // 예전에는 그대로 "잘 읽음"으로 보아 좋은 .bak 을 그 값으로 덮고 설정을 기본으로 돌렸다 (버그잡이 4)
  if (parsed.ok && (!opts.keepBak || isContainer(parsed.value))) {
    if (opts.keepBak) {
      try {
        const bak = bakOf(path);
        const old = existsSync(bak) ? readFileSync(bak, 'utf8') : undefined;
        if (old !== text) writeFileDurable(bak, text, { mode: 0o600 });
      } catch {
        // 복사본을 못 남겨도 읽기는 된다
      }
    }
    return { value: parsed.value };
  }
  let moved: string;
  try {
    moved = brokenName(path, opts.now ?? Date.now());
    renameSync(path, moved);
  } catch {
    // 옮기지 못하면(잠김) 덮어쓰지 않게 그대로 두고 값 없음으로. 다음 저장이 덮을 수 있지만 알린다
    return { trouble: { file: path, moved: path, restored: false } };
  }
  if (opts.keepBak) {
    try {
      const bakText = readFileSync(bakOf(path), 'utf8');
      const bak = parseText(bakText);
      if (bak.ok && isContainer(bak.value)) {
        writeFileDurable(path, bakText);
        return { value: bak.value, trouble: { file: path, moved, restored: true } };
      }
    } catch {
      // 복사본이 없거나 못 읽으면 새로 시작
    }
  }
  return { trouble: { file: path, moved, restored: false } };
}
