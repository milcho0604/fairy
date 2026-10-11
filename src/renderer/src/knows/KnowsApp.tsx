import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { KnowsPatch, KnowsSnapshot } from '../../../shared/bond-ipc.ts';
import { locale, t } from '../../../shared/i18n/index.ts';
import {
  addFact,
  birthdayParts,
  editMemory,
  editRule,
  FACT_LIKES_MAX,
  FACT_TEXT_MAX,
  type FactKind,
  forgetAll,
  type KnowRow,
  knowRows,
  type MemSource,
} from '../../../shared/knows.ts';
import {
  addMemory,
  approvePending,
  MEMORY_ITEM_MAX,
  MEMORY_MAX,
  memoryKey,
} from '../../../shared/pet-memory.ts';
import { PetFace } from '../PetFace.tsx';

// 짝꿍이 아는 것 (2026-10-11): 내가 알려 준 것(생일, 좋아하는 간식, 좋아하는 것), 기억, 기억해도 될지 묻는 것, 규칙.
// 줄마다 어디서 왔는지(대화, 직접, MCP)와 날짜, 고치기와 잊기. 맨 아래 모두 잊기 (한 번 더 묻는다)

const bridge = window.jjakkungBond;
type S = KnowsSnapshot['settings'];

const SRC_KEY: Record<MemSource, 'bond.src.chat' | 'bond.src.user' | 'bond.src.mcp'> = {
  chat: 'bond.src.chat',
  user: 'bond.src.user',
  mcp: 'bond.src.mcp',
};

/** 기억한 날: 올해면 월일, 아니면 연도까지 */
function dateLabel(at: number): string {
  const d = new Date(at);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), {
    ...(thisYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  });
}

/** 1~31 (월, 일 고르기) */
const NUMS = Array.from({ length: 31 }, (_, i) => i + 1);

const enter = (e: KeyboardEvent, run: () => void, cancel?: () => void) => {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) run();
  else if (e.key === 'Escape' && cancel) {
    e.preventDefault();
    cancel();
  }
};

