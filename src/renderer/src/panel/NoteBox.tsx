import { useEffect, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { NoteBox as Box, NoteView } from '../../../shared/note-ipc.ts';
import './note-box.css';

// 쪽지함 (오늘 탭, 매일 쪽지 shared/daily-note.ts): 받은 쪽지를 최근 것부터. 누르면 펼쳐지고 읽은 것으로 친다
// (특별한 편지는 이때 코인). 못 본 쪽지도 여기서 읽는다. 쪽지가 하나도 없고 설정이 꺼져 있으면 아무것도 안 그린다

const bridge = window.jjakkungNotes;
/** 처음에 보이는 수 (더 보기로 나머지) */
const FIRST = 3;

export function NoteBox() {
  const [box, setBox] = useState<Box>();
  const [open, setOpen] = useState<string>();
  const [more, setMore] = useState(false);
  useEffect(() => {
    void bridge.list().then(setBox);
    bridge.onChange(setBox);
  }, []);
  if (!box || (!box.on && box.notes.length === 0)) return null;
  const unread = box.notes.filter((n) => !n.read).length;
  const shown = more ? box.notes : box.notes.slice(0, FIRST);
  const toggle = (n: NoteView) => {
    const next = open === n.day ? undefined : n.day;
    setOpen(next);
    if (next && !n.read) bridge.read(n.day);
  };
  return (
    <section className="note-box" aria-labelledby="note-box-title">
      <h2>
        <span id="note-box-title">{t('note.box')}</span>
        {unread > 0 && <small className="note-unread">{t('note.boxUnread', { n: unread })}</small>}
      </h2>
      {box.notes.length === 0 ? (
        <p className="empty-line">{box.on ? t('note.boxEmpty') : t('note.boxOff')}</p>
      ) : (
        <ul className="note-list">
          {shown.map((n) => (
            <li key={n.day} className={`note-item ${n.look}${n.read ? '' : ' unread'}`}>
              <button
                type="button"
                className="note-head"
                aria-expanded={open === n.day}
                aria-controls={`note-${n.day}`}
                onClick={() => toggle(n)}
              >
                <NoteIcon look={n.look} />
                <span className="note-title" dir="auto">
                  {n.title}
                </span>
                {!n.read && <span className="note-new">{t('note.new')}</span>}
              </button>
              {open === n.day && (
                <div className="note-paper" id={`note-${n.day}`}>
                  {n.lines.map((line, i) => (
                    // 같은 쪽지 안 줄 순서는 바뀌지 않는다
                    // biome-ignore lint/suspicious/noArrayIndexKey: 줄 글이 같을 수 있어 자리로 가린다
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {box.notes.length > FIRST && (
        <button type="button" className="link note-more" onClick={() => setMore(!more)}>
          {more ? t('note.boxLess') : t('note.boxMore', { n: box.notes.length - FIRST })}
        </button>
      )}
      {!box.on && box.notes.length > 0 && <p className="empty-line">{t('note.boxOff')}</p>}
    </section>
  );
}

/** 접은 쪽지와 하트 봉투 작은 그림 (펫이 드는 것과 같은 모양) */
function NoteIcon({ look }: { look: NoteView['look'] }) {
  if (look === 'letter')
    return (
      <svg className="note-icon" viewBox="0 0 22 16" width="22" height="16" aria-hidden="true">
        <rect x="1" y="1" width="20" height="14" rx="2" fill="#ffe1ea" stroke="#c9849a" strokeWidth="1.3" />
        <path d="M1.8 1.8 11 9.2l9.2-7.4" fill="none" stroke="#c9849a" strokeWidth="1.3" />
        <path
          d="M11 13.4c-3-2-3.7-3.4-3.3-4.6.5-1.3 2.2-1.5 3.3-.3 1.1-1.2 2.8-1 3.3.3.4 1.2-.3 2.6-3.3 4.6z"
          fill="#ff6b8a"
        />
      </svg>
    );
  return (
    <svg className="note-icon" viewBox="0 0 22 16" width="22" height="16" aria-hidden="true">
      <path d="M1 1h15l5 5v9H1z" fill="#fffaf0" stroke="#b8a27a" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M16 1v5h5" fill="#efe3c8" stroke="#b8a27a" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4 8h11M4 11h8" stroke="#d6c4a0" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
