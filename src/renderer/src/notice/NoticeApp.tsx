import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoticeView } from '../../../shared/notice-ipc.ts';
import { useLanguageUpdates } from '../use-language.ts';

const bridge = window.jjakkungNotice;

/**
 * 공지 창 (main/notice-window.ts). 종류 표, 제목, 본문(글자만), 작은 글, 단추.
 * 본문은 React 글자로만 넣는다 (HTML 로 읽지 않는다). 그린 높이를 메인에 알려 창 높이를 맞춘다.
 */
export function NoticeApp() {
  useLanguageUpdates();
  const [view, setView] = useState<NoticeView>();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void bridge.get().then((v) => {
      if (v) setView(v);
    });
    bridge.onChange(setView);
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const send = () => bridge.size(Math.ceil(el.getBoundingClientRect().height));
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={`notice-box kind-${view?.kind ?? 'info'}`} ref={box}>
      <div className="drag" />
      {view && (
        <>
          <span className="badge">{view.badge}</span>
          <h1>{view.title}</h1>
          <p className="body">{view.body}</p>
          {view.notes.map((n) => (
            <p className="note" key={n}>
              {n}
            </p>
          ))}
          <div className="buttons">
            {view.buttons.map((b) => (
              <button
                key={b.id}
                type="button"
                className={b.primary ? 'primary' : 'ghost'}
                onClick={() => bridge.act(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
