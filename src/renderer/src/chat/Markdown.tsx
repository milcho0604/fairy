import { Fragment, type ReactNode } from 'react';

// AI 답에 흔한 마크다운만 가볍게 보여 준다: 코드 블록, 인라인 코드, 굵게, 목록, 제목.
// HTML 로 넣지 않고 React 요소로 만들어 답에 섞인 태그가 실행될 일이 없다.

function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) body.push(lines[i++] ?? '');
      i++;
      blocks.push(
        <pre key={`b${i}`}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
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
            <li key={`${i}-${j}`}>{inline(it, `${i}-${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h${i}`} className="md-heading">
          {inline(heading[1] ?? '', `h${i}`)}
        </p>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !(lines[i] ?? '').startsWith('```') &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? '') &&
      !/^#{1,4}\s/.test(lines[i] ?? '')
    ) {
      para.push(lines[i++] ?? '');
    }
    if (para.length) blocks.push(<p key={`p${i}`}>{inline(para.join('\n'), `p${i}`)}</p>);
    else i++;
  }
  return <>{blocks}</>;
}