export function KnowsApp() {
  const [snap, setSnap] = useState<KnowsSnapshot>();
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const [asking, setAsking] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    void bridge.knowsGet().then((v) => v && setSnap(v));
    bridge.onKnowsChanged((next) => setSnap((v) => v && { ...v, settings: next }));
  }, []);
  const name = snap?.settings.petName ?? '';
  useEffect(() => {
    if (name) document.title = t('bond.knows.title', { name });
  }, [name]);

  if (!snap) return <p className="loading">{t('bond.loading')}</p>;
  const s = snap.settings;

  const flash = (text: string, error = false) => {
    clearTimeout(noteTimer.current);
    setNote({ text, error });
    noteTimer.current = setTimeout(() => setNote(undefined), 2600);
  };
  const update = async (patch: KnowsPatch, message: string) => {
    const next = await bridge.knowsSet(patch);
    if (!next) {
      flash(t('bond.knows.failed'), true);
      return;
    }
    setSnap((v) => v && { ...v, settings: next });
    flash(message);
  };
  const rows = knowRows(s);
  const of = (kind: KnowRow['kind']) => rows.filter((r) => r.kind === kind);
  const empty = rows.length === 0;

  return (
    <div className={`settings knows ${snap.platform === 'darwin' ? 'mac' : ''}`}>
      <header>
        <PetFace />
        <strong>{t('bond.knows.title', { name })}</strong>
        {note && (
          <span className={`saved ${note.error ? 'error' : ''}`} role="status">
            {note.text}
          </span>
        )}
      </header>
      <main>
        <p className="knows-intro">{t('bond.knows.intro', { name })}</p>

        <section>
          <h2>{t('bond.knows.facts')}</h2>
          <div className="card">
            <small>{t('bond.knows.factsHint', { name })}</small>
            <Facts s={s} update={update} flash={flash} />
          </div>
        </section>

        <section>
          <h2>
            {t('bond.knows.memory')}{' '}
            <span className="count">{t('bond.knows.count', { n: s.petMemory.length, max: MEMORY_MAX })}</span>
          </h2>
          <div className="card">
            <small>{t('bond.knows.memoryHint')}</small>
            {of('memory').length === 0 ? (
              <p className="knows-empty">{t('bond.knows.memoryEmpty')}</p>
            ) : (
              <ul className="know-list">
                {of('memory').map((r) => (
                  <Item
                    key={r.id}
                    row={r}
                    max={MEMORY_ITEM_MAX}
                    onEdit={(text) => {
                      const e = editMemory(s.petMemory, r.text, text);
                      if (e.result === 'dupe') return flash(t('settings.memory.dupe'), true);
                      if (e.result === 'same') return;
                      void update(
                        { petMemory: e.list },
                        e.result === 'removed' ? t('settings.memory.deleted') : t('bond.knows.edited'),
                      );
                    }}
                    onDelete={() =>
                      void update(
                        { petMemory: s.petMemory.filter((m) => memoryKey(m) !== memoryKey(r.text)) },
                        t('settings.memory.deleted'),
                      )
                    }
                  />
                ))}
              </ul>
            )}
            <AddLine
              placeholder={t('settings.memory.placeholder')}
              label={t('settings.memory.add')}
              max={MEMORY_ITEM_MAX}
              onAdd={(text) => {
                const next = addMemory(s.petMemory, text);
                if (!next.added) {
                  flash(t('settings.memory.dupe'), true);
                  return false;
                }
                void update({ petMemory: next.list }, t('settings.memory.added'));
                return true;
              }}
            />
          </div>
        </section>

        {of('pending').length > 0 && (
          <section>
            <h2>{t('settings.memory.pending')}</h2>
            <div className="card">
              <small>{t('settings.memory.pendingHint')}</small>
              <ul className="know-list">
                {of('pending').map((r) => (
                  <li key={r.id} className="know-item pending">
                    <div className="know-text">
                      <span>{r.text}</span>
                      <Meta row={r} />
                    </div>
                    <span className="know-actions">
                      <button
                        type="button"
                        className="ghost small"
                        aria-label={t('settings.memory.approveAria', { text: r.text })}
                        onClick={() => {
                          const a = approvePending(s.petMemory, s.petMemoryPending, r.text);
                          if (a.result === 'full')
                            return flash(t('settings.memory.full', { max: MEMORY_MAX }), true);
                          void update(
                            { petMemory: a.list, petMemoryPending: a.pending },
                            a.result === 'added' ? t('settings.memory.added') : t('settings.memory.dupe'),
                          );
                        }}
                      >
                        {t('settings.memory.approve')}
                      </button>
                      <button
                        type="button"
                        className="link"
                        aria-label={t('settings.memory.dismissAria', { text: r.text })}
                        onClick={() =>
                          void update(
                            { petMemoryPending: s.petMemoryPending.filter((p) => p !== r.text) },
                            t('settings.memory.dismissed'),
                          )
                        }
                      >
                        {t('settings.memory.dismiss')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section>
          <h2>{t('settings.rules')}</h2>
          <div className="card">
            <small>{t('bond.knows.rulesHint')}</small>
            {of('rule').length === 0 ? (
              <p className="knows-empty">{t('bond.knows.rulesEmpty')}</p>
            ) : (
              <ul className="know-list">
                {of('rule').map((r) => (
                  <Item
                    key={r.id}
                    row={r}
                    max={200}
                    onEdit={(text) =>
                      void update(
                        { petRules: editRule(s.petRules, r.line ?? -1, text) },
                        t('settings.rules.saved'),
                      )
                    }
                    onDelete={() =>
                      void update(
                        { petRules: editRule(s.petRules, r.line ?? -1, '') },
                        t('bond.knows.ruleDeleted'),
                      )
                    }
                  />
                ))}
              </ul>
            )}
            <AddLine
              placeholder={t('bond.knows.rulePlaceholder')}
              label={t('bond.knows.ruleAdd')}
              max={200}
              onAdd={(text) => {
                const rules = s.petRules.trim()
                  ? `${s.petRules.replace(/\n+$/, '')}\n${text.trim()}`
                  : text.trim();
                void update({ petRules: rules }, t('settings.rules.saved'));
                return true;
              }}
            />
          </div>
        </section>

        <div className="forget-all">
          <button type="button" className="ghost danger" disabled={empty} onClick={() => setAsking(true)}>
            {t('bond.knows.forgetAll')}
          </button>
          <small>{t('bond.knows.localOnly')}</small>
        </div>
      </main>
      {asking && (
        <ForgetDialog
          name={name}
          hasRules={of('rule').length > 0}
          onCancel={() => setAsking(false)}
          onForget={(withRules) => {
            setAsking(false);
            void update(forgetAll(withRules), t('bond.knows.forgotAll'));
          }}
        />
      )}
    </div>
  );
}

/** 출처와 날짜 한 줄 */
function Meta({ row }: { row: KnowRow }) {
  if (!row.src && !row.at) return null;
  return (
    <span className="know-meta">
      {row.src && <span className={`src src-${row.src}`}>{t(SRC_KEY[row.src])}</span>}
      {row.at && <span className="when">{dateLabel(row.at)}</span>}
    </span>
  );
}

/** 한 줄: 글, 출처와 날짜, 고치기와 잊기 (잊기는 한 번 더 눌러야) */
function Item({
  row,
  max,
  onEdit,
  onDelete,
}: {
  row: KnowRow;
  max: number;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.text);
  const [sure, setSure] = useState(false);
  const save = () => {
    setEditing(false);
    onEdit(text);
  };
  const cancel = () => {
    setEditing(false);
    setText(row.text);
  };
  if (editing)
    return (
      <li className="know-item editing">
        <input
          // biome-ignore lint/a11y/noAutofocus: 고치기를 누른 칸으로 바로 간다
          autoFocus
          value={text}
          maxLength={max}
          aria-label={t('bond.knows.editAria', { text: row.text })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => enter(e, save, cancel)}
        />
        <span className="know-actions">
          <button type="button" className="ghost small" disabled={!text.trim()} onClick={save}>
            {t('bond.knows.save')}
          </button>
          <button type="button" className="link" onClick={cancel}>
            {t('common.cancel')}
          </button>
        </span>
      </li>
    );
  return (
    <li className="know-item">
      <div className="know-text">
        <span>{row.text}</span>
        <Meta row={row} />
      </div>
      <span className="know-actions">
        <button
          type="button"
          className="link"
          aria-label={t('bond.knows.editAria', { text: row.text })}
          onClick={() => {
            setText(row.text);
            setEditing(true);
          }}
        >
          {t('bond.knows.edit')}
        </button>
        <button
          type="button"
          className={`link${sure ? ' sure' : ''}`}
          aria-label={t('settings.memory.deleteAria', { text: row.text })}
          onClick={() => {
            if (!sure) return setSure(true);
            setSure(false);
            onDelete();
          }}
          onBlur={() => setSure(false)}
        >
          {sure ? t('settings.memory.deleteSure') : t('settings.memory.delete')}
        </button>
      </span>
    </li>
  );
}

/** 아래 더하기 줄. 넣었으면 onAdd 가 true */
function AddLine({
  placeholder,
  label,
  max,
  onAdd,
}: {
  placeholder: string;
  label: string;
  max: number;
  onAdd: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const add = () => {
    if (text.trim() && onAdd(text)) setText('');
  };
  return (
    <div className="friend-add">
      <input
        value={text}
        maxLength={max}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => enter(e, add)}
      />
      <button type="button" className="ghost" disabled={!text.trim()} onClick={add}>
        {label}
      </button>
    </div>
  );
}

/** 내가 알려 준 것: 생일(월, 일), 좋아하는 간식 하나, 좋아하는 것 다섯 개까지 */
function Facts({
  s,
  update,
  flash,
}: {
  s: S;
  update: (patch: KnowsPatch, message: string) => Promise<void>;
  flash: (text: string, error?: boolean) => void;
}) {
  const facts = s.petFacts;
  const birthday = facts.find((f) => f.kind === 'birthday');
  const food = facts.find((f) => f.kind === 'food');
  const likes = facts.filter((f) => f.kind === 'like');
  const rows = knowRows({ ...s, petMemory: [], petMemoryPending: [], petRules: '' });
  const rowOf = (kind: FactKind, value?: string) =>
    rows.find((r) => r.fact === kind && (value === undefined || r.text === value));
  const put = (kind: FactKind, value: string) => {
    const r = addFact(facts, kind, value, Date.now());
    if (r.result === 'bad') return flash(t('bond.knows.factBad'), true);
    if (r.result === 'dupe') return flash(t('settings.memory.dupe'), true);
    if (r.result === 'full') return flash(t('bond.knows.likesFull', { max: FACT_LIKES_MAX }), true);
    void update({ petFacts: r.list }, t('bond.knows.factSaved'));
  };
  const drop = (kind: FactKind, value?: string) =>
    void update(
      { petFacts: facts.filter((f) => !(f.kind === kind && (value === undefined || f.value === value))) },
      t('settings.memory.deleted'),
    );
  const bdRow = rowOf('birthday');
  const foodRow = rowOf('food');
  return (
    <div className="facts">
      <div className="fact">
        <span className="fact-label">{t('bond.knows.birthday')}</span>
        <BirthdayPicker
          value={birthday?.value}
          row={bdRow}
          onSave={(v) => put('birthday', v)}
          onDelete={() => drop('birthday')}
        />
      </div>
      <div className="fact">
        <span className="fact-label">{t('bond.knows.food')}</span>
        {food && foodRow ? (
          <ul className="know-list">
            <Item
              row={foodRow}
              max={FACT_TEXT_MAX}
              onEdit={(v) => (v.trim() ? put('food', v) : drop('food'))}
              onDelete={() => drop('food')}
            />
          </ul>
        ) : (
          <AddLine
            placeholder={t('bond.knows.foodPlaceholder')}
            label={t('bond.knows.tell')}
            max={FACT_TEXT_MAX}
            onAdd={(v) => {
              put('food', v);
              return true;
            }}
          />
        )}
      </div>
      <div className="fact">
        <span className="fact-label">
          {t('bond.knows.likes')}{' '}
          <span className="fact-count">
            {t('bond.knows.count', { n: likes.length, max: FACT_LIKES_MAX })}
          </span>
        </span>
        {likes.length > 0 && (
          <ul className="know-list">
            {likes.map((l) => {
              const row = rowOf('like', l.value);
              return row ? (
                <Item
                  key={row.id}
                  row={row}
                  max={FACT_TEXT_MAX}
                  onEdit={(v) => {
                    const rest = facts.filter((f) => !(f.kind === 'like' && f.value === l.value));
                    if (!v.trim()) return drop('like', l.value);
                    const r = addFact(rest, 'like', v, Date.now());
                    if (r.result !== 'added') return flash(t('settings.memory.dupe'), true);
                    void update({ petFacts: r.list }, t('bond.knows.factSaved'));
                  }}
                  onDelete={() => drop('like', l.value)}
                />
              ) : null;
            })}
          </ul>
        )}
        {likes.length < FACT_LIKES_MAX && (
          <AddLine
            placeholder={t('bond.knows.likePlaceholder')}
            label={t('bond.knows.tell')}
            max={FACT_TEXT_MAX}
            onAdd={(v) => {
              put('like', v);
              return true;
            }}
          />
        )}
      </div>
    </div>
  );
}

/** 생일: 월, 일 고르기. 정했으면 날짜와 고치기, 잊기 */
function BirthdayPicker({
  value,
  row,
  onSave,
  onDelete,
}: {
  value: string | undefined;
  row: KnowRow | undefined;
  onSave: (mmdd: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(!value);
  const parts = value ? birthdayParts(value) : { m: 0, d: 0 };
  const [m, setM] = useState(parts.m);
  const [d, setD] = useState(parts.d);
  useEffect(() => {
    if (!value) setEditing(true);
  }, [value]);
  const [sure, setSure] = useState(false);
  if (value && row && !editing) {
    const { m: mm, d: dd } = birthdayParts(value);
    return (
      <ul className="know-list">
        <li className="know-item">
          <div className="know-text">
            <span>{t('bond.knows.date', { m: mm, d: dd })}</span>
            <Meta row={row} />
          </div>
          <span className="know-actions">
            <button
              type="button"
              className="link"
              onClick={() => {
                setM(mm);
                setD(dd);
                setEditing(true);
              }}
            >
              {t('bond.knows.edit')}
            </button>
            <button
              type="button"
              className={`link${sure ? ' sure' : ''}`}
              aria-label={t('bond.knows.birthdayForget')}
              onClick={() => {
                if (!sure) return setSure(true);
                setSure(false);
                onDelete();
              }}
              onBlur={() => setSure(false)}
            >
              {sure ? t('settings.memory.deleteSure') : t('settings.memory.delete')}
            </button>
          </span>
        </li>
      </ul>
    );
  }
  const days = m ? new Date(2024, m, 0).getDate() : 31;
  return (
    <div className="birthday">
      <select aria-label={t('bond.knows.month')} value={m} onChange={(e) => setM(Number(e.target.value))}>
        <option value={0}>{t('bond.knows.month')}</option>
        {NUMS.slice(0, 12).map((n) => (
          <option key={n} value={n}>
            {t('bond.knows.monthN', { n })}
          </option>
        ))}
      </select>
      <select aria-label={t('bond.knows.day')} value={d} onChange={(e) => setD(Number(e.target.value))}>
        <option value={0}>{t('bond.knows.day')}</option>
        {NUMS.slice(0, days).map((n) => (
          <option key={n} value={n}>
            {t('bond.knows.dayN', { n })}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ghost"
        disabled={!m || !d || d > days}
        onClick={() => {
          onSave(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
          setEditing(false);
        }}
      >
        {t('bond.knows.tell')}
      </button>
      {value && (
        <button type="button" className="link" onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </button>
      )}
    </div>
  );
}

/** 모두 잊기 확인: 규칙도 지울지 고른다 (기본은 규칙은 남긴다) */
function ForgetDialog({
  name,
  hasRules,
  onCancel,
  onForget,
}: {
  name: string;
  hasRules: boolean;
  onCancel: () => void;
  onForget: (withRules: boolean) => void;
}) {
  const [rules, setRules] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="know-dim">
      <div className="know-dialog" role="alertdialog" aria-modal="true" aria-labelledby="forget-title">
        <strong id="forget-title">{t('bond.knows.forgetTitle', { name })}</strong>
        <small>{t('bond.knows.forgetBody')}</small>
        {hasRules && (
          <label className="check">
            <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} />
            <span>{t('bond.knows.forgetRules')}</span>
          </label>
        )}
        <div className="know-dialog-actions">
          <button type="button" className="ghost" ref={cancelRef} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary danger" onClick={() => onForget(rules)}>
            {t('bond.knows.forgetYes')}
          </button>
        </div>
      </div>
    </div>
  );
}
