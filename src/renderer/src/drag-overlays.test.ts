import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 창 옮기기 자리(-webkit-app-region: drag) 위를 덮는 것은 끌기 아님이어야 안의 단추와 입력칸이 눌린다 (theme.css 공통 규칙).
const dir = import.meta.dirname;
const theme = readFileSync(join(dir, 'theme.css'), 'utf8');
const rule = theme.match(/:where\(([^)]*)\)\s*\{\s*-webkit-app-region:\s*no-drag/)?.[1] ?? '';

function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
}
const files = walk(dir);

/** theme.css 공통 규칙이 이 클래스 이름 하나(루트)를 잡는가 */
function covered(cls: string): boolean {
  if (rule.includes(`.${cls}\n`) || rule.includes(`.${cls},`)) return true;
  return [...rule.matchAll(/\[class\$="([^"]+)"\]/g)].some((m) => cls.endsWith(m[1] ?? ''));
}

test('공통 규칙은 역할(dialog, alertdialog, menu, listbox)과 aria-modal 을 잡는다', () => {
  for (const r of ['dialog', 'alertdialog', 'menu', 'listbox']) assert.ok(rule.includes(`[role="${r}"]`), r);
  assert.ok(rule.includes('[aria-modal="true"]'));
});

test('끌기 자리를 쓰는 창(theme.css 를 쓰는 창)의 position: fixed 덮개는 공통 규칙이나 자기 no-drag 가 있다', () => {
  const missing: string[] = [];
  for (const f of files.filter((x) => x.endsWith('.css') && !x.includes('/overlay/'))) {
    const css = readFileSync(f, 'utf8');
    for (const m of css.matchAll(/(^|\n)(\.[A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
      if (!/position:\s*fixed/.test(m[3] ?? '')) continue;
      const cls = (m[2] ?? '').slice(1);
      if (/-webkit-app-region:\s*no-drag/.test(m[3] ?? '') || covered(cls)) continue;
      missing.push(`${f.slice(dir.length + 1)} .${cls}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('role 이 dialog, alertdialog, menu, listbox 가 아닌 덮개 클래스도 이름 끝 규칙에 든다', () => {
  for (const cls of [
    'plan-veil',
    'know-dim',
    'help-backdrop',
    'find-sheet',
    'row-menu',
    'sheet',
    'lightbox',
  ]) {
    assert.ok(covered(cls), cls);
  }
});
