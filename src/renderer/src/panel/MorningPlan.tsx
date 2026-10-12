import { useEffect, useRef, useState } from 'react';
import type { PlanView } from '../../../shared/day-ipc.ts';
import { currentBlock, type DayPlan, focusBlocks, PLAN_PICKS } from '../../../shared/day-plan.ts';
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { timeOf } from './format.ts';
import { CheckIcon } from './icons.tsx';
import { refreshedPicks } from './plan-refresh.ts';
import './day.css';

const panel = window.jjakkungPanel;
const day = window.jjakkungDay;
/** 오늘 탭 카드 → 계획 화면 띄우기, 계획 화면 → 카드 다시 읽기 */
const OPEN_EVENT = 'jj:open-plan';
const SAVED_EVENT = 'jj:plan-saved';
const FOCUS_MAX = 50;

export const openPlanSheet = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** 저절로 띄우는 시각 고르기: 5시부터 12시까지 30분마다 */
const AUTO_TIMES = Array.from({ length: 15 }, (_, i) => 5 * 60 + i * 30);

/**
 * 오늘 탭 "오늘 꼭 할 일" 카드: 정한 계획이 있으면 꼭 할 일(체크)과 집중 칸(지금이면 "지금 집중"),
 * 없으면 "같이 정하기" 한 줄
 */
