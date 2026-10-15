// 서버 설정은 환경 변수에서만 읽는다. 비밀값(.env.prod)은 레포에 두지 않는다 (기획서 14절).

export type Config = {
  port: number;
  databaseUrl: string;
};

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL 이 비어 있다');
  const port = Number(env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT 가 이상하다: ${env.PORT}`);
  return { port, databaseUrl };
}
