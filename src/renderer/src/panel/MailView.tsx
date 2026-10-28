import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { locale, t } from '../../../shared/i18n/index.ts';
import {
  countsOf,
  groupMail,
  inFilter,
  MAIL_FILTERS,
  type MailFilter,
  type MailItem,
  searchMail,
  sortMail,
} from '../../../shared/mail.ts';
import type { MailAct } from '../../../shared/note-ipc.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { isEsc, takeEsc } from './keys.ts';
import { setMailBox, useMailBox } from './mail-state.ts';
import { Overlay, useSurface } from './surface.tsx';
import type { Zone } from './zone.ts';
import './mail.css';

// 쪽지함 (feat/mailbox, shared/mail.ts): 받은 펫 쪽지, 서버 쪽지, 공지를 한곳에서 다시 읽는다.
// 안 읽음 표시, 찾기, 종류 칩, 날짜 묶음, 읽음과 보관과 고정과 지우기(휴지통 30일, 되돌리기). 좁은 폭(작은 패널)은 목록에서 쪽지를 누르면
// 내용 화면으로 가고(뒤로), 넓은 폭(큰 창)은 목록과 내용이 나란히 있다.

const bridge = window.jjakkungNotes;

/** 접은 쪽지와 하트 봉투 작은 그림 (펫이 드는 것과 같은 모양) */
function NoteIcon({ look }: { look: MailItem['look'] }) {
  if (look === 'letter')
    return (
      <svg className="mail-icon" viewBox="0 0 22 16" width="22" height="16" aria-hidden="true">
        <rect x="1" y="1" width="20" height="14" rx="2" fill="#ffe1ea" stroke="#c9849a" strokeWidth="1.3" />
        <path d="M1.8 1.8 11 9.2l9.2-7.4" fill="none" stroke="#c9849a" strokeWidth="1.3" />
        <path
          d="M11 13.4c-3-2-3.7-3.4-3.3-4.6.5-1.3 2.2-1.5 3.3-.3 1.1-1.2 2.8-1 3.3.3.4 1.2-.3 2.6-3.3 4.6z"
          fill="#ff6b8a"
        />
      </svg>
    );
  return (
    <svg className="mail-icon" viewBox="0 0 22 16" width="22" height="16" aria-hidden="true">
      <path d="M1 1h15l5 5v9H1z" fill="#fffaf0" stroke="#b8a27a" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M16 1v5h5" fill="#efe3c8" stroke="#b8a27a" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4 8h11M4 11h8" stroke="#d6c4a0" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 목록 줄 오른쪽 시각: 오늘은 시각, 그 전은 월/일 */
function whenOf(m: MailItem, today: string): string {
  const d = new Date(m.at);
  return m.day === today
    ? d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' });
}

/** 내용 화면의 받은 때: 월/일 시각 */
const fullWhen = (m: MailItem): string =>
  new Date(m.at).toLocaleString(locale(), {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

interface Toast {
  id: string;
  kind: 'deleted' | 'archived';
}

/** 쪽지함 본문. sheet 면 작은 패널의 덮개 안(머리에 닫기 단추), 아니면 큰 창 구역 */
export function MailView({
  zone,
  sheet = false,
  onClose,
}: {
  zone: Zone;
  sheet?: boolean;
  onClose?: () => void;
}) {
  const box = useMailBox();
  const [filter, setFilter] = useState<MailFilter>('all');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [toast, setToast] = useState<Toast>();
  const [msg, setMsg] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const today = localDay(Date.now());
  const wide = zone === 'wide';
  const items = box?.items ?? [];
  const counts = useMemo(() => countsOf(items), [items]);
  const list = useMemo(
    () =>
      sortMail(
        searchMail(
          items.filter((m) => inFilter(m, filter)),
          query,
        ),
      ),
    [items, filter, query],
  );
  const groups = useMemo(() => groupMail(list, today), [list, today]);
  const item = items.find((m) => m.id === sel);
  const showDetail = Boolean(item) && (wide || detailOpen);

  // 고른 쪽지가 이 목록에서 사라졌으면(지움, 보관, 칩 바꿈) 내용 화면을 닫는다
  useEffect(() => {
    if (sel && !list.some((m) => m.id === sel)) {
      setSel(undefined);
      setDetailOpen(false);
    }
  }, [list, sel]);

  // 되돌리기 알림은 몇 초 뒤 사라진다
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // 덮개: Esc 는 내용 화면에서 목록으로, 목록에서 덮개 닫기 (창 전체 Esc 보다 먼저 받아 먹는다)
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isEsc(e)) return;
      takeEsc(e);
      if (detailOpen) setDetailOpen(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet, detailOpen, onClose]);

  const pick = useCallback((m: MailItem) => {
    setSel(m.id);
    setDetailOpen(true);
    setMsg('');
    // 안 읽은 쪽지를 펼치면 읽은 것 (특별한 편지는 코인, 받을 것이 있는 서버 쪽지는 서버에서 열어 받는다)
    if (!m.read && !m.deleted) bridge.read(m.id);
  }, []);

  const run = async (m: MailItem, act: MailAct) => {
    const r = await bridge.act(m.id, act);
    if (!r) return;
    if (!r.ok) {
      setMsg(r.reason === 'cantRemove' ? t('mail.cantRemove') : '');
      return;
    }
    setMsg('');
    setMailBox(r.box);
    if (act === 'delete') setToast({ id: m.id, kind: 'deleted' });
    else if (act === 'archive') setToast({ id: m.id, kind: 'archived' });
  };
  const undo = async () => {
    if (!toast) return;
    const r = await bridge.act(toast.id, toast.kind === 'deleted' ? 'restore' : 'unarchive');
    if (r?.ok) setMailBox(r.box);
    setToast(undefined);
  };
  const readAll = async () => {
    const b = await bridge.readAll();
    if (b) setMailBox(b);
  };
  const more = async () => {
    setLoadingMore(true);
    try {
      const b = await bridge.more();
      if (b) setMailBox(b);
    } finally {
      setLoadingMore(false);
    }
  };

  /** 목록에서 위아래 화살표로 줄을 옮긴다 */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = [...el.querySelectorAll<HTMLElement>('.mail-row')];
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const chips = MAIL_FILTERS.filter(
    (f) => (f !== 'archived' && f !== 'trash') || counts[f] > 0 || filter === f,
  );
  const unread = box?.unread ?? 0;
  const emptyText = !box
    ? ''
    : query.trim()
      ? t('mail.searchNone')
      : box.items.length === 0
        ? box.on
          ? t('mail.empty')
          : t('mail.off')
        : t('mail.emptyFilter');

  return (
    <section
      className="mail"
      data-zone={zone}
      data-sheet={sheet ? '' : undefined}
      aria-label={t('mail.title')}
    >
      <header className="mail-head">
        {sheet && (
          <button
            type="button"
            className="icon-btn mail-close"
            onClick={onClose}
            aria-label={t('mail.close')}
            title={t('mail.close')}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M10 3L5 8l5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {/* 큰 창은 구역 제목줄에 이미 "쪽지함"이 있어 여기서는 화면 읽기 프로그램에만 */}
        <h2>
          <span className={sheet ? undefined : 'sr-only'}>{t('mail.title')}</span>
          {unread > 0 && <small className="mail-unread">{t('mail.unreadN', { n: unread })}</small>}
        </h2>
        <button
          type="button"
          className="link mail-readall"
          disabled={unread === 0}
          onClick={() => void readAll()}
        >
          {t('mail.readAll')}
        </button>
      </header>
      <div className="mail-tools">
        <input
          type="search"
          className="mail-search"
          value={query}
          placeholder={t('mail.search')}
          aria-label={t('mail.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <fieldset className="mail-chips" aria-label={t('mail.filters')}>
          {chips.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              className={filter === f ? 'on' : ''}
              onClick={() => setFilter(f)}
            >
              {t(`mail.filter.${f}`)}
              {counts[f] > 0 && f !== 'all' && <span className="mail-count">{counts[f]}</span>}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="mail-body">
        <div className="mail-list-pane" hidden={!wide && showDetail} ref={listRef}>
          {list.length === 0 ? (
            <p className="empty-line mail-empty">{emptyText}</p>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="mail-group" aria-label={t(`mail.group.${g.id}`)}>
                <h3>{t(`mail.group.${g.id}`)}</h3>
                <ul>
                  {g.items.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={`mail-row ${m.look}${m.read ? '' : ' unread'}${sel === m.id ? ' current' : ''}`}
                        aria-current={sel === m.id ? 'true' : undefined}
                        onClick={() => pick(m)}
                      >
                        <NoteIcon look={m.look} />
                        <span className="mail-row-main">
                          <span className="mail-row-title" dir="auto">
                            {m.title}
                          </span>
                          {m.preview && m.preview !== m.title && (
                            <span className="mail-row-prev" dir="auto">
                              {m.preview}
                            </span>
                          )}
                        </span>
                        <span className="mail-row-meta">
                          {!m.read && !m.deleted && <span className="mail-new">{t('mail.new')}</span>}
                          {m.pinned && (
                            <>
                              <span className="mail-pin" aria-hidden="true" />
                              <span className="sr-only">{t('mail.pinned')}</span>
                            </>
                          )}
                          <span className="mail-when">{whenOf(m, today)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {box?.hasMore && (
            <button
              type="button"
              className="link mail-more"
              disabled={loadingMore}
              onClick={() => void more()}
            >
              {loadingMore ? t('mail.moreLoading') : t('mail.more')}
            </button>
          )}
        </div>
        <section className="mail-detail-pane" hidden={!wide && !showDetail} aria-label={t('mail.detail')}>
          {item && showDetail ? (
            <Detail
              item={item}
              narrow={!wide}
              msg={msg}
              onBack={() => setDetailOpen(false)}
              onAct={(act) => void run(item, act)}
            />
          ) : (
            <p className="empty-line mail-empty">{t('mail.pick')}</p>
          )}
        </section>
      </div>
      {toast && (
        <div className="mail-toast" role="status">
          <span>{toast.kind === 'deleted' ? t('mail.deleted') : t('mail.archived')}</span>
          <button type="button" className="link" onClick={() => void undo()}>
            {t('mail.undo')}
          </button>
        </div>
      )}
    </section>
  );
}

function Detail({
  item,
  narrow,
  msg,
  onBack,
  onAct,
}: {
  item: MailItem;
  narrow: boolean;
  msg: string;
  onBack: () => void;
  onAct: (act: MailAct) => void;
}) {
  return (
    <>
      {narrow && (
        <button type="button" className="link mail-back" onClick={onBack}>
          {t('mail.back')}
        </button>
      )}
      <article className={`mail-paper ${item.look}`}>
        <h3 dir="auto">{item.title}</h3>
        <p className="mail-meta">
          {item.from && <span>{t('mail.from', { name: item.from })}</span>}
          <span>{fullWhen(item)}</span>
        </p>
        <div className="mail-lines">
          {item.lines.map((line, i) => (
            // 같은 쪽지 안 줄 순서는 바뀌지 않는다
            // biome-ignore lint/suspicious/noArrayIndexKey: 줄 글이 같을 수 있어 자리로 가린다
            <p key={i} dir="auto">
              {line}
            </p>
          ))}
        </div>
        {item.link && (
          <p>
            <a
              href={item.link}
              onClick={(e) => {
                e.preventDefault();
                window.jjakkungNotes.openLink(item.id);
              }}
            >
              {t('mail.openLink')}
            </a>
          </p>
        )}
      </article>
      {item.deleted ? (
        <>
          <div className="mail-actions">
            <button type="button" onClick={() => onAct('restore')}>
              {t('mail.restore')}
            </button>
          </div>
          <small className="mail-hint">{t('mail.trashHint')}</small>
        </>
      ) : (
        <div className="mail-actions">
          {item.read && (
            <button type="button" onClick={() => onAct('unread')}>
              {t('mail.markUnread')}
            </button>
          )}
          <button
            type="button"
            aria-pressed={item.pinned}
            onClick={() => onAct(item.pinned ? 'unpin' : 'pin')}
          >
            {item.pinned ? t('mail.unpin') : t('mail.pin')}
          </button>
          <button type="button" onClick={() => onAct(item.archived ? 'unarchive' : 'archive')}>
            {item.archived ? t('mail.unarchive') : t('mail.archive')}
          </button>
          <button type="button" className="danger" onClick={() => onAct('delete')}>
            {t('mail.delete')}
          </button>
        </div>
      )}
      {msg && (
        <p className="mail-msg" role="alert">
          {msg}
        </p>
      )}
    </>
  );
}

/** 작은 패널의 쪽지함 덮개: 패널 본문 위를 덮는다 (머리줄 봉투 단추가 연다) */
export function MailSheet({ onClose }: { onClose: () => void }) {
  const { zone } = useSurface();
  return (
    <Overlay>
      <div className="mail-sheet" role="dialog" aria-modal="true" aria-label={t('mail.title')}>
        <MailView zone={zone} sheet onClose={onClose} />
      </div>
    </Overlay>
  );
}

/** 큰 창 사이드바 "쪽지함" 구역의 본문 */
export function MailPage() {
  const { zone } = useSurface();
  return (
    <div className="mail-page">
      <MailView zone={zone} />
    </div>
  );
}
