import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// 쪽지함 덮개는 창 옮기기 자리(머리, 탭 줄, 아래 단추 줄) 위를 덮는다. 끌기 자리는 쌓임과 무관하게 입력을 가져가므로 덮개가 no-drag 여야 한다.
const css = readFileSync(new URL('./mail.css', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./panel.css', import.meta.url), 'utf8');

test('패널 머리, 탭 줄, 아래 단추 줄은 끌기 자리다 (이 전제가 깨지면 이 시험을 다시 본다)', () => {
  assert.match(panel, /\.panel > header,[\s\S]*?-webkit-app-region: drag/);
});

test('쪽지함 덮개(.mail-sheet)는 -webkit-app-region: no-drag 다', () => {
  const block = css.match(/\n\.mail-sheet \{([^}]*)\}/)?.[1] ?? '';
  assert.match(block, /-webkit-app-region:\s*no-drag/);
});
