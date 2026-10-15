// 서버가 내보낸 이벤트 목록과 공지를 홈페이지 정적 파일(site/events.json, site/notices.json)로 옮긴다 (이슈 #101).
// 공개 레포 Actions(.github/workflows/site-feeds.yml)가 10분마다 돌린다. 시험(server/test, scripts/dev/server-events.mjs)도 쓴다.
//
//   node scripts/site-feeds.mjs [--api https://fairy-api.moilga.com] [--site site]
//
// - 앱이 실제로 쓰는 읽기 코드로 검사해(src/shared/site-feeds.ts) 하나라도 버리는 것이 있으면 아무 파일도 쓰지 않고 1 로 끝난다
// - 공지는 운영자 화면에서 한 번도 저장하지 않았으면 서버가 404: 레포의 notices.json 을 그대로 둔다
// - 서버에 닿지 않으면(꺼짐) 아무것도 쓰지 않고 0 으로 끝난다 (홈페이지는 지난 파일 그대로)
// - 바뀐 파일 이름을 줄마다 찍고, GITHUB_OUTPUT 이 있으면 changed=<이름들> 을 적는다
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkFeed } from '../src/shared/site-feeds.ts';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const api = opt('api', 'https://fairy-api.moilga.com').replace(/\/+$/, '');
const site = resolve(opt('site', 'site'));
const MAX = 256 * 1024;

async function get(name) {
  try {
    const res = await fetch(`${api}/v1/${name}.json`, {
      headers: { accept: 'application/json', 'user-agent': 'fairy-site-feeds' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return { kind: 'none' };
    if (!res.ok) return { kind: 'down', why: `HTTP ${res.status}` };
    const text = await res.text();
    if (text.length > MAX) return { kind: 'bad', why: '너무 큼' };
    return { kind: 'ok', text };
  } catch (err) {
    return { kind: 'down', why: err instanceof Error ? err.message : String(err) };
  }
}

const out = {};
for (const name of ['events', 'notices']) {
  const r = await get(name);
  if (r.kind === 'down') {
    console.log(`서버에 닿지 않음 (${name}: ${r.why}). 아무것도 바꾸지 않는다`);
    process.exit(0);
  }
  if (r.kind === 'none') {
    console.log(`${name}: 서버가 관리하지 않음 (404). 레포 파일 그대로`);
    continue;
  }
  if (r.kind === 'bad') {
    console.error(`${name}: ${r.why}`);
    process.exit(1);
  }
  const c = checkFeed(name, r.text);
  if (!c.ok) {
    console.error(`검사 실패, 아무 파일도 쓰지 않는다: ${c.error}`);
    process.exit(1);
  }
  out[name] = c.text;
}

const changed = [];
for (const [name, text] of Object.entries(out)) {
  const file = join(site, `${name}.json`);
  let old = '';
  try {
    old = readFileSync(file, 'utf8');
  } catch {}
  if (old === text) continue;
  writeFileSync(file, text);
  changed.push(name);
  console.log(`바뀜: site/${name}.json`);
}
if (changed.length === 0) console.log('바뀐 것 없음');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.join(' ')}\n`);
