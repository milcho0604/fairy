// 마크다운 메모 미리보기의 안전: 글 속 HTML, 위험한 주소, 밖에서 불러오는 그림
// 화면에 넣기 직전의 DOMPurify 는 DOM 이 필요해서 이 시험이 아니라 앱 안(CDP)에서 따로 확인한다.
// 여기서는 그 앞 단계(marked + 우리 규칙)가 이미 안전한 글자만 내는지 본다: 나온 태그와 속성이 허용 목록 안인지 센다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from './i18n/index.ts';
import {
  escapeHtml,
  MD_ALLOWED_ATTR,
  MD_ALLOWED_TAGS,
  MD_PREVIEW_MAX,
  renderNoteMarkdown,
} from './note-markdown.ts';

const tagsOf = (html: string): string[] =>
  [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => (m[1] ?? '').toLowerCase());
const attrsOf = (html: string): string[] =>
  [...html.matchAll(/<[a-zA-Z][^>]*>/g)].flatMap((m) =>
    [...(m[0] ?? '').matchAll(/\s([a-zA-Z-]+)(?==|\s|>|$)/g)].map((a) => (a[1] ?? '').toLowerCase()),
  );

/** 나온 모든 태그와 속성이 허용 목록 안이다 */
function assertInsideAllowList(html: string): void {
  const tags = new Set<string>(MD_ALLOWED_TAGS);
  const attrs = new Set<string>(MD_ALLOWED_ATTR);
  for (const t of tagsOf(html)) assert.ok(tags.has(t), `허용 밖 태그 <${t}> in ${html}`);
  for (const a of attrsOf(html)) assert.ok(attrs.has(a), `허용 밖 속성 ${a} in ${html}`);
}

test('글 속 <script> 와 <img onerror> 는 태그가 되지 않고 글자로 보인다', () => {
  const html = renderNoteMarkdown(
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n인라인 <b onclick="x()">굵게</b>',
  );
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<img/i.test(html));
  assert.ok(!/<b[ >]/i.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assertInsideAllowList(html);
});

test('<iframe>, <style>, <form>, <svg>, 이벤트 속성이 든 줄도 글자로', () => {
  const html = renderNoteMarkdown(
    [
      '<iframe src="https://evil.example"></iframe>',
      '<style>*{display:none}</style>',
      '<form action="x"><input name=a></form>',
      '<svg onload=alert(1)>',
      '<a href="javascript:alert(1)" onclick="y()">x</a>',
    ].join('\n\n'),
  );
  for (const bad of ['<iframe', '<style', '<form', '<svg', '<a ', 'onclick=', 'onload='])
    assert.ok(!html.includes(bad) || bad.endsWith('='), bad);
  assertInsideAllowList(html);
});

test('javascript:, data:, file:, vbscript: 링크는 링크가 아니라 글자만 남는다', () => {
  const html = renderNoteMarkdown(
    '[a](javascript:alert(1)) [b](data:text/html;base64,PHNjcmlwdD4=) [c](file:///etc/passwd) [d](vbscript:x) [e](JaVaScRiPt:alert(1))',
  );
  assert.ok(!/<a\b/i.test(html), html);
  assert.ok(!/href/i.test(html), html);
  for (const label of ['a', 'b', 'c', 'd', 'e']) assert.ok(html.includes(label));
  assertInsideAllowList(html);
});

test('주소 속 아이디와 비밀번호가 든 링크(보이는 곳과 가는 곳이 다른 주소)도 링크가 되지 않는다', () => {
  const html = renderNoteMarkdown('[x](https://good.com@evil.com/)');
  assert.ok(!/<a\b/i.test(html), html);
});

test('http, https 링크는 링크가 된다 (제목 속 따옴표는 이스케이프)', () => {
  const html = renderNoteMarkdown(
    '[공식](https://example.com/a?b=1&c=2 "그 \\"사이트\\"") 와 <https://example.org/x>',
  );
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.match(html, /<a href="https:\/\/example\.org\/x"/);
  assert.ok(!/title="[^"]*"[^>]*"/.test(html.replace(/&quot;/g, '')), '따옴표가 속성을 깨지 않는다');
  assertInsideAllowList(html);
});

