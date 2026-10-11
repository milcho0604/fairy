// 토큰 파일 (구글 캘린더 refresh token, Hugging Face 토큰). 2026-10-11 보안 점검.
// 운영체제 열쇠(맥 키체인, 윈도우 DPAPI, 리눅스 libsecret/kwallet)로 암호화할 수 있으면 safeStorage 로 암호화해 둔다.
// 리눅스에서 열쇠고리가 없으면(basic_text) 암호화가 이름뿐이라 예전처럼 나만 읽을 수 있는 파일(0600)에 평문으로 둔다.
// 예전 평문 파일은 읽을 때 암호화할 수 있으면 바로 암호화해 다시 쓴다.
// 다른 컴퓨터로 옮기거나 열쇠가 바뀌어 풀지 못하면 없는 것으로 본다 (파일은 지우지 않는다. 다시 연결하면 덮인다).
// Electron 없이 시험하려고 암호화 장치를 받는다 (os-crypto.ts 가 실제 safeStorage).
import { readFileSync, rmSync } from 'node:fs';
import { writeFileDurable } from './json-file.ts';

export interface SecretCrypto {
  /** 진짜로 암호화할 수 있는지 (리눅스 basic_text 는 false) */
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

/** 파일 모양: 암호화 { v: 2, enc: 'os', data: base64 }, 평문 { v: 2, plain: 값 }, 옛 평문 { [key]: 값 } */
interface SecretShape {
  v?: unknown;
  enc?: unknown;
  data?: unknown;
  plain?: unknown;
  [k: string]: unknown;
}

/** 토큰 하나를 담은 파일. legacyKey 는 옛 평문 파일의 칸 이름 (token, refreshToken) */
export function secretFile(path: string, legacyKey: string, crypto: () => SecretCrypto) {
  function write(value: string): void {
    const c = crypto();
    const body = c.available()
      ? { v: 2, enc: 'os', data: c.encrypt(value).toString('base64') }
      : { v: 2, plain: value };
    writeFileDurable(path, JSON.stringify(body), { mode: 0o600 });
  }

  return {
    /** 값. 없거나 못 풀면 undefined */
    read(): string | undefined {
      let raw: SecretShape;
      try {
        raw = JSON.parse(readFileSync(path, 'utf8')) as SecretShape;
      } catch {
        return undefined;
      }
      if (!raw || typeof raw !== 'object') return undefined;
      if (raw.v === 2 && raw.enc === 'os' && typeof raw.data === 'string') {
        try {
          return crypto().decrypt(Buffer.from(raw.data, 'base64'));
        } catch {
          return undefined;
        }
      }
      const plain = raw.v === 2 ? raw.plain : raw[legacyKey];
      if (typeof plain !== 'string' || !plain) return undefined;
      // 옛 평문이거나 그때는 암호화를 못 했으면 지금 할 수 있을 때 바꿔 쓴다
      try {
        if (crypto().available()) write(plain);
      } catch {
        // 못 바꿔도 읽기는 된다
      }
      return plain;
    },
    write,
    /**
     * 운영체제 열쇠로 암호화한 파일이 있는데 지금 열쇠로는 풀지 못한다. 열쇠는 쓸 수 있으니 잠깐 못 쓰는 것이 아니라
     * 열쇠 자체가 바뀌었다: 맥 키체인과 리눅스 열쇠고리 항목 이름이 앱 이름을 따라가서 이름이 짝꿍에서 페어리로 바뀌면
     * 예전 열쇠를 찾지 못한다 (다른 컴퓨터에서 가져온 파일도 같다). 다시 받아야 한다
     */
    unreadable(): boolean {
      let raw: SecretShape;
      try {
        raw = JSON.parse(readFileSync(path, 'utf8')) as SecretShape;
      } catch {
        return false;
      }
      if (!raw || typeof raw !== 'object' || raw.v !== 2 || raw.enc !== 'os' || typeof raw.data !== 'string')
        return false;
      const c = crypto();
      if (!c.available()) return false;
      try {
        c.decrypt(Buffer.from(raw.data, 'base64'));
        return false;
      } catch {
        return true;
      }
    },
    remove(): void {
      rmSync(path, { force: true });
    },
  };
}
