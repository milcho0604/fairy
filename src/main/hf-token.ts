// 무료 Hugging Face 토큰 (AI 일러스트, 선택). 캘린더 비밀 주소처럼 이 컴퓨터에만 두되, 설정 파일과 따로 둔다:
// 설정은 통째로 설정 창에 가고 백업에도 들어가서. 이 파일은 백업 목록(backup.ts FILES)에 없고, 창에는 있는지만 알린다.
// 기록에 남기지 않는다.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { cleanHfToken } from '../shared/illustrate.ts';

const file = () => join(app.getPath('userData'), 'hf-token.json');

let cached: string | undefined | null = null;

export const hfToken = {
  get(): string | undefined {
    if (cached !== null) return cached;
    try {
      const v = JSON.parse(readFileSync(file(), 'utf8')) as { token?: unknown };
      cached = cleanHfToken(v.token);
    } catch {
      cached = undefined;
    }
    return cached;
  },
  has(): boolean {
    return !!hfToken.get();
  },
  /** 넣기 (모양이 틀리면 false), null 이면 지우기. 나만 읽을 수 있게 (0600) */
  set(raw: unknown): boolean {
    if (raw === null) {
      rmSync(file(), { force: true });
      cached = undefined;
      return true;
    }
    const token = cleanHfToken(raw);
    if (!token) return false;
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file(), JSON.stringify({ token }), { mode: 0o600 });
    // mode 는 새로 만들 때만 먹는다. 이미 있던 파일도 나만 읽게
    chmodSync(file(), 0o600);
    cached = token;
    return true;
  },
};
