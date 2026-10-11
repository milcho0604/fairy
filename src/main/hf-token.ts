// 무료 Hugging Face 토큰 (AI 일러스트, 선택). 캘린더 비밀 주소처럼 이 컴퓨터에만 두되, 설정 파일과 따로 둔다:
// 설정은 통째로 설정 창에 가고 백업에도 들어가서. 이 파일은 백업 목록(backup.ts FILES)에 없고, 창에는 있는지만 알린다.
// 기록에 남기지 않는다. 운영체제 열쇠로 암호화할 수 있으면 암호화해 둔다 (secret-file.ts)
import { join } from 'node:path';
import { app } from 'electron';
import { cleanHfToken } from '../shared/illustrate.ts';
import { osCrypto } from './os-crypto.ts';
import { secretFile } from './secret-file.ts';

const file = () => secretFile(join(app.getPath('userData'), 'hf-token.json'), 'token', () => osCrypto);

let cached: string | undefined | null = null;

export const hfToken = {
  get(): string | undefined {
    if (cached !== null) return cached;
    const v = cleanHfToken(file().read());
    // 준비 전에는 암호를 못 풀 수 있다 (리눅스). 그때 읽은 "없음"은 기억하지 않는다
    if (app.isReady()) cached = v;
    return v;
  },
  has(): boolean {
    return !!hfToken.get();
  },
  /** 넣기 (모양이 틀리면 false), null 이면 지우기. 나만 읽을 수 있게 (0600) */
  set(raw: unknown): boolean {
    if (raw === null) {
      file().remove();
      cached = undefined;
      return true;
    }
    const token = cleanHfToken(raw);
    if (!token) return false;
    file().write(token);
    cached = token;
    return true;
  },
};
