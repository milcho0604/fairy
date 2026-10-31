import { useEffect, useRef, useState } from 'react';
import { FOCUS_STEPS, monthCells, monthOf, monthTotals, shiftMonth } from '../../../shared/focus-month.ts';
import { locale, t } from '../../../shared/i18n/index.ts';
import type { FocusMonthView, PanelState } from '../../../shared/ipc.ts';
import { moveCell, stopCell } from './roving.ts';
import './records.css';

const bridge = window.jjakkungPanel;
/** 칸 아래 분 숫자를 보이는지 (창을 열 때마다 새로 만들어 브라우저 저장소에 둔다. 작은 패널과 큰 창이 같이 쓴다) */
const DETAIL_KEY = 'jj.records.focusDetail';

function savedDetail(): boolean {
  try {
    return localStorage.getItem(DETAIL_KEY) === '1';
  } catch {
    return false;
  }
}

/** 분을 "1시간 15분" / "1h 15m" 로 */
export function fmtMinutes(min: number): string {
  return min >= 60
    ? t('bond.week.hm', { h: Math.floor(min / 60), m: min % 60 })
    : t('bond.week.m', { m: min });
}

const dateLabel = (day: string): string => {
  const [y = 2000, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale(), {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
};

const monthLabel = (ym: string): string => {
  const [y = 2000, m = 1] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), { year: 'numeric', month: 'long' });
};

/**
 * 집중 월간 잔디 (#125, shared/focus-month.ts). 이번 주 칸 옆에서 달을 넘겨 가며 날마다 집중한 양을 색 다섯 단계로 본다.
 * 칸마다 툴팁(title)과 읽기 글(aria-label)에 그날 분이 있어 색만으로 구분하지 않는다. 칸 아래 분 숫자는 기본으로 숨기고
 * 머리의 "자세히 보기" 단추로 펼친다(기억한다).
 * 날짜를 누르면 그날 총 시간과 가장 길게 이어 간 집중이 아래에 나온다
 */
