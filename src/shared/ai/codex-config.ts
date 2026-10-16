// codex 설정 파일(config.toml)에서 MCP 서버 이름 읽기 (이슈 #126). 읽기 전용 강제가 이번 실행에서 끄려고 쓴다.
// TOML 은 같은 서버를 여러 모양으로 적을 수 있다([mcp_servers.a], [mcp_servers."a.b"], [ mcp_servers.a ] 뒤 주석, 점 키
// mcp_servers.a.command = ..., [mcp_servers] 아래 인라인 표). 줄 단위 정규식은 이것을 놓쳐 서버가 켜진 채 승인 없이 돌았다.
// 그래서 진짜 TOML 해석기(smol-toml)로 읽는다.
//
// 읽지 못하면 undefined: 해석기는 못 읽는데 codex 는 읽는 파일이 있다(맨 앞 BOM, 윤초 시각 T00:00:60Z 등).
// 이때 빈 목록으로 보고 아무것도 끄지 않으면 서버가 켜진 채로 돈다. 부르는 쪽은 undefined 면 사용자 설정을 아예 싣지 않는다(격리)
import { parse } from 'smol-toml';

export function codexMcpNames(toml: string): string[] | undefined {
  try {
    const servers = (parse(toml.replace(/^\uFEFF/, '')) as { mcp_servers?: unknown }).mcp_servers;
    return servers && typeof servers === 'object' && !Array.isArray(servers) ? Object.keys(servers) : [];
  } catch {
    return undefined;
  }
}
