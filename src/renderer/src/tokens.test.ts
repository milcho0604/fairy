import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 상태색(성공, 경고, 위험) 글자가 밝은, 어두운 모드의 모든 바탕에서 WCAG AA 작은 글자 기준(4.5:1)을 넘는지.
// 바탕은 창 바탕(--bg), 카드(--panel), 펫 말풍선(--pet)과, CSS 에서 자기 색을 옅게 깐 띠(color-mix)다.

const dir = import.meta.dirname;
const css = readFileSync(join(dir, 'tokens.css'), 'utf8');

/** :root { ... } 한 덩어리의 --이름: #색 */
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
const mix = (top: string, under: string, p: number) => {
  const a = rgb(top);
  const b = rgb(under);
  return `#${a
    .map((v, i) =>
      Math.round(v * p + (b[i] as number) * (1 - p))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};
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

/** 렌더러 CSS 전부에서 상태색을 옅게 깐 바탕: [색 이름, 비율, 아래 바탕 이름들]. 점, 막대처럼 글자가 없는 섞음(--muted 와 섞기)은 빼고 */
function tints(): [string, number, string[]][] {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css'));
  const out: [string, number, string[]][] = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(
      /background:\s*color-mix\(in srgb, var\(--(ok|warn|error)\) (\d+)%, (transparent|var\(--(panel|bg)\))\)/g,
    )) {
      const under = m[4] ? [m[4]] : ['panel', 'bg'];
      out.push([m[1] as string, Number(m[2]) / 100, under]);
    }
  }
  return out;
}

const STATUS = ['ok', 'warn', 'error'];
const AA = 4.5;

for (const [name, t] of [
  ['밝은', light],
  ['어두운', dark],
] as const) {
  test(`${name} 모드: 상태색 글자는 창, 카드, 말풍선 바탕에서 4.5:1 이상`, () => {
    for (const s of STATUS)
      for (const bg of ['bg', 'panel', 'pet']) {
        const r = contrast(t[s] as string, t[bg] as string);
        assert.ok(r >= AA, `${s} ${t[s]} / ${bg} ${t[bg]} = ${r.toFixed(2)}`);
      }
  });

  test(`${name} 모드: 자기 색을 옅게 깐 띠 위 글자도 4.5:1 이상`, () => {
    const found = tints();
    // 상점 안내(14%), 만들기 오류(12%), 채팅 띠(10%), 마감 지남(12%)이 빠지면 정규식이 깨진 것
    assert.ok(found.length >= 5, `띠를 ${found.length}개밖에 못 찾았다`);
    for (const [s, p, unders] of found)
      for (const u of unders) {
        const band = mix(t[s] as string, t[u] as string, p);
        const r = contrast(t[s] as string, band);
        assert.ok(r >= AA, `${s} ${Math.round(p * 100)}% 띠(${u} 위 ${band}) = ${r.toFixed(2)}`);
      }
  });

  test(`${name} 모드: 성공색 바탕 위 글자(--ok-ink)도 4.5:1 이상`, () => {
    const r = contrast(t['ok-ink'] as string, t.ok as string);
    assert.ok(r >= AA, `ok-ink ${t['ok-ink']} / ok ${t.ok} = ${r.toFixed(2)}`);
  });
}

test('상태색은 tokens.css 한 곳에서만 정한다 (CSS 에 같은 색을 직접 적지 않는다)', () => {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
    (f) => f.endsWith('.css') && f !== 'tokens.css',
  );
  const values = new Set(STATUS.flatMap((s) => [light[s], dark[s]]).map((v) => (v as string).toLowerCase()));
  for (const f of files) {
    const hex = readFileSync(join(dir, f), 'utf8').match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    for (const h of hex) assert.ok(!values.has(h.toLowerCase()), `${f} 에 상태색 ${h} 를 직접 적었다`);
  }
});

test('대비 계산이 맞다 (WCAG 예: 검정과 흰색 21, 같은 색 1)', () => {
  assert.equal(Number(contrast('#000000', '#ffffff').toFixed(2)), 21);
  assert.equal(contrast('#227644', '#227644'), 1);
  // 예전 성공색은 흰 바탕에서 모자랐다
  assert.ok(contrast('#2e9d5b', '#ffffff') < AA);
});
