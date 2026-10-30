import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import { safeExternalUrl, splitLinks } from '../../../shared/links.ts';
import { parseTable } from './md-table.ts';

// AI 답에 흔한 마크다운만 가볍게 보여 준다: 코드 블록, 인라인 코드, 굵게, 목록, 제목, 링크, 표.
// HTML 로 넣지 않고 React 요소로 만들어 답에 섞인 태그가 실행될 일이 없다.
// 링크는 http, https 만 누를 수 있고 앱 안에서 열지 않는다 (onLink 가 메인에 넘겨 기본 브라우저로)

type OnLink = (url: string) => void;

function Link({ url, label, onLink }: { url: string; label: ReactNode; onLink: OnLink }) {
  const open = (e: MouseEvent) => {
    e.preventDefault();
    onLink(url);
  };
  return (
    <a href={url} title={t('chat.linkTitle', { url })} onClick={open} onAuxClick={open} rel="noreferrer">
      {label}
    </a>
  );
}

/** 맨 주소를 링크로 */
function linked(text: string, key: string, onLink: OnLink): ReactNode[] {
  return splitLinks(text).map((p, i) => {
    const k = `${key}-u${i}`;
    if ('url' in p) return <Link key={k} url={p.url} label={p.text} onLink={onLink} />;
    return <Fragment key={k}>{p.text}</Fragment>;
  });
}

function inline(text: string, key: string, onLink: OnLink): ReactNode[] {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={k}>{linked(part.slice(2, -2), k, onLink)}</strong>;
    // [글](주소): 주소가 열 수 없는 것이면 글 그대로 둔다
    const md = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    const url = md ? safeExternalUrl(md[2]) : undefined;
    if (md && url) return <Link key={k} url={url} label={md[1]} onLink={onLink} />;
    return <Fragment key={k}>{linked(part, k, onLink)}</Fragment>;
  });
}

export function Markdown({ text, onLink }: { text: string; onLink: OnLink }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    // 작은 모델은 코드 블록을 들여 써서 낸다 ("  ```python"). 앞 공백은 봐준다
    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) body.push(lines[i++] ?? '');
      i++;
      blocks.push(
        <pre key={`b${i}`}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const table = parseTable(lines, i);
    if (table) {
      // 좁은 폭에서는 표만 가로로 밀린다. 칸 글은 inline 을 거쳐 React 글자 칸으로만 들어간다
      blocks.push(
        <div key={`t${i}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {table.head.map((h, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 한 번 그리면 순서가 바뀌지 않는다
                  <th key={j} style={{ textAlign: table.align[j] }}>
                    {inline(h, `t${i}h${j}`, onLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 한 번 그리면 순서가 바뀌지 않는다
                <tr key={ri}>
                  {r.map((c, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 한 번 그리면 순서가 바뀌지 않는다
                    <td key={j} style={{ textAlign: table.align[j] }}>
                      {inline(c, `t${i}r${ri}c${j}`, onLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i += table.length;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      // 같은 종류만 묶는다. 번호 목록 바로 뒤의 "-" 목록이 번호로 이어지지 않게. 들여 쓴 줄은 하위 항목이라 같이 둔다
      const sameKind = (l: string) =>
        /^\s+([-*]|\d+\.)\s+/.test(l) || (ordered ? /^\d+\.\s+/ : /^[-*]\s+/).test(l);
      while (i < lines.length && sameKind(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={`l${i}`}>
          {items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 답 글은 한 번 그리면 순서가 바뀌지 않는다
            <li key={`${i}-${j}`}>{inline(it, `${i}-${j}`, onLink)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h${i}`} className="md-heading">
          {inline(heading[1] ?? '', `h${i}`, onLink)}
        </p>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !(lines[i] ?? '').trimStart().startsWith('```') &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? '') &&
      !/^#{1,4}\s/.test(lines[i] ?? '') &&
      !parseTable(lines, i)
    ) {
      para.push(lines[i++] ?? '');
    }
    if (para.length) blocks.push(<p key={`p${i}`}>{inline(para.join('\n'), `p${i}`, onLink)}</p>);
    else i++;
  }
  return <>{blocks}</>;
}
