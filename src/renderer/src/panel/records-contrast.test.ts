import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 집중 월간 잔디 칸(records.css .fm-cell)의 숫자가 밝은, 어두운 모드 모두에서 읽히는지 (WCAG AA 작은 글자 4.5:1).
// 칸 바탕은 records.css 에서 읽고, 색은 tokens.css 에서 읽는다 (CSS 를 고치면 이 시험이 따라간다)

const here = import.meta.dirname;
const tokens = readFileSync(join(here, '..', 'tokens.css'), 'utf8');
const records = readFileSync(join(here, 'records.css'), 'utf8');

function tokensOf(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[m[1] as string] = m[2] as string;
  return out;
}
const darkAt = tokens.indexOf('@media (prefers-color-scheme: dark)');
const light = tokensOf(tokens.slice(0, darkAt));
const dark = { ...light, ...tokensOf(tokens.slice(darkAt)) };

const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
/** top 이 p 만큼, under 가 나머지 */
const mix = (top: string, under: string, p: number) =>
  `#${rgb(top)
    .map((v, i) =>
      Math.round(v * p + (rgb(under)[i] as number) * (1 - p))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
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

/** records.css 에서 `.fm-cell.lvN` 의 바탕 색 섞기: color-mix(in srgb, var(--panel) P%, var(--ok)) 또는 var(--ok) */
function cellBg(level: number, t: Record<string, string>, isDark: boolean): string {
  // 밝은 모드는 @media 앞의 규칙, 어두운 모드는 @media 안의 규칙이 있으면 그것 (없으면 밝은 모드 것)
  const cut = records.indexOf('@media (prefers-color-scheme: dark)');
  const find = (css: string) =>
    new RegExp(`\\.fm-cell\\.lv${level}[^{]*\\{[^}]*background:\\s*([^;]+);`).exec(css);
  const rule = (isDark ? find(records.slice(cut)) : null) ?? find(records.slice(0, cut));
  assert.ok(rule, `lv${level} 바탕 규칙`);
  const value = (rule[1] as string).trim();
  if (value === 'var(--ok)') return t.ok as string;
  const m = /color-mix\(in srgb, var\(--panel\) (\d+)%, var\(--ok\)\)/.exec(value);
  assert.ok(m, `lv${level} 바탕 ${value}`);
  return mix(t.panel as string, t.ok as string, Number(m[1]) / 100);
}

for (const [name, t, isDark] of [
  ['밝은', light, false],
  ['어두운', dark, true],
] as const) {
  test(`${name} 모드: 잔디 칸 숫자 대비 4.5:1 이상`, () => {
    // 0단계: 선 색 55% 를 카드(--panel) 위에 깔고 흐린 글자
    const lv0 = mix(t.line as string, t.panel as string, 0.55);
    assert.ok(contrast(t.muted as string, lv0) >= 4.5, `lv0 ${contrast(t.muted as string, lv0).toFixed(2)}`);
    for (const level of [1, 2, 3]) {
      const bg = cellBg(level, t, isDark);
      const c = contrast(t.ink as string, bg);
      assert.ok(c >= 4.5, `lv${level} ${bg} ${c.toFixed(2)}`);
    }
    const c4 = contrast(t['ok-ink'] as string, cellBg(4, t, isDark));
    assert.ok(c4 >= 4.5, `lv4 ${c4.toFixed(2)}`);
  });

  test(`${name} 모드: 잔디 단계가 서로 구분된다 (이웃 단계 대비 1.15 이상)`, () => {
    const bgs = [
      mix(t.line as string, t.panel as string, 0.55),
      ...[1, 2, 3, 4].map((l) => cellBg(l, t, isDark)),
    ];
    for (let i = 1; i < bgs.length; i++) {
      const c = contrast(bgs[i - 1] as string, bgs[i] as string);
      assert.ok(c >= 1.15, `lv${i - 1} 와 lv${i}: ${c.toFixed(2)}`);
    }
  });
}