test('원격 그림은 불러오지 않는다: img 태그도 주소도 없고 설명 글만', () => {
  setLang('ko');
  const html = renderNoteMarkdown(
    '![고양이 사진](https://tracker.example/pixel.png?id=1)\n\n![](http://x.example/a.png)\n\n![로컬](data:image/png;base64,AAAA)',
  );
  assert.ok(!/<img/i.test(html));
  assert.ok(!html.includes('tracker.example'));
  assert.ok(!html.includes('x.example'));
  assert.ok(!html.includes('data:image'));
  assert.match(html, /<span class="md-image">고양이 사진<\/span>/);
  assert.match(html, /<span class="md-image">이미지<\/span>/, '설명이 없으면 자리 글');
  assertInsideAllowList(html);
});

test('그림 설명 글의 태그 글자도 이스케이프', () => {
  const html = renderNoteMarkdown('![<script>x</script>](https://a.example/p.png)');
  assert.ok(!/<script/i.test(html));
  assertInsideAllowList(html);
});

test('GFM 기본: 제목, 굵게, 기울임, 지움, 목록, 할 일 목록, 코드, 인용, 표, 구분선', () => {
  const html = renderNoteMarkdown(
    [
      '# 큰 제목',
      '## 중간 제목',
      '**굵게** *기울임* ~~지움~~ `코드`',
      '- 하나\n- 둘',
      '1. 첫째\n2. 둘째',
      '- [x] 끝낸 일\n- [ ] 할 일',
      '```js\nconst a = 1 < 2;\n```',
      '> 인용',
      '| 이름 | 값 |\n|---|---|\n| a | 1 |',
      '---',
    ].join('\n\n'),
  );
  for (const re of [
    /<h1>큰 제목<\/h1>/,
    /<h2>중간 제목<\/h2>/,
    /<strong>굵게<\/strong>/,
    /<em>기울임<\/em>/,
    /<del>지움<\/del>/,
    /<code>코드<\/code>/,
    /<ul>/,
    /<ol>/,
    /<blockquote>/,
    /<table>/,
    /<hr>/,
    /<pre><code class="language-js">const a = 1 &lt; 2;/,
  ])
    assert.match(html, re);
  // 할 일 목록: 보기만 하는 체크 상자 (disabled), 끝낸 것만 checked
  assert.match(html, /<input type="checkbox" disabled checked> 끝낸 일/);
  assert.match(html, /<input type="checkbox" disabled> 할 일/);
  assertInsideAllowList(html);
});

test('한 줄 바꿈은 줄바꿈으로 보인다 (메모는 줄마다 쓴다)', () => {
  assert.match(renderNoteMarkdown('첫 줄\n둘째 줄'), /첫 줄<br>둘째 줄/);
});

test('긴 글과 이상한 입력도 던지지 않는다', () => {
  const nasty = `${'['.repeat(2000)}${'*'.repeat(2000)}${'<'.repeat(2000)}${'`'.repeat(999)}`;
  const t0 = performance.now();
  const html = renderNoteMarkdown(nasty);
  assert.equal(typeof html, 'string');
  assert.ok(performance.now() - t0 < 2000, '느려지지 않는다');
  assertInsideAllowList(html);
  assert.equal(renderNoteMarkdown(''), '');
});

test('허용 목록에는 그림, 스크립트, 스타일, 틀, 양식, 이벤트 속성이 없다', () => {
  for (const bad of [
    'img',
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'svg',
    'link',
    'meta',
    'base',
    'video',
    'audio',
    'source',
  ])
    assert.ok(!(MD_ALLOWED_TAGS as readonly string[]).includes(bad), bad);
  for (const a of MD_ALLOWED_ATTR as readonly string[])
    assert.ok(!/^on/i.test(a) && a !== 'style' && a !== 'src' && a !== 'srcset', a);
  assert.deepEqual(
    MD_ALLOWED_TAGS.filter((t) => t === 'input'),
    ['input'],
    'input 은 체크 상자 표시용으로만',
  );
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('수천 겹 겹친 글도 던지지 않고 글 그대로 보인다', () => {
  for (const src of [
    '- '.repeat(5000) + 'a',
    '>'.repeat(5000) + 'a',
    `${'*'.repeat(5000)}a${'*'.repeat(5000)}`,
  ]) {
    const html = renderNoteMarkdown(src);
    assert.ok(html.startsWith('<pre>'), src.slice(0, 4));
  }
});

test('너무 긴 글은 꾸미지 않고 글 그대로, 안의 HTML 은 글자로', () => {
  const src = `<script>x</script>${'_a'.repeat(MD_PREVIEW_MAX)}`;
  const html = renderNoteMarkdown(src);
  assert.ok(html.startsWith('<pre>&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<em>'));
});
