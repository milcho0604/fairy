// 마크다운 메모의 미리보기 (26판). 글을 HTML 글자로 바꾸는 일은 marked 가 하고, 이 파일은 그 위에 안전 규칙을 얹는다.
// 직접 파서를 만들지 않는다. 화면에 넣기 전에는 한 번 더 DOMPurify 로 거른다 (renderer/panel/NoteMarkdown.tsx).
//
// 규칙:
// - 글 속 HTML 은 해석하지 않고 글자 그대로 보인다 (<script> 도 그냥 글자). 그래서 marked 단계에서 이미 태그가 생기지 않는다
// - 그림은 불러오지 않는다. 주소 대신 설명 글(alt)만 보인다 (밖으로 요청이 나가면 메모를 연 것이 남에게 알려진다)
// - 링크는 http, https 만. 그 밖(javascript:, data: 등)은 링크 없이 글자만 남긴다. 여는 일은 메인이 기본 브라우저로 한다
// - 할 일 목록의 체크 상자는 눌러도 바뀌지 않는 표시일 뿐이다 (disabled)

import { Marked, type Tokens } from 'marked';
import { t } from './i18n/index.ts';
import { safeExternalUrl } from './links.ts';

export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** DOMPurify 에 주는 규칙. 미리보기에 나올 수 있는 태그와 속성만 (그림, 스크립트, 스타일, 틀, 양식은 없다) */
export const MD_ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
] as const;
export const MD_ALLOWED_ATTR = [
  'href',
  'title',
  'type',
  'checked',
  'disabled',
  'start',
  'align',
  'class',
] as const;

const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  renderer: {
    // 글 속 HTML(블록과 줄 안 모두)은 해석하지 않고 글자로 보인다
    html({ text, block }: Tokens.HTML | Tokens.Tag): string {
      const shown = escapeHtml(text);
      return block ? `<p>${shown}</p>\n` : shown;
    },
    // 그림은 주소를 쓰지 않는다: 설명 글만 (없으면 "이미지")
    image({ text }: Tokens.Image): string {
      const alt = text.trim() || t('panel.note.mdImage');
      return `<span class="md-image">${escapeHtml(alt)}</span>`;
    },
    link(
      this: { parser: { parseInline(tokens: Tokens.Generic[]): string } },
      { href, title, tokens }: Tokens.Link,
    ): string {
      const inner = this.parser.parseInline(tokens);
      const url = safeExternalUrl(href);
      if (!url) return inner;
      const tip = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(url)}"${tip}>${inner}</a>`;
    },
    // 할 일 목록의 체크 상자: 보기만 한다
    checkbox({ checked }: Tokens.Checkbox): string {
      return `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
    },
  },
});

/** 미리보기로 꾸며 보이는 글의 최대 길이. 넘으면 꾸미지 않고 글 그대로 보인다 (기호가 많은 긴 글은 꾸미기가 느려진다) */
export const MD_PREVIEW_MAX = 20_000;

/** 꾸미지 않은 글 그대로 */
const plainHtml = (src: string): string => `<pre>${escapeHtml(src)}</pre>`;

/**
 * 마크다운 글을 (아직 DOMPurify 를 거치지 않은) 안전하게 만든 HTML 글자로. 화면에는 sanitizeMarkdownHtml 을 거쳐 넣는다.
 * 너무 길거나 꾸미다 실패하면(목록이나 인용을 수천 겹 겹친 글은 호출이 너무 깊어진다) 글 그대로 보인다
 */
export function renderNoteMarkdown(src: string): string {
  if (src.length > MD_PREVIEW_MAX) return plainHtml(src);
  try {
    return marked.parse(src, { async: false });
  } catch {
    return plainHtml(src);
  }
}
