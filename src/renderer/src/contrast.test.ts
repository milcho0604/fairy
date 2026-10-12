import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 패널, 채팅, 설정의 글자 색이 밝은, 어두운 모드 바탕에서 WCAG AA 를 넘는지 (접근성).
// 상태색은 tokens.test.ts 가 본다. 여기서는 본문 글자, 흐린 글자, 강조, 채팅 말풍선, 포커스 고리

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
function tokensOf(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[m[1] as string] = m[2] as string;
  return out;
}
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const light = tokensOf(css.slice(0, darkAt));
const dark = { ...light, ...tokensOf(css.slice(darkAt)) };

const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [글자, 바탕, 기준]. 4.5 는 작은 글자, 3 은 둘레선, 그림 같은 글자 아닌 것 */
const PAIRS: [string, string, number][] = [
  ['ink', 'bg', 4.5],
  ['ink', 'panel', 4.5],
  ['ink', 'pet', 4.5],
  ['ink', 'user', 4.5],
  ['ink', 'code', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'panel', 4.5],
  ['muted', 'pet', 4.5],
  // 마감 칩, 단추 칩처럼 --code 바탕에 흐린 글자
  ['muted', 'code', 4.5],
  ['accent', 'panel', 4.5],
  ['accent', 'bg', 4.5],
  ['accent-ink', 'accent', 4.5],
  // 포커스 고리(theme.css :focus-visible, 펫 고리)는 강조색 둘레선
  ['accent', 'user', 3],
  ['accent', 'code', 3],
];

for (const [mode, tokens] of [
  ['밝은', light],
  ['어두운', dark],
] as const) {
  test(`${mode} 모드 글자와 바탕 대비`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const a = tokens[fg];
      const b = tokens[bg];
      assert.ok(a && b, `${fg}, ${bg} 토큰이 있어야 한다`);
      const c = contrast(a, b);
      assert.ok(c >= min, `${mode} ${fg}(${a}) / ${bg}(${b}) = ${c.toFixed(2)} < ${min}`);
    }
  });
}

test('포커스 고리 기본값이 theme.css 에 있고 강조색을 쓴다', () => {
  const theme = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8');
  assert.match(theme, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--accent\)/);
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\)/);
});
