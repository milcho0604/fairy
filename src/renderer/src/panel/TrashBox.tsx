import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { TrashItem } from '../../../shared/todo-store.ts';
import './records.css';

const bridge = window.jjakkungPanel;

/**
 * 할 일 휴지통 (#125). 지운 할 일을 30일 동안 모아 두고 되살리거나 영구 삭제한다 (30일이 지나면 저절로 사라진다).
 * 코인은 지울 때도 되살릴 때도 움직이지 않는다. 열 때마다 목록을 새로 읽고(그때 30일 지난 것을 메인이 지운다),
 * 패널 상태의 trashCount 가 바뀌면 열려 있는 목록도 다시 읽는다
 */
export function TrashBox({ s }: { s: PanelState }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [note, setNote] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const list = await bridge.trashList();
    if (alive.current) setItems(list);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: trashCount 가 바뀌면 다시 읽는다
  useEffect(() => {
    if (open) void load();
  }, [open, s.trashCount, load]);

  // 휴지통에 아무것도 없고 닫혀 있으면 줄을 그리지 않는다
  if (s.trashCount === 0 && !open) return null;

  const restore = async (item: TrashItem) => {
    const todo = await bridge.trashRestore(item.id);
    setNote(todo ? t('records.trash.restored', { title: item.title }) : t('records.trash.gone'));
    await load();
  };
  const purge = async (item: TrashItem) => {
    await bridge.trashPurge(item.id);
    setNote('');
    await load();
  };
  const emptyAll = async () => {
    await bridge.trashEmpty();
    setConfirmAll(false);
    setNote('');
    await load();
  };

  return (
    <div className="trash">
      <button
        type="button"
        className="done-toggle trash-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmAll(false);
          setNote('');
        }}
      >
        {t('records.trash.toggle', { n: s.trashCount })}
      </button>
      {open && (
        <div className="trash-body">
          <small className="trash-hint">{t('records.trash.hint')}</small>
          {note && (
            <small className="trash-note" role="status">
              {note}
            </small>
          )}
          {items.length === 0 ? (
            <p className="trash-empty">{t('records.trash.empty')}</p>
          ) : (
            <ul className="todos trash-list">
              {items.map((item) => (
                <li key={item.id} className="todo trash-item" data-id={item.id}>
                  <span className="trash-text">
                    <span className="title" dir="auto">
                      {item.title}
                    </span>
                    <small>
                      {item.doneAt !== null && (
                        <span className="trash-done">{t('records.trash.done')}, </span>
                      )}
                      {t('records.trash.left', { n: item.daysLeft })}
                    </small>
                  </span>
                  <span className="trash-actions">
                    <button
                      type="button"
                      className="link"
                      aria-label={t('records.trash.restoreOf', { title: item.title })}
                      onClick={() => void restore(item)}
                    >
                      {t('records.trash.restore')}
                    </button>
                    <button
                      type="button"
                      className="link danger"
                      aria-label={t('records.trash.purgeOf', { title: item.title })}
                      onClick={() => void purge(item)}
                    >
                      {t('records.trash.purge')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 &&
            (confirmAll ? (
              <div className="trash-confirm" role="alertdialog" aria-label={t('records.trash.emptyAll')}>
                <small>{t('records.trash.confirmAll', { n: items.length })}</small>
                <span className="trash-actions">
                  <button type="button" className="link danger" onClick={() => void emptyAll()}>
                    {t('records.trash.confirmYes')}
                  </button>
                  <button type="button" className="link" onClick={() => setConfirmAll(false)}>
                    {t('records.trash.confirmNo')}
                  </button>
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="link danger trash-empty-all"
                onClick={() => setConfirmAll(true)}
              >
                {t('records.trash.emptyAll')}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
