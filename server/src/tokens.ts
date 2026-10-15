import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// 기기 토큰과 세션 토큰. 무작위 32바이트를 base64url 로, 앞에 종류 표시를 붙인다.
// 토큰은 응답에 한 번만 나가고 서버는 sha256 해시만 둔다 (기획서 14절).

export type TokenKind = 'device' | 'session';
const PREFIX: Record<TokenKind, string> = { device: 'fd_', session: 'fs_' };
const BODY = /^[A-Za-z0-9_-]{43}$/;

export function newToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString('base64url');
}

/** 토큰 모양을 보고 종류를 돌려준다. 모양이 틀리면 undefined (DB 를 보지 않고 거절) */
export function tokenKind(token: string): TokenKind | undefined {
  for (const kind of ['device', 'session'] as const) {
    if (token.startsWith(PREFIX[kind]) && BODY.test(token.slice(3))) return kind;
  }
  return undefined;
}

export function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/** 길이가 같을 때 상수 시간으로 비교한다 */
export function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 일회용 코드, state 같은 짧은 무작위 값 */
export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