export function PlanCard({ s, onComplete }: { s: PanelState; onComplete: (todo: Todo) => void }) {
  const [plan, setPlan] = useState<DayPlan | null>();
  const [now, setNow] = useState(Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: 패널 상태(s)가 바뀔 때마다 다시 읽는다
  useEffect(() => {
    let alive = true;
    const load = () =>
      day
        .plan()
        .then((v) => alive && v && setPlan(v.plan ?? null))
        .catch(() => undefined);
    void load();
    window.addEventListener(SAVED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(SAVED_EVENT, load);
    };
  }, [s]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (plan === undefined) return null;
  if (plan === null || plan.day !== s.today)
    return (
      <section className="plan-card is-empty">
        <span>{t('plan.card.empty')}</span>
        <button type="button" className="ghost small" onClick={openPlanSheet}>
          {t('plan.card.start')}
        </button>
      </section>
    );

  const byId = new Map([...s.open, ...s.doneToday].map((todo) => [todo.id, todo]));
  const picks = plan.picks.map((id) => byId.get(id)).filter((x): x is Todo => !!x);
  const allDone = picks.length > 0 && picks.every((x) => x.doneAt !== null);
  const blocks = plan.blocks.filter((b) => b.end > now);
  const live = currentBlock(blocks, now);
  const running = s.focus.phase !== 'idle';
  return (
    <section className="plan-card">
      <h2>
        {t('plan.card.title')}
        <button type="button" className="link" onClick={openPlanSheet}>
          {t('plan.card.edit')}
        </button>
      </h2>
      {allDone && <p className="plan-yay">{t('plan.card.allDone')}</p>}
      {picks.length > 0 && (
        <ul className="plan-picks">
          {picks.map((todo) => {
            const done = todo.doneAt !== null;
            return (
              <li key={todo.id} className={done ? 'is-done' : ''}>
                <button
                  type="button"
                  className={done ? 'check on' : 'check'}
                  aria-label={
                    done ? t('panel.todo.undoDone') : t('panel.todo.complete', { title: todo.title })
                  }
                  onClick={() => (done ? panel.undo(todo.id) : onComplete(todo))}
                >
                  <CheckIcon />
                </button>
                <span className="plan-title" dir="auto" title={todo.title}>
                  {todo.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {blocks.length > 0 && (
        <ul className="plan-blocks" aria-label={t('plan.card.blocks')}>
          {blocks.map((b) => {
            const todo = b.todoId === undefined ? undefined : byId.get(b.todoId);
            const isLive = b === live;
            return (
              <li key={b.start} className={isLive ? 'live' : ''}>
                <span className="plan-time">
                  {timeOf(b.start)} ~ {timeOf(b.end)}
                </span>
                <span className="plan-title" dir="auto">
                  {todo?.title ?? t('plan.card.blocks')}
                </span>
                {isLive && !running && (
                  <button
                    type="button"
                    className="primary small"
                    onClick={() =>
                      panel.focusStart(
                        snapFocus(Math.round((b.end - now) / 60_000)),
                        todo && todo.doneAt === null ? todo.id : undefined,
                      )
                    }
                  >
                    {t('plan.card.focusNow')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 남은 분에 맞는 집중 길이 (15, 25, 50) */
function snapFocus(left: number): number {
  if (left >= FOCUS_MAX) return FOCUS_MAX;
  return left >= 25 ? 25 : 15;
}

/**
 * 아침 계획 화면 (패널 위에 덮는 시트). 아침 첫 열기, 펫 한마디 "같이 정하기", 오늘 탭 카드에서 띄운다.
 * 꼭 할 일 셋까지 고르기 (먼저 골라 둔 것), 일정 사이 집중 칸 미리 보기, AI 다듬기(있으면), 저절로 띄우기 설정
 */
export function PlanSheetHost({
  goToday,
  onSaved,
  todosKey,
}: {
  goToday: () => void;
  onSaved: (text: string) => void;
  /** 안 끝낸 할 일 열쇠 (plan-refresh.ts). 떠 있는 동안 바뀌면 고를 거리를 다시 받는다 */
  todosKey: string;
}) {
  const [view, setView] = useState<PlanView>();
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);
  const [msg, setMsg] = useState('');
  const [aiNote, setAiNote] = useState('');
  const [busy, setBusy] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  const show = (v: PlanView) => {
    setView(v);
    setPicks(v.plan?.picks.length ? v.plan.picks : v.suggested);
    setAiNote(v.plan?.note ?? '');
    setMsg('');
    setOpen(true);
    goToday();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => {
    // 처음 열 때 한 번: 아침 첫 열기이거나 펫 한마디로 열었으면 띄운다
    day
      .plan(true)
      .then((v) => {
        if (v?.autoOpen) {
          show(v);
          day.planShown();
        }
      })
      .catch(() => undefined);
    const reopen = () =>
      void day
        .plan()
        .then((v) => v && show(v))
        .catch(() => undefined);
    window.addEventListener(OPEN_EVENT, reopen);
    day.onOpenPlan(reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  // 떠 있는 동안 할 일이 바뀌면 고를 거리를 다시 받는다 (고른 것은 남은 것만 그대로)
  const latest = useRef({ view, picks });
  latest.current = { view, picks };
  const shownKey = useRef(todosKey);
  useEffect(() => {
    if (!open) {
      shownKey.current = todosKey;
      return;
    }
    if (shownKey.current === todosKey) return;
    shownKey.current = todosKey;
    void day
      .plan()
      .then((next) => {
        const now = latest.current;
        if (!next || !now.view) return;
        setPicks(refreshedPicks(now.picks, now.view, next));
        setView({ ...next, prefs: now.view.prefs });
      })
      .catch(() => undefined);
  }, [todosKey, open]);

  // 띄우면 첫 고르기 칸에 커서. Esc 는 패널을 닫지 않고 시트만 닫는다
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>('input, button.primary')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open || !view) return null;
  const full = picks.length >= PLAN_PICKS;
  const blocks = focusBlocks(view.gaps, picks);
  const titleOf = (id: number | undefined) => view.candidates.find((c) => c.id === id)?.title;

  const toggle = (id: number) => {
    setMsg('');
    if (picks.includes(id)) setPicks(picks.filter((x) => x !== id));
    else if (full) setMsg(t('plan.sheet.full'));
    else setPicks([...picks, id]);
  };
  const save = async () => {
    const plan = await day.planSave(picks, aiNote || undefined).catch(() => undefined);
    setOpen(false);
    window.dispatchEvent(new Event(SAVED_EVENT));
    if (plan) onSaved(t('plan.saved', { n: plan.picks.length }));
  };
  const polish = async () => {
    setBusy(true);
    setMsg('');
    const r = await day.planPolish(picks).catch(() => undefined);
    setBusy(false);
    if (r?.ok) {
      setPicks(r.picks);
      setAiNote(r.why ?? '');
    } else
      setMsg(r?.ok === false && r.error === 'locked' ? t('plan.sheet.aiLocked') : t('plan.sheet.aiFail'));
  };
  const setPrefs = async (prefs: PlanView['prefs']) => {
    const next = await day.planPrefs(prefs).catch(() => undefined);
    if (next) setView({ ...view, prefs: next });
  };

  return (
    <div className="plan-veil">
      <div
        className="plan-sheet"
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-sheet-title"
      >
        <div className="plan-head">
          <strong id="plan-sheet-title">{t('plan.sheet.title')}</strong>
          <span className="plan-count">{t('plan.sheet.picked', { n: picks.length })}</span>
          <button
            type="button"
            className="plan-close"
            aria-label={t('plan.sheet.close')}
            title={t('plan.sheet.close')}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="plan-body">
          {view.candidates.length === 0 ? (
            <p className="empty-line">{t('plan.sheet.noTodos')}</p>
          ) : (
            <>
              <p className="plan-lead">{t('plan.sheet.lead')}</p>
              <ul className="plan-cands">
                {view.candidates.map((c) => {
                  const on = picks.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className={on ? 'on' : full ? 'dim' : ''}>
                        <input type="checkbox" checked={on} onChange={() => toggle(c.id)} />
                        <span className="plan-title" dir="auto">
                          {c.title}
                        </span>
                        {c.reason && (
                          <small className={`plan-tag ${c.reason}`}>{t(`plan.reason.${c.reason}`)}</small>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {aiNote && <p className="plan-ai-note">{t('plan.sheet.aiNote', { why: aiNote })}</p>}
          {msg && (
            <p className="plan-msg" role="status">
              {msg}
            </p>
          )}
          <h3>
            {t('plan.sheet.blocks')}
            {view.events.length > 0 && <small>{t('plan.sheet.events', { n: view.events.length })}</small>}
          </h3>
          {blocks.length === 0 ? (
            <p className="empty-line">{t('plan.sheet.noGaps')}</p>
          ) : (
            <>
              <ul className="plan-blocks">
                {blocks.map((b) => (
                  <li key={b.start}>
                    <span className="plan-time">
                      {timeOf(b.start)} ~ {timeOf(b.end)}
                    </span>
                    <span className="plan-title" dir="auto">
                      {titleOf(b.todoId) ?? t('plan.card.blocks')}
                    </span>
                  </li>
                ))}
              </ul>
              <small className="plan-hint">{t('plan.sheet.blocksHint')}</small>
            </>
          )}
          <div className="plan-auto">
            <label>
              <input
                type="checkbox"
                checked={view.prefs.auto}
                onChange={(e) => setPrefs({ ...view.prefs, auto: e.currentTarget.checked })}
              />
              {t('plan.sheet.auto')}
            </label>
            <select
              aria-label={t('plan.sheet.autoFrom')}
              title={t('plan.sheet.autoFrom')}
              value={view.prefs.fromMinute}
              disabled={!view.prefs.auto}
              onChange={(e) => setPrefs({ ...view.prefs, fromMinute: Number(e.currentTarget.value) })}
            >
              {(AUTO_TIMES.includes(view.prefs.fromMinute)
                ? AUTO_TIMES
                : [...AUTO_TIMES, view.prefs.fromMinute].sort((a, b) => a - b)
              ).map((m) => (
                <option key={m} value={m}>
                  {timeLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="plan-foot">
          {view.ai && view.candidates.length > 0 && (
            <button
              type="button"
              className="ghost small plan-ai"
              disabled={busy}
              onClick={polish}
              title={view.ai}
            >
              {busy ? t('plan.sheet.aiBusy') : t('plan.sheet.ai')}
            </button>
          )}
          <span className="plan-gap" />
          <button type="button" className="ghost" onClick={() => setOpen(false)}>
            {t('plan.sheet.later')}
          </button>
          <button type="button" className="primary" onClick={save}>
            {t('plan.sheet.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