export function FocusMonth({ s, open }: { s: PanelState; open?: boolean }) {
  const thisMonth = monthOf(s.today);
  const [month, setMonth] = useState(thisMonth);
  // 패널을 연 채 달이 바뀌면(자정) 이번 달을 보고 있던 사람은 새 달로 따라간다
  const [seenMonth, setSeenMonth] = useState(thisMonth);
  if (seenMonth !== thisMonth) {
    setSeenMonth(thisMonth);
    if (month === seenMonth) setMonth(thisMonth);
  }
  const [view, setView] = useState<FocusMonthView>();
  const [pick, setPick] = useState<string>();
  const [detail, setDetailState] = useState(savedDetail);
  const setDetail = (next: boolean) => {
    setDetailState(next);
    try {
      localStorage.setItem(DETAIL_KEY, next ? '1' : '0');
    } catch {
      // 못 적어도 이번에는 바뀐다
    }
  };
  // 집중이 끝나거나 멈추면(단계가 바뀜) 오늘 칸이 바뀐다
  const refresh = `${s.focus.phase}:${s.week?.focusMin ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh 는 다시 읽을 때를 알리는 값이다
  useEffect(() => {
    let alive = true;
    void bridge.focusMonth(month).then((v) => {
      if (alive && v) setView(v);
    });
    return () => {
      alive = false;
    };
  }, [month, refresh]);

  const days = view?.month === month ? view.days : [];
  const weeks = monthCells(month, days, s.today);
  const totals = monthTotals(days);
  const labels = t('assist.week.days').split(',');
  const first = view?.firstMonth ?? thisMonth;
  const canPrev = month > first;
  const canNext = month < thisMonth;
  const go = (delta: number) => {
    setMonth(shiftMonth(month, delta));
    setPick(undefined);
  };
  // 달력 칸은 탭 정지가 하나(고른 날, 아니면 오늘, 아니면 가장 최근 날)이고 나머지는 화살표로 간다
  const cells = weeks.flat();
  const ok = cells.map((c) => !!c.day && !c.future);
  const stop = stopCell(ok, [
    cells.findIndex((c) => c.day === pick),
    cells.findIndex((c) => c.day === s.today),
  ]);
  const gridRef = useRef<HTMLFieldSetElement>(null);
  const arrow = (i: number, key: string) => {
    const next = moveCell(ok, i, key);
    const day = cells[next]?.day;
    if (next === i || !day) return false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
    return true;
  };
  const picked = pick ? weeks.flat().find((c) => c.day === pick) : undefined;

  return (
    <details className="achieve focus-month" open={open}>
      <summary>
        {t('records.month.title')}
        <small>{t('records.month.summary', { min: fmtMinutes(totals.min), days: totals.days })}</small>
      </summary>
      <div className="fm-head">
        <small>{t('records.month.hint')}</small>
        <button
          type="button"
          className="ghost small fm-detail-toggle"
          aria-expanded={detail}
          onClick={() => setDetail(!detail)}
        >
          {detail ? t('records.month.detailHide') : t('records.month.detailShow')}
        </button>
      </div>
      <div className="fm-nav">
        <button
          type="button"
          className="ghost fm-step"
          disabled={!canPrev}
          aria-label={t('records.month.prev')}
          title={t('records.month.prev')}
          onClick={() => go(-1)}
        >
          ‹
        </button>
        <strong className="fm-month" aria-live="polite">
          {monthLabel(month)}
        </strong>
        <button
          type="button"
          className="ghost fm-step"
          disabled={!canNext}
          aria-label={t('records.month.next')}
          title={t('records.month.next')}
          onClick={() => go(1)}
        >
          ›
        </button>
      </div>
      <fieldset
        className={`fm-grid${detail ? ' with-min' : ''}`}
        ref={gridRef}
        aria-label={t('records.month.grid', { month: monthLabel(month) })}
      >
        {labels.map((l) => (
          <span key={l} className="fm-dow" aria-hidden="true">
            {l}
          </span>
        ))}
        {cells.map((c, i) => {
          const day = c.day;
          if (!day) return <span key={c.key} className="fm-blank" aria-hidden="true" />;
          const date = dateLabel(day);
          const label = c.future
            ? t('records.month.cellFuture', { date })
            : c.min > 0
              ? t('records.month.cell', { date, min: fmtMinutes(c.min) })
              : t('records.month.cellNone', { date });
          return (
            <button
              key={day}
              type="button"
              className={`fm-cell lv${c.level}${c.future ? ' future' : ''}${day === s.today ? ' today' : ''}${pick === day ? ' picked' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={pick === day}
              disabled={c.future}
              tabIndex={i === stop ? 0 : -1}
              data-day={day}
              onKeyDown={(e) => {
                if (arrow(i, e.key)) e.preventDefault();
              }}
              onClick={() => setPick(pick === day ? undefined : day)}
            >
              <span className="fm-d">{Number(day.slice(8, 10))}</span>
              {detail && c.min > 0 && <b className="fm-m">{c.min}</b>}
            </button>
          );
        })}
      </fieldset>
      <p className="fm-detail" role="status" aria-live="polite">
        {picked?.day
          ? picked.min === 0
            ? t('records.month.detailNone', { date: dateLabel(picked.day) })
            : picked.longest > 0
              ? t('records.month.detail', {
                  date: dateLabel(picked.day),
                  total: fmtMinutes(picked.min),
                  longest: fmtMinutes(picked.longest),
                })
              : t('records.month.detailNoLongest', {
                  date: dateLabel(picked.day),
                  total: fmtMinutes(picked.min),
                })
          : totals.days === 0
            ? t('records.month.empty')
            : t('records.month.pick')}
      </p>
      <div className="fm-legend" aria-hidden="true">
        <small>{detail ? t('records.month.legendMin') : t('records.month.legend')}</small>
        <span className="fm-swatches">
          <span>
            <i className="lv0" />
            <small>0</small>
          </span>
          {FOCUS_STEPS.map((min, i) => (
            <span key={min} title={t('records.month.legendStep', { min })}>
              <i className={`lv${i + 1}`} />
              <small>{min}+</small>
            </span>
          ))}
        </span>
      </div>
      <small className="fm-note">{t('records.month.note')}</small>
    </details>
  );
}
