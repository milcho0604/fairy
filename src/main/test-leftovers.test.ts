import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 시험 스크립트가 맥에 찌꺼기를 남기지 않는지 본다.
// postgres 그림은 데이터 폴더를 VOLUME 으로 두어서, docker rm -f 로 지우면 이름 없는 볼륨이 남는다.
// 헤드리스 Chrome 은 끝날 때마다 X/com.google.Chrome.code_sign_clone 에 복제본을 남기고, 쌓이면 부팅이 멈춘다.
const ROOT = join(import.meta.dirname, '../..');
const files = ['scripts/dev', 'server/test'].flatMap((dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => /\.(mjs|ts)$/.test(f))
    .map((f) => join(dir, f)),
);
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

test('postgres 를 띄우는 시험은 데이터를 tmpfs 에 두고, 지울 때 볼륨까지 지운다', () => {
  const pg = files.filter((f) => read(f).includes('postgres:16-alpine'));
  assert.ok(pg.length > 0);
  for (const f of pg) {
    const src = read(f);
    assert.match(src, /'--tmpfs',\s*'\/var\/lib\/postgresql\/data'/, f);
    assert.doesNotMatch(src, /'rm', '-f', (?!'-v')/, f);
  }
});

test('설치된 Chrome 을 띄우는 시험은 코드 서명 복제본을 끈다', () => {
  const chrome = files.filter((f) => read(f).includes('Google Chrome.app'));
  assert.ok(chrome.length > 0);
  for (const f of chrome) assert.ok(read(f).includes("'--disable-features=MacAppCodeSignClone'"), f);
});
