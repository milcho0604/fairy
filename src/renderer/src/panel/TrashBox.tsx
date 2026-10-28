import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { TrashKind, TrashRecord } from '../../../shared/trash.ts';
import './records.css';

const bridge = window.jjakkungPanel;

/**
 * 할 일·메모·일정 휴지통. 30일 동안 보관한 뒤 자동 삭제한다. 열 때마다 목록을 새로 읽고,
 * 패널 상태의 trashCount 가 바뀌면 열려 있는 목록도 다시 읽는다.
 * always: 큰 창 기록 구역(#166)은 비어 있어도 줄을 보이고 펼쳐 둔다
 */
export function TrashBox({ s, always }: { s: PanelState; always?: boolean }) {
  const [open, setOpen] = useState(!!always);
  const [items, setItems] = useState<TrashRecord[]>([]);
  const [kind, setKind] = useState<TrashKind | 'all'>('all');
  const [confirmAll, setConfirmAll] = useState(false);
  // 영구 삭제를 한 번 더 물어보는 항목
  const [confirmOne, setConfirmOne] = useState<TrashRecord | null>(null);
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
  if (s.trashCount === 0 && !open && !always) return null;

  const restore = async (item: TrashRecord) => {
    const res = await bridge.trashRestore(item.kind, item.id);
    setNote(
      res === 'ok'
        ? t('records.trash.restored', { title: item.title })
        : t(
            res === 'dup'
              ? item.kind === 'event'
                ? 'records.trash.dupEvent'
                : 'records.trash.dup'
              : 'records.trash.gone',
          ),
    );
    await load();
  };
  const purge = async (item: TrashRecord) => {
    await bridge.trashPurge(item.kind, item.id);
    setConfirmOne(null);
    setNote('');
    await load();
  };
  const emptyAll = async () => {
    await bridge.trashEmpty();
    setConfirmAll(false);
    setNote('');
    await load();
  };
  const visible = kind === 'all' ? items : items.filter((item) => item.kind === kind);

  return (
    <div className="trash">
      <button
        type="button"
        className="done-toggle trash-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmAll(false);
          setConfirmOne(null);
          setNote('');
        }}
      >
        {t('records.trash.toggle', { n: s.trashCount })}
      </button>
      {open && (
        <div className="trash-body">
          <small className="trash-hint">{t('records.trash.hint')}</small>
          <div className="trash-actions">
            {(['all', 'todo', 'note', 'event'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className="link"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setConfirmOne(null);
                }}
              >
                {t(`records.trash.${k}`)}
              </button>
            ))}
          </div>
          {note && (
            <small className="trash-note" role="status">
              {note}
            </small>
          )}
          {visible.length === 0 ? (
            <p className="trash-empty">{t('records.trash.empty')}</p>
          ) : (
            <ul className="todos trash-list">
              {visible.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="todo trash-item" data-id={item.id}>
                  <span className="trash-text">
                    <span className="title" dir="auto">
                      {item.title || t('records.trash.event')}
                    </span>
                    <small>
                      {item.kind === 'todo' && item.doneAt !== null && (
                        <span className="trash-done">{t('records.trash.done')}, </span>
                      )}
                      {item.kind === 'note' && item.preview ? `${item.preview}, ` : ''}
                      {item.kind === 'event' && (
                        <span className="trash-line">
                          {t('records.trash.eventWhen', { date: new Date(item.startAt).toLocaleString() })}
                        </span>
                      )}
                      {item.kind === 'event' ? (
                        <span className="trash-line">{t('records.trash.left', { n: item.daysLeft })}</span>
                      ) : (
                        t('records.trash.left', { n: item.daysLeft })
                      )}
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
                      onClick={() => {
                        setConfirmAll(false);
                        setConfirmOne(item);
                      }}
                    >
                      {t('records.trash.purge')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {confirmOne && (
            <div
              className="trash-confirm trash-confirm-one"
              role="alertdialog"
              aria-label={t('records.trash.purgeOf', { title: confirmOne.title })}
            >
              <small>
                {t('records.trash.confirmOne', { title: confirmOne.title || t('records.trash.event') })}
              </small>
              <span className="trash-actions">
                <button type="button" className="link danger" onClick={() => void purge(confirmOne)}>
                  {t('records.trash.confirmYes')}
                </button>
                <button type="button" className="link" onClick={() => setConfirmOne(null)}>
                  {t('records.trash.confirmNo')}
                </button>
              </span>
            </div>
          )}
          {visible.length > 0 &&
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
                onClick={() => {
                  setConfirmOne(null);
                  setConfirmAll(true);
                }}
              >
                {t('records.trash.emptyAll')}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
