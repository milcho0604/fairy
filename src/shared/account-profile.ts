// 서버 계정의 닉네임과 기기 코드 (이슈 #101 범위 추가). 앱과 서버가 함께 쓰는 순수 규칙이라 아무것도 가져오지 않는다.
// - 닉네임: 서버 기능을 처음 켤 때(나이 확인 다음) 정하고 설정에서 바꾼다. 중복은 허용하고 사람은 기기 코드로 가린다.
//   만 14세 미만(앱 안 모드)은 서버로 보내지 않는다. 구글 계정 이름과 이메일은 여전히 받지 않는다.
// - 기기 코드: 서버가 계정마다 만드는 공개 코드 (F-XXXX-XXXX, Crockford base32 8자, 무작위). 토큰, 계정 번호와 무관하다.

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 줄바꿈과 제어 문자, 보이지 않는 서식 문자(폭 0 글자, 방향 바꾸기 등) */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** 주소처럼 보이는 것: 스킴(https://), www., 흔한 도메인 끝 (.com, .kr 등). "Mr.Kim" 같은 이름은 된다 */
const URLISH =
  /([a-z][a-z0-9+.-]*:\/\/|www\.|\.(com|net|org|kr|io|me|gg|xyz|app|dev|co|ly|to|link|site|shop)\b)/i;

export type NicknameError = 'length' | 'chars' | 'url' | 'at';

/**
 * 닉네임 검사. NFC 로 맞추고 앞뒤 빈칸을 깎은 값이 2~12자(코드 포인트)여야 한다.
 * 제어 문자, 줄바꿈, 보이지 않는 서식 문자, @, 주소는 받지 않는다. 맞으면 정리한 값
 */
export function checkNickname(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: NicknameError } {
  if (typeof raw !== 'string' || raw.length > 100) return { ok: false, error: 'length' };
  const v = raw.normalize('NFC').trim();
  if (INVISIBLE.test(v)) return { ok: false, error: 'chars' };
  const n = [...v].length;
  if (n < NICKNAME_MIN || n > NICKNAME_MAX) return { ok: false, error: 'length' };
  if (v.includes('@') || v.includes('＠')) return { ok: false, error: 'at' };
  if (URLISH.test(v)) return { ok: false, error: 'url' };
  return { ok: true, value: v };
}

/** Crockford base32 (I, L, O, U 없음) */
export const DEVICE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DEVICE_CODE = /^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** 사람이 친 기기 코드를 맞춘다 (소문자, 빈칸, 앞의 F- 없이도). 헷갈리는 글자는 Crockford 규칙대로 (O→0, I/L→1) */
export function normalizeDeviceCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 30) return undefined;
  let s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.startsWith('F') && s.length === 9) s = s.slice(1);
  if (s.length !== 8) return undefined;
  const code = `F-${s.slice(0, 4)}-${s.slice(4)}`;
  return DEVICE_CODE.test(code) ? code : undefined;
}

/** 무작위 바이트 8개로 기기 코드를 만든다 (바이트 % 32, 256 이 32 의 배수라 치우침 없음) */
export function deviceCodeFrom(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += DEVICE_CODE_ALPHABET[(bytes[i] ?? 0) % 32];
  return `F-${s.slice(0, 4)}-${s.slice(4)}`;
}
