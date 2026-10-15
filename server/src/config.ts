// 서버 설정은 환경 변수에서만 읽는다. 비밀값(.env.prod)은 레포에 두지 않는다 (기획서 14절).

export type Config = {
  port: number;
  databaseUrl: string;
  /** 밖에서 보이는 서버 주소. 구글 로그인의 돌아오는 주소(<publicUrl>/auth/google/callback)가 된다 */
  publicUrl: string;
  /** 구글 로그인용 OAuth 클라이언트 (scope openid 만). 둘 중 하나라도 비면 로그인 경로는 503 으로 꺼진다 */
  googleClientId: string;
  googleClientSecret: string;
};

export const DEFAULT_PUBLIC_URL = 'https://fairy-api.moilga.com';

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL 이 비어 있다');
  const port = Number(env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT 가 이상하다: ${env.PORT}`);
  const publicUrl = (env.PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error(`PUBLIC_URL 이 주소가 아니다: ${env.PUBLIC_URL}`);
  }
  // 운영 주소는 https 만. 시험과 로컬은 127.0.0.1 http 를 허락한다
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error(`PUBLIC_URL 은 https 여야 한다: ${publicUrl}`);
  return {
    port,
    databaseUrl,
    publicUrl,
    googleClientId: (env.GOOGLE_CLIENT_ID ?? '').trim(),
    googleClientSecret: (env.GOOGLE_CLIENT_SECRET ?? '').trim(),
  };
}

/** 구글 로그인을 켤 수 있는지 (클라이언트 번호와 비밀이 둘 다 있다) */
export const googleEnabled = (c: Config): boolean => c.googleClientId !== '' && c.googleClientSecret !== '';
