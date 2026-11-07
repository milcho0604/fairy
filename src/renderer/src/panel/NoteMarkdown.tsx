import DOMPurify from 'dompurify';
import { forwardRef, useMemo } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import { safeExternalUrl } from '../../../shared/links.ts';
import { MD_ALLOWED_ATTR, MD_ALLOWED_TAGS, renderNoteMarkdown } from '../../../shared/note-markdown.ts';
import { useLanguage } from '../language-context.ts';

/** 이 파일만 쓰는 DOMPurify (전역 설정을 건드리지 않는다) */
let purifier: ReturnType<typeof DOMPurify> | undefined;

function purify(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  // 마크다운 단계(note-markdown.ts)에서 이미 걸렀지만, 한 번 더 확인한다:
  // 링크는 http, https 만 남기고 새 창을 못 열게, 체크 상자는 눌러도 안 바뀌는 표시만
  p.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute('href');
      const url = href === null ? undefined : safeExternalUrl(href);
      if (url) {
        node.setAttribute('href', url);
        node.setAttribute('rel', 'noopener noreferrer');
      } else node.removeAttribute('href');
      node.removeAttribute('target');
    }
    // 글 속 <input> 은 마크다운 단계에서 이미 글자가 됐으니, 남은 input 은 할 일 목록의 체크 상자뿐이다.
    // DOMPurify 는 input 의 type 을 걷어 가므로 여기서 체크 상자로 되돌리고 눌러도 안 바뀌게 잠근다
    if (node instanceof HTMLInputElement) {
      node.setAttribute('type', 'checkbox');
      node.setAttribute('disabled', '');
      node.setAttribute('tabindex', '-1');
    }
  });
  purifier = p;
  return p;
}

/** 마크다운 글을 화면에 넣어도 되는 HTML 글자로. 마크다운 단계 뒤에 DOMPurify 로 한 번 더 거른다 */
export function previewHtml(source: string): string {
  return purify().sanitize(renderNoteMarkdown(source), {
    ALLOWED_TAGS: [...MD_ALLOWED_TAGS],
    ALLOWED_ATTR: [...MD_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}

/**
 * 마크다운 메모의 미리보기. 링크는 창을 옮기지 않고 onLink 로 넘긴다 (메인이 기본 브라우저로 연다).
 * 글 칸이 아니라 읽는 칸이라 Esc 가 편집기 전체에 닿도록 초점을 받을 수 있게 둔다 (tabIndex)
 */
export const NoteMarkdown = forwardRef<HTMLElement, { source: string; onLink: (url: string) => void }>(
  function NoteMarkdown({ source, onLink }, ref) {
    useLanguage();
    const html = useMemo(() => previewHtml(source), [source]);
    const open = (e: { target: EventTarget; preventDefault(): void }) => {
      const a = e.target instanceof Element ? e.target.closest('a') : null;
      if (!a) return;
      // 링크는 늘 막고, 밖으로 여는 일은 메인에 맡긴다
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) onLink(href);
    };
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: 링크는 진짜 <a> 라 Enter 도 click 으로 온다 (여기서 가로채 메인으로 넘긴다)
      <section
        ref={ref}
        className="note-preview md"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 읽는 칸이 초점을 받아야 Esc 로 목록에 돌아가고 방향키로 스크롤된다
        tabIndex={0}
        aria-label={t('panel.note.mode.preview')}
        onClick={open}
        onAuxClick={open}
      >
        {source.trim() ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: previewHtml 이 마크다운 단계와 DOMPurify 로 두 번 거른 글
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="md-empty">{t('panel.note.previewEmpty')}</p>
        )}
      </section>
    );
  },
);
