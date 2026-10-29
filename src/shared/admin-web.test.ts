import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ADMIN_WEB_PLACES, adminWebUrl, isAdminWebPlace } from './admin-web.ts';

test('서버 운영자 화면의 칸과 아래 칸 이름과 어긋나지 않는다 (server/src/admin-page.ts 를 글로 읽어 맞춘다)', () => {
  const page = readFileSync(join(import.meta.dirname, '..', '..', 'server', 'src', 'admin-page.ts'), 'utf8');
  const cells = /export const ADMIN_CELLS = \[([^\]]*)\]/.exec(page)?.[1]?.match(/'([a-z]+)'/g) ?? [];
  assert.deepEqual(
    cells.map((c) => c.slice(1, -1)),
    ['home', 'users', 'reports', 'announce', 'settings'],
  );
  const subs = /export const CELL_SUBS[^=]*= \{([\s\S]*?)\n\};/.exec(page)?.[1] ?? '';
  const serverPlaces = new Set<string>();
  for (const m of subs.matchAll(/\n {2}([a-z]+): (\[\]|\[[\s\S]*?\n {2}\]),/g)) {
    serverPlaces.add(m[1] as string);
    for (const s of (m[2] as string).matchAll(/\['([a-z]+)',/g)) serverPlaces.add(`${m[1]}/${s[1]}`);
  }
  assert.deepEqual([...serverPlaces].sort(), [...ADMIN_WEB_PLACES].sort());
});

test('웹 운영자 화면 주소는 설정된 서버 주소에 자리 해시를 붙여 만든다', () => {
  assert.equal(
    adminWebUrl('https://fairy-api.moilga.com', 'home'),
    'https://fairy-api.moilga.com/admin#home',
  );
  assert.equal(
    adminWebUrl('https://fairy-api.moilga.com/', 'reports'),
    'https://fairy-api.moilga.com/admin#reports',
  );
  assert.equal(
    adminWebUrl('http://127.0.0.1:9876', 'settings/log'),
    'http://127.0.0.1:9876/admin#settings/log',
  );
  // 서버 주소의 경로나 쿼리는 버리고 출처만 쓴다
  assert.equal(
    adminWebUrl('https://x.example/some/path?a=1', 'users/grants'),
    'https://x.example/admin#users/grants',
  );
});

test('서버 주소가 없거나 모르는 자리, 이상한 주소 모양은 열지 않는다', () => {
  assert.equal(adminWebUrl('', 'home'), undefined);
  assert.equal(adminWebUrl('https://x.example', 'secret'), undefined);
  assert.equal(adminWebUrl('https://x.example', '../etc'), undefined);
  assert.equal(adminWebUrl('https://x.example', undefined), undefined);
  assert.equal(adminWebUrl('https://x.example', 'home#x'), undefined);
  assert.equal(adminWebUrl('javascript:alert(1)', 'home'), undefined);
  assert.equal(adminWebUrl('file:///etc/passwd', 'home'), undefined);
  assert.equal(adminWebUrl('not a url', 'home'), undefined);
});

test('자리 목록은 서버의 다섯 칸과 아래 칸과 같다', () => {
  const cells = new Set(ADMIN_WEB_PLACES.map((p) => p.split('/')[0]));
  assert.deepEqual([...cells].sort(), ['announce', 'home', 'reports', 'settings', 'users']);
  assert.ok(isAdminWebPlace('announce/posts'));
  assert.ok(!isAdminWebPlace('announce/other'));
});
