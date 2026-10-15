// 서버 토큰 파일 (기기 토큰, 세션). secret-file.ts 와 달리 평문으로는 절대 두지 않는다 (서버 계정 정책):
// 운영체제 열쇠(safeStorage)로 암호화할 수 없으면 쓰기를 거절하고, 암호화하지 않은 파일은 읽지 않는다.
// 파일은 있는데 지금 열쇠로 풀지 못하면 unreadable: 부르는 쪽이 서버 모드를 쉬고 덮어쓰지 않는다.
// Electron 없이 시험하려고 암호화 장치를 받는다 (os-crypto.ts 가 실제 safeStorage).
import { readFileSync, rmSync } from 'node:fs';
import { writeFileDurable } from './json-file.ts';
import type { SecretCrypto } from './secret-file.ts';
import type { Secret } from './server-core.ts';

export function sealedSecret(path: string, crypto: () => SecretCrypto): Secret {
  /** 없으면 undefined, 읽었지만 모양이 틀리면 {} */
  const raw = (): Record<string, unknown> | undefined => {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const v = JSON.parse(text) as unknown;
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const data = (r: Record<string, unknown>): string | undefined =>
    r.v === 2 && r.enc === 'os' && typeof r.data === 'string' ? r.data : undefined;

  return {
    get() {
      const r = raw();
      const d = r && data(r);
      if (!d || !crypto().available()) return undefined;
      try {
        return crypto().decrypt(Buffer.from(d, 'base64')) || undefined;
      } catch {
        return undefined;
      }
    },
    set(value) {
      if (value === null) {
        rmSync(path, { force: true });
        return;
      }
      const c = crypto();
      if (!c.available()) throw new Error('운영체제 열쇠를 쓸 수 없어 토큰을 저장하지 않는다');
      writeFileDurable(path, JSON.stringify({ v: 2, enc: 'os', data: c.encrypt(value).toString('base64') }), {
        mode: 0o600,
      });
    },
    unreadable() {
      const r = raw();
      if (!r) return false;
      const d = data(r);
      // 암호화하지 않았거나 깨진 파일: 쓰지 않는다 (지우지도 덮지도 않는다)
      if (!d) return true;
      const c = crypto();
      if (!c.available()) return false;
      try {
        c.decrypt(Buffer.from(d, 'base64'));
        return false;
      } catch {
        return true;
      }
    },
  };
}
