import { execFile } from 'node:child_process';
import { aiChildEnv } from '../../shared/ai/child-env.ts';
import { parseMcpList } from '../../shared/ai/claude.ts';
import { fresh } from '../../shared/clock.ts';
import { readJson, writeJson } from '../store.ts';
import { getShellEnv, launchOf, resolveBin } from './shell-env.ts';

const FILE = 'ai-mcp';
const FRESH_MS = 24 * 3_600_000;

let cache: { at: number; servers: string[] } | undefined;
let running: Promise<string[]> | undefined;

/**
 * 내 claude 에 연결된 MCP 서버 이름 (v2 외부 MCP). `claude mcp list` 는 연결을 하나씩 확인해서 10초쯤 걸린다.
 * 그래서 하루 한 번만 읽어 저장해 두고, 오래됐으면 뒤에서 새로 읽는다. 처음에는 빈 목록.
 */
export function mcpServers(log: (tag: string, ...rest: unknown[]) => void): string[] {
  cache ??= readJson(FILE) as typeof cache;
  // 저장 시각이 지금보다 뒤면(시계가 뒤로 감) 오래된 것으로 보고 다시 읽는다
  if (!cache || !fresh(cache.at, Date.now(), FRESH_MS + 1)) void refreshMcpServers(log);
  return cache?.servers ?? [];
}

/**
 * 읽기 전용 강제가 보는 목록 (이슈 #126). 신선한 저장본이 없으면(처음, 하루가 지남) undefined: 사용자가 fairy 를 직접 등록했는지 모르니
 * 부르는 쪽이 내 MCP 를 열지 않는다. 뒤에서 새로 읽어 다음 질문부터는 안다
 */
export function knownMcpServers(log: (tag: string, ...rest: unknown[]) => void): string[] | undefined {
  cache ??= readJson(FILE) as typeof cache;
  if (cache && fresh(cache.at, Date.now(), FRESH_MS + 1)) return cache.servers;
  void refreshMcpServers(log);
  return undefined;
}

/** 저장해 둔 목록만 (새로 읽지 않는다). 내 MCP 쓰기를 끈 사람의 claude 는 건드리지 않는다 */
export function cachedMcpServers(): string[] {
  cache ??= readJson(FILE) as typeof cache;
  return cache?.servers ?? [];
}

export function refreshMcpServers(log: (tag: string, ...rest: unknown[]) => void): Promise<string[]> {
  running ??= (async () => {
    try {
      const env = await getShellEnv();
      const cli = resolveBin('claude', env);
      const launch = cli ? launchOf(cli, env) : undefined;
      if (!launch) return [];
      const out = await new Promise<string>((resolve) => {
        execFile(
          launch.file,
          [...launch.pre, 'mcp', 'list'],
          {
            env: aiChildEnv(process.env, { PATH: env.path, ...launch.env }),
            timeout: 60_000,
            encoding: 'utf8',
          },
          (_e, stdout) => resolve(stdout ?? ''),
        );
      });
      const servers = parseMcpList(out);
      cache = { at: Date.now(), servers };
      writeJson(FILE, cache);
      log('mcp', '서버', servers.length);
      return servers;
    } finally {
      running = undefined;
    }
  })();
  return running;
}
