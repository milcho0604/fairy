// 읽기 전용 훅 (이슈 #126). claude 가 MCP 도구를 부르기 직전에 --settings 의 PreToolUse 훅으로 이 파일을 연다.
// 짝꿍 실행 파일을 Node 로 돌려(ELECTRON_RUN_AS_NODE=1) 표준 입력의 JSON 에서 도구 이름을 읽고, 쓰기 도구면 막는다.
// Electron 을 불러오지 않는다. electron-vite 가 out/main/ai-guard.js 로 따로 낸다 (mcp-server.ts 와 같은 길).
import { ALLOW_FAIRY_FLAG, hookDecision, hookToolName } from '../shared/ai/guard.ts';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const out = hookDecision(hookToolName(input), process.argv.includes(ALLOW_FAIRY_FLAG));
  if (out) process.stdout.write(`${out}\n`);
  process.exit(0);
});
// 입력이 열린 채 오지 않으면 막고 끝낸다 (훅 제한 시간 안에)
setTimeout(() => {
  process.stdout.write(`${hookDecision(undefined)}\n`);
  process.exit(0);
}, 5000).unref();
