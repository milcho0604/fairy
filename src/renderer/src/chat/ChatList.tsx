import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { AiProvider } from '../../../shared/ai/types.ts';
import type { ThreadMeta } from '../../../shared/chat-threads.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ThreadList } from '../../../shared/ipc.ts';
import { threadDate } from './threadDate.ts';
import './chat-list.css';

/** 이름 바꾸기 실패 안내가 보이는 시간 */
const FAILURE_MS = 6000;

const bridge = window.jjakkungChat;
/** 한 번에 그리는 줄 수. 수백 개여도 처음 그리기가 무겁지 않게 더 보기로 늘린다 */
export const PAGE = 100;

interface Props {
  /** 답을 기다리는 중 (다른 대화를 열 수 없다) */
  pending: boolean;
  /** 기록 안 남김 중 (지난 대화를 열 수 없다) */
  ephemeral: boolean;
  /** 대화가 바뀌면(답이 끝남, 새 대화) 목록을 다시 읽는다 */
  version: string;
  labelOf: (id?: AiProvider) => string;
  onOpened: () => void;
  onClose: () => void;
}

/** 지난 대화 목록: 열어서 이어 말하기, 이름 바꾸기, 지우기(앱 안에서 한 번 더 묻는다), 찾기 */
export function ChatList({ pending, ephemeral, version, labelOf, onOpened, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ThreadList>();
  const [shown, setShown] = useState(PAGE);
  const [renaming, setRenaming] = useState<{ id: string; title: string }>();
  const [confirming, setConfirming] = useState<string>();
  const [status, setStatus] = useState('');
  /** 눈에 보이는 실패 안내 (이름 바꾸기). status 는 화면 읽기 전용이라 따로 둔다 */
  const [failure, setFailure] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (q: string) => {
    setList(await bridge.threads(q));
  }, []);

  // 찾는 말은 치는 동안 조금 기다렸다 묻는다 (한 글자마다 목차를 다시 고르지 않게)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version 이 바뀌면 다시 읽는다
  useEffect(() => {
    const id = setTimeout(() => void load(query), query ? 120 : 0);
    return () => clearTimeout(id);
  }, [query, version, load]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const open = async (m: ThreadMeta) => {
    if (m.id === list?.current) {
      onClose();
      return;
    }
    if (await bridge.openThread(m.id)) onOpened();
    else setStatus(t('chat.list.openFailed'));
  };

  // 실패 안내는 잠깐만 둔다 (그 대화가 없어져 입력칸이 사라졌으면 취소로 걷을 수도 없다)
  useEffect(() => {
    if (!failure) return;
    const id = setTimeout(() => setFailure(''), FAILURE_MS);
    return () => clearTimeout(id);
  }, [failure]);

  const editRename = (v: { id: string; title: string } | undefined) => {
    setFailure('');
    setRenaming(v);
  };

  const saveRename = async () => {
    if (!renaming) return;
    let ok = false;
    try {
      ok = await bridge.renameThread(renaming.id, renaming.title);
    } catch {
      ok = false;
    }
    if (!ok) {
      // 입력은 그대로 두고 까닭을 보인다 (다시 저장하거나 취소할 수 있게)
      setFailure(t('chat.list.renameFailed'));
      await load(query);
      return;
    }
    setFailure('');
    editRename(undefined);
    await load(query);
  };

  const remove = async (id: string) => {
    setConfirming(undefined);
    if (await bridge.deleteThread(id)) setStatus(t('chat.list.deleted'));
    await load(query);
    // 지운 줄에 있던 포커스를 찾기 칸으로 돌린다
    searchRef.current?.focus();
  };

  const threads = list?.threads ?? [];
  const blocked = ephemeral ? t('chat.list.ephemeralBlocked') : pending ? t('chat.list.busy') : '';

  return (
    <div className="sheet chat-list" role="dialog" aria-modal="true" aria-label={t('chat.list.title')}>
      <div className="sheet-head">
        <strong>{t('chat.list.title')}</strong>
        <button type="button" className="ghost" onClick={onClose}>
          {t('chat.close')}
        </button>
      </div>
      <input
        ref={searchRef}
        className="list-search"
        type="search"
        value={query}
        placeholder={t('chat.list.search')}
        aria-label={t('chat.list.search')}
        onChange={(e) => {
          setQuery(e.target.value);
          setShown(PAGE);
        }}
      />
      {blocked && <p className="list-note">{blocked}</p>}
      {failure && (
        <p className="list-note" role="alert">
          {failure}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
      {list && threads.length === 0 && (
        <p className="list-empty">{query.trim() ? t('chat.list.noMatch') : t('chat.list.empty')}</p>
      )}
      <ul className="thread-list">
        {threads.slice(0, shown).map((m) => {
          const title = m.title || t('chat.list.untitled');
          const current = m.id === list?.current;
          const ai = m.provider ? labelOf(m.provider) : '';
          if (renaming?.id === m.id)
            return (
              <li key={m.id} className="thread editing">
                <form
                  className="rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveRename();
                  }}
                >
                  <input
                    // biome-ignore lint/a11y/noAutofocus: 이름 바꾸기를 누르면 바로 고쳐 쓰게
                    autoFocus
                    value={renaming.title}
                    maxLength={80}
                    aria-label={t('chat.list.renameLabel', { title })}
                    aria-describedby={`rename-hint-${m.id}`}
                    onChange={(e) => editRename({ id: m.id, title: e.target.value })}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      // Esc 는 이름 바꾸기만 끝낸다 (목록이나 창을 닫지 않게)
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        editRename(undefined);
                      }
                    }}
                  />
                  <button type="submit" className="ghost small">
                    {t('chat.list.save')}
                  </button>
                  <button type="button" className="ghost small" onClick={() => editRename(undefined)}>
                    {t('common.cancel')}
                  </button>
                </form>
                <small id={`rename-hint-${m.id}`} className="hint">
                  {t('chat.list.renameHint')}
                </small>
              </li>
            );
          return (
            <li key={m.id} className={`thread ${current ? 'current' : ''}`}>
              <button
                type="button"
                className="thread-open"
                disabled={!current && !!blocked}
                aria-current={current || undefined}
                onClick={() => void open(m)}
              >
                <span className="thread-title" dir="auto">
                  {title}
                </span>
                <span className="thread-meta">
                  <span>{threadDate(m.updatedAt)}</span>
                  {ai && <span className="tag">{ai}</span>}
                  {current && <span className="tag now">{t('chat.list.current')}</span>}
                </span>
              </button>
              {confirming === m.id ? (
                <div className="confirm" role="alertdialog" aria-label={t('chat.list.confirmDelete')}>
                  <p>{t('chat.list.confirmDelete')}</p>
                  <small>{t('chat.list.deleteNote')}</small>
                  <div className="action-row">
                    <button
                      type="button"
                      className="ghost small danger"
                      // biome-ignore lint/a11y/noAutofocus: 지울지 묻자마자 고를 수 있게
                      autoFocus
                      onClick={() => void remove(m.id)}
                    >
                      {t('chat.list.delete')}
                    </button>
                    <button type="button" className="ghost small" onClick={() => setConfirming(undefined)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="thread-actions">
                  <button
                    type="button"
                    className="ghost small"
                    aria-label={t('chat.list.renameLabel', { title })}
                    onClick={() => editRename({ id: m.id, title: m.title })}
                  >
                    {t('chat.list.rename')}
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    // 답을 기다리는 대화는 지우지 않는다 (끝나며 다시 저장된다)
                    disabled={current && pending}
                    aria-label={t('chat.list.deleteLabel', { title })}
                    onClick={() => setConfirming(m.id)}
                  >
                    {t('chat.list.delete')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {threads.length > shown && (
        <button type="button" className="ghost more" onClick={() => setShown((n) => n + PAGE)}>
          {t('chat.list.more', { n: threads.length - shown })}
        </button>
      )}
    </div>
  );
}
