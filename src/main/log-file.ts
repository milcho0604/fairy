// 설치판 진단 기록 (userData/logs/main.log). 설치판은 콘솔이 없어 문제가 생겨도 볼 것이 없었다.
// 파일 두 개로 돌린다: main.log 가 1MB 를 넘으면 main.old.log 로 바꾸고(앞 것은 지운다) 새로 쓴다. 합쳐 2MB 를 넘지 않는다.
// Electron 없이 돌아 시험에서 그대로 부른다.
//
// 남기지 않는 것: 질문 원문, 답, 할 일 제목, 일정 제목. 부르는 쪽(log 호출)이 아예 넘기지 않는다(2026-10-07 호출처 전수 확인).
// 오류 글과 쌓인 호출 기록에 섞여 오는 파일 경로의 사용자 이름은 여기서 가린다(redactLine).
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LOG_MAX_BYTES = 1_000_000;
/** 한 줄 상한. 큰 객체나 긴 호출 기록 하나가 파일을 다 채우지 않게 */
export const LOG_LINE_MAX = 4000;

/** 기록 한 칸을 글로. 오류는 호출 기록째, 객체는 JSON, 나머지는 String */
function part(v: unknown): string {
  if (v instanceof Error) return v.stack ?? v.message;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * 파일 경로 속 사용자 이름을 가린다. 홈 폴더는 ~ 로, 그 밖의 /Users/이름, /home/이름, C:\Users\이름 은 이름만 <user> 로.
 * 홈 폴더가 짧거나(/ 등) 비면 건너뛴다.
 */
export function redactLine(line: string, home: string): string {
  let out = line;
  if (home.length > 3) out = out.split(home).join('~');
  return out.replace(/(\/Users\/|\/home\/|[A-Za-z]:\\+Users\\+)[^/\\\s'"`:)]+/gi, '$1<user>');
}

/** 기록 한 줄: "시각 [태그] 내용". 줄바꿈은 그대로 두되(호출 기록) 줄 상한으로 자른다 */
export function formatLogLine(at: Date, tag: string, rest: readonly unknown[], home: string): string {
  const body = redactLine([`[${tag}]`, ...rest.map(part)].join(' '), home);
  const cut = body.length > LOG_LINE_MAX ? `${body.slice(0, LOG_LINE_MAX)}...(${body.length})` : body;
  return `${at.toISOString()} ${cut}\n`;
}

/**
 * dir 안 main.log 에 덧붙이는 함수를 만든다. 실패(디스크 가득, 권한)는 조용히 넘긴다: 기록 때문에 앱이 멈추면 안 된다.
 * 크기는 처음 한 번 재고 그 뒤로는 쓴 만큼 더해 센다(줄마다 stat 하지 않게).
 */
export function createLogFile(dir: string, home: string, maxBytes = LOG_MAX_BYTES) {
  const file = join(dir, 'main.log');
  const old = join(dir, 'main.old.log');
  let size = -1;
  return (tag: string, rest: readonly unknown[], at = new Date()) => {
    try {
      if (size < 0) {
        mkdirSync(dir, { recursive: true });
        try {
          size = statSync(file).size;
        } catch {
          size = 0;
        }
      }
      const line = formatLogLine(at, tag, rest, home);
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) {
        try {
          renameSync(file, old); // 있던 main.old.log 는 덮인다
        } catch {
          // 누가 main.log 를 지웠으면 바꿀 것이 없다. 새로 쓴다
        }
        size = 0;
      }
      appendFileSync(file, line);
      size += bytes;
    } catch {
      // 기록 실패는 무시한다
    }
  };
}
