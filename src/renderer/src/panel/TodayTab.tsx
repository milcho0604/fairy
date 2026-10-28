import { type ReactNode, useEffect, useRef, useState } from 'react';
import { leftForTomorrow, nextUp } from '../../../shared/briefing.ts';
import { allDaySpan } from '../../../shared/event-store.ts';
import { breakFor, FOCUS_LENGTHS, focusReward, isFocusMinutes, remainLabel } from '../../../shared/focus.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import { stepProgress, type Todo } from '../../../shared/todo-store.ts';
import type { WeekSummary } from '../../../shared/week.ts';
import './bond.css';
import { FocusMonth } from './FocusMonth.tsx';
import { dayHeading, timeOf } from './format.ts';
import { HabitBox } from './HabitBox.tsx';
import { JourneyCard } from './JourneyCard.tsx';
import { MailCard } from './MailCard.tsx';
import { PlanCard } from './MorningPlan.tsx';
import { RemindCard } from './RemindCard.tsx';
import { useSurface } from './surface.tsx';
import { TodoRow } from './TodoTab.tsx';
import { useKeepScroll } from './view-keep.ts';
import { WeekCardButton } from './WeekCard.tsx';

const bridge = window.jjakkungPanel;

/**
 * 오늘 (v1): 다음 할 일(nextUp), 집중 타이머, 오늘 남은 일정, 오늘 마감과 지난 마감 할 일.
 * 기획서 "화면 설계": 패널은 오늘 화면에서 시작한다.
 */
export function TodayTab({
  s,
  onComplete,
  goTo,
  onMoved,
  onFocusStopped,
}: {
  s: PanelState;
  onComplete: (todo: Todo) => void;
  goTo: (tab: 'todo' | 'event') => void;
  /** 지난 마감을 오늘로, 못 한 것을 내일로(to) 옮겼다 (되돌리기 알림) */
  onMoved?: (moved: { id: number; due: string | null }[], to: 'tomorrow' | undefined, key: number) => void;
  /** 집중을 그만뒀다. 기록한 분 (되돌리기 알림) */
  onFocusStopped?: (minutes: number) => void;
}) {
  // 넓은 칸(큰 창)에서는 "나와 펫" 열이 이번 주와 일기를 펼쳐 보인다
  const wide = useSurface().zone === 'wide';
  const [now, setNow] = useState(Date.now());
  // 고른 집중 길이. 시작하면 다음에도 이 길이 (설정 focusMin)
  const [len, setLen] = useState(s.focusMin);
  // 펫 메뉴에서 다른 길이로 시작했으면 따라간다
  useEffect(() => setLen(s.focusMin), [s.focusMin]);
  // 집중 카드는 한 줄로 접어 두고, 길이 바꾸기를 누르면 길이 칩과 "직접" 칸을 펼친다 (#146)
  const preset = (FOCUS_LENGTHS as readonly number[]).includes(len);
  const [lenOpen, setLenOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(!preset);
  const [customText, setCustomText] = useState(String(s.focusMin));
  const customOk = isFocusMinutes(Number(customText));
  const badLen = customOpen && !customOk;
  // 설정이나 펫 메뉴가 직접 입력한 길이로 바꿨으면 따라간다
  useEffect(() => {
    if ((FOCUS_LENGTHS as readonly number[]).includes(len)) return;
    setCustomOpen(true);
    setCustomText(String(len));
  }, [len]);
  const running = s.focus.phase !== 'idle';
  useEffect(() => {
    // 집중 중엔 초를 세고, 아니면 30초마다 (30분 안 일정이 "다음 할 일"로 바뀌게)
    const timer = setInterval(() => setNow(Date.now()), running ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [running]);
  const next = nextUp({ todos: s.open, events: s.events, now });
  // 다음 할 일에 단계(9판)가 있으면 안 한 첫 단계와 진행
  const nextTodo = next?.kind === 'todo' ? s.open.find((todo) => todo.id === next.id) : undefined;
  const nextStep = nextTodo?.steps.find((st) => !st.done);
  const nextProgress = nextTodo ? stepProgress(nextTodo.steps) : undefined;
  // 할 일을 걸고 집중하는 중이면 그 제목
  const focusTodo =
    s.focus.todoId === undefined ? undefined : s.open.find((todo) => todo.id === s.focus.todoId);

  const endOfDay = new Date(now).setHours(24, 0, 0, 0);
  // 종일 일정은 오늘이 그 기간 안이면 (0시에 시작해 이미 지났어도) 오늘 일정이다
  const events = s.events.filter((e) => {
    // 끝 시각이 없는 일정은 시작 뒤 30분까지 "지금"이다 (일정 탭과 같은 기준. 전에는 시작하자마자 오늘 탭에서만 사라졌다)
    if (!e.allDay) return (e.endAt ?? e.startAt + 30 * 60_000) >= now && e.startAt < endOfDay;
    const { first, last } = allDaySpan(e);
    return first <= s.today && last >= s.today;
  });
  // 반복 할 일(습관)은 아래 습관 칸에서 체크한다 (두 번 보이지 않게)
  const due = leftForTomorrow(s.open, s.today);
  const overdue = due.filter((todo) => (todo.due as string) < s.today).length;
  const important = s.open
    .filter((todo) => todo.important && (todo.due === null || todo.due > s.today))
    .slice(0, 3);

  // 아래에 더 있음 (업적과 일기가 첫 화면 아래에 있어 모르고 지나쳤다). 다 내려가면 사라진다
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useKeepScroll(scroller, 'today');
  const checkMore = () => {
    const el = scroller.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > MORE_SLACK);
  };
  // 그릴 때마다 (일정, 할 일이 늘고 줄면 높이가 바뀐다). 글자 하나 바꾸지 않으면 같은 값이라 다시 그리지 않는다
  useEffect(checkMore);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만 건다
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener('scroll', checkMore, { passive: true });
    // 업적, 일기를 펼치고 접을 때와 창 크기가 바뀔 때
    el.addEventListener('toggle', checkMore, true);
    const ro = new ResizeObserver(checkMore);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkMore);
      el.removeEventListener('toggle', checkMore, true);
      ro.disconnect();
    };
  }, []);

  // 좁은 칸과 보통 칸에서 집중이 돌고 있으면 시계와 그만 단추가 첫 화면 밖으로 밀리지 않게 맨 위에 둔다 (넓은 칸은 오른쪽 열 맨 위)
  const focusFirst = running && !wide;
  // 집중이 쉬는 중이어도 좁은 칸과 보통 칸에서는 오른쪽 열이 맨 아래로 쌓여 집중 카드가 놓친 알림 밑으로 밀렸다.
  // 다음 할 일 바로 아래에 둔다 (넓은 칸은 오른쪽 열 맨 위)
  const focusAfterNext = !running && !wide;
  const focusCard = (
    <section className={`focus-card ${s.focus.phase} ${s.focus.phase === 'idle' ? 'fold' : ''}`}>
      {s.focus.phase === 'idle' ? (
        <>
          <div className="focus-text">
            <div className="focus-line">
              <strong>{t('panel.today.focusTitle', { n: len })}</strong>
              <button
                type="button"
                className="link"
                aria-expanded={lenOpen}
                onClick={() => setLenOpen((v) => !v)}
              >
                {t('rows.focus.change')}
              </button>
            </div>
            {lenOpen && (
              <>
                <small>
                  {t('panel.today.focusHint', {
                    name: s.petName,
                    coins: focusReward(len),
                    breakMin: breakFor(len),
                  })}
                </small>
                <fieldset className="focus-len" aria-label={t('panel.today.focusLength')}>
                  {FOCUS_LENGTHS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={n === len}
                      className={n === len ? 'len-chip on' : 'len-chip'}
                      onClick={() => {
                        setLen(n);
                        setCustomOpen(false);
                      }}
                    >
                      {t('panel.today.focusMin', { n })}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={!preset}
                    aria-expanded={customOpen}
                    className={!preset ? 'len-chip on' : 'len-chip'}
                    onClick={() => {
                      setCustomOpen((v) => !v);
                      setCustomText(String(len));
                    }}
                  >
                    {preset ? t('rows.focus.custom') : t('rows.focus.customOn', { n: len })}
                  </button>
                </fieldset>
                {customOpen && (
                  <div className="focus-custom">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={120}
                      value={customText}
                      aria-label={t('rows.focus.customLabel')}
                      aria-invalid={badLen}
                      onChange={(e) => {
                        setCustomText(e.target.value);
                        const n = Number(e.target.value);
                        if (isFocusMinutes(n)) setLen(n);
                      }}
                    />
                    <span>{t('panel.today.focusMin', { n: '' }).trim()}</span>
                    {badLen && (
                      <p className="focus-bad" role="alert">
                        {t('rows.focus.invalid')}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <button type="button" className="primary" disabled={badLen} onClick={() => bridge.focusStart(len)}>
            {t('panel.today.start')}
          </button>
        </>
      ) : (
        <>
          <div className="focus-text">
            <strong className="clock">{remainLabel(s.focus, now)}</strong>
            <small>
              {s.focus.phase !== 'focus'
                ? t('panel.today.resting')
                : focusTodo
                  ? t('panel.today.focusingOn', { title: focusTodo.title })
                  : t('panel.today.focusing')}
            </small>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const r = await bridge.focusStop();
              if (r) onFocusStopped?.(r.minutes);
            }}
          >
            {t('panel.today.stop')}
          </button>
        </>
      )}
    </section>
  );

  return (
    <>
      <div className="scroll today" ref={scroller}>
        <RemindCard s={s} />
        <div className="today-cols">
          <div className="today-col today-plan">
            <h2 className="today-col-title">{t('panel.today.colPlan')}</h2>
            {focusFirst && focusCard}
            <section>
              <h2>
                {t('panel.today.events')}
                <button type="button" className="link" onClick={() => goTo('event')}>
                  {t('panel.today.addEvent')}
                </button>
              </h2>
              {events.length === 0 ? (
                <p className="empty-line">{t('panel.today.noEvents')}</p>
              ) : (
                <ul className="events">
                  {events.map((e) => {
                    if (e.allDay) {
                      // "종일 제주도 여행 ~10/12": 여러 날이면 언제까지인지 붙인다
                      const { last } = allDaySpan(e);
                      return (
                        <li key={e.id} className="all-day">
                          <span className="time">{t('panel.event.allDay')}</span>
                          <span className="title" dir="auto">
                            {e.title}
                            {last > s.today && (
                              <small>
                                {' '}
                                {t('panel.event.until', {
                                  m: Number(last.slice(5, 7)),
                                  d: Number(last.slice(8, 10)),
                                })}
                              </small>
                            )}
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={e.id} className={e.startAt <= now ? 'now' : ''}>
                        <span className="time">
                          {e.startAt <= now ? t('panel.today.now') : timeOf(e.startAt)}
                        </span>
                        <span className="title" dir="auto">
                          {e.title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {next && (
              <section className="next-up">
                <h2>{t('panel.today.next')}</h2>
                <div className="next-row">
                  <span className="next-text">
                    <strong className="next-title" dir="auto">
                      {next.title}
                    </strong>
                    {next.kind === 'event' && (
                      <small>{t('panel.today.nextPrepare', { time: timeOf(next.startAt) })}</small>
                    )}
                    {nextStep && nextProgress && (
                      <small>
                        {t('assist.next.step', { title: nextStep.title })} ({nextProgress.done}/
                        {nextProgress.total})
                      </small>
                    )}
                  </span>
                  {next.kind === 'todo' && !running && (
                    <button
                      type="button"
                      className="primary next-go"
                      onClick={() => bridge.focusStart(len, next.id)}
                    >
                      {t('panel.today.nextFocus', { n: len })}
                    </button>
                  )}
                </div>
              </section>
            )}

            {focusAfterNext && focusCard}

            <section>
              <h2>
                {t('panel.todo.due')}
                <span className="h3-links">
                  {overdue > 0 && (
                    <button
                      type="button"
                      className="link"
                      onClick={async () => {
                        const key = moveKey();
                        const moved = await bridge.moveOverdue(undefined, { key });
                        if (moved.length > 0) onMoved?.(moved, undefined, key);
                      }}
                    >
                      {t('assist.overdue.move', { n: overdue })}
                    </button>
                  )}
                  <button type="button" className="link" onClick={() => goTo('todo')}>
                    {t('panel.today.allTodos')}
                  </button>
                </span>
              </h2>
              {due.length === 0 ? (
                <p className="empty-line">{t('panel.today.noDue')}</p>
              ) : (
                <ul className="todos">
                  {due.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      today={s.today}
                      doing={s.doing.includes(todo.id)}
                      onComplete={() => onComplete(todo)}
                      compact
                    />
                  ))}
                </ul>
              )}
              {due.length > 0 && (
                <button
                  type="button"
                  className="ghost small defer-tomorrow"
                  onClick={async () => {
                    // 화면이 본 오늘과 목록을 넘긴다: 자정이 지나 새로 오늘이 된 것까지 옮기지 않게
                    const key = moveKey();
                    const moved = await bridge.moveOverdue('tomorrow', {
                      key,
                      today: s.today,
                      ids: due.map((todo) => todo.id),
                    });
                    if (moved.length > 0) onMoved?.(moved, 'tomorrow', key);
                  }}
                >
                  {t('assist.defer.move', { n: due.length })}
                </button>
              )}
            </section>

            <PlanCard s={s} onComplete={onComplete} />

            {important.length > 0 && (
              <section>
                <h2>{t('panel.todo.important')}</h2>
                <ul className="todos">
                  {important.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      today={s.today}
                      doing={s.doing.includes(todo.id)}
                      onComplete={() => onComplete(todo)}
                      compact
                    />
                  ))}
                </ul>
              </section>
            )}

            {s.missed.length > 0 && (
              <section className="missed">
                <h2>
                  {t('panel.today.missed')}
                  <button type="button" className="link" onClick={() => bridge.missedClear()}>
                    {t('panel.today.missedClear')}
                  </button>
                </h2>
                <ul className="events">
                  {s.missed.map((m) => (
                    <li key={`${m.at}-${m.text}`}>
                      <span className="time">{timeOf(m.at)}</span>
                      <span className="title" dir="auto">
                        {m.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="today-col today-pet">
            <h2 className="today-col-title">{t('panel.today.colPet')}</h2>
            {wide && focusCard}

            <HabitBox s={s} onComplete={onComplete} />

            <p className="done-count" title={t('panel.today.doneHint')}>
              <span>
                {t('panel.today.doneLabel')} <b>{s.doneToday.length}</b>
              </span>
              <span className="streak" title={t('panel.today.streakHint')}>
                {t('panel.today.streakBefore')} <b>{s.achieve.streak}</b>
                {t(s.achieve.streak === 1 ? 'panel.today.streakAfterOne' : 'panel.today.streakAfter')}
              </span>
            </p>
            <small>{t('panel.today.doneHint')}</small>

            {s.week && (
              <WeekBox week={s.week} today={s.today} open={wide}>
                <WeekCardButton s={s} />
              </WeekBox>
            )}
            <FocusMonth s={s} />

            <details className="achieve">
              <summary>
                {t('panel.today.achieve', { got: s.achieve.got.length, total: s.achieve.total })}
                {s.achieve.next && (
                  <small>{t('panel.today.achieveNext', { hint: s.achieve.next.hint })}</small>
                )}
              </summary>
              <ul>
                {s.achieve.got.length === 0 && <li className="empty-line">{t('panel.today.noAchieve')}</li>}
                {s.achieve.got.map((a) => (
                  <li key={a.key}>
                    <b>{a.name}</b>
                    <small>{a.hint}</small>
                  </li>
                ))}
              </ul>
            </details>

            {/* 첫 7일 여정 (shared/journey.ts). 여정 밖이면 그리지 않는다 */}
            <JourneyCard s={s} />

            {/* 새 쪽지 카드: 안 읽은 쪽지가 있으면 알리고 쪽지함(머리줄 봉투, 큰 창 구역)을 연다 */}
            <MailCard />

            <DiaryBox s={s} open={wide} />
          </div>
        </div>
      </div>
      {/* 스크롤 칸 밖, 아래에 따로 둔다. 안에 겹쳐 띄우면 둘째 마감 줄을 가렸다 */}
      {more && (
        <button
          type="button"
          className="more-below"
          onClick={() => {
            const el = scroller.current;
            const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            el?.scrollBy({ top: el.clientHeight * 0.7, behavior: calm ? 'auto' : 'smooth' });
          }}
        >
          <span>
            {t('panel.today.more')}
            <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
              <path
                d="M1 1l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
      )}
    </>
  );
}

/** 옮긴 묶음의 이름 (알림마다 달라서 되돌리기가 그 묶음만 되돌린다) */
let moveSeq = 0;
const moveKey = () => Date.now() * 1000 + (moveSeq++ % 1000);

/** 이만큼(px) 안 남았으면 다 내려온 것으로 본다 */
const MORE_SLACK = 12;

/** 이번 주 (shared/week.ts): 요일 막대(끝낸 일), 끝낸 수와 집중 시간, 지난주 이맘때와 견줌, 다음 7일 마감 */
export function WeekBox({
  week,
  today,
  open,
  children,
}: {
  week: WeekSummary;
  today: string;
  open?: boolean;
  children?: ReactNode;
}) {
  const labels = t('assist.week.days').split(',');
  const max = Math.max(1, ...week.days.map((d) => d.done));
  return (
    <details className="achieve week" open={open}>
      <summary>
        {t('assist.week.title')}
        <small>{t('assist.week.summary', { done: week.done, focus: week.focusMin })}</small>
      </summary>
      <small>{t('assist.week.hint')}</small>
      <div className="week-bars">
        {week.days.map((d, i) => {
          const label = d.future
            ? (labels[i] ?? '')
            : t('assist.week.dayTitle', { label: labels[i] ?? '', done: d.done, focus: d.focusMin });
          return (
            <span
              key={d.day}
              className={`week-bar ${d.future ? 'future' : d.done === 0 ? 'zero' : ''} ${d.day === today ? 'today' : ''}`}
              title={label}
              role="img"
              aria-label={label}
            >
              {/* 막대는 이름표와 따로 높이가 정해진 칸 안에서 잰다 (이름표 몫만큼 큰 막대가 눌려 70% 와 100% 가 같아 보였다) */}
              <span className="week-track">
                <i style={{ height: `${d.future ? 100 : Math.max(6, (d.done / max) * 100)}%` }} />
              </span>
              <small aria-hidden="true">{labels[i]}</small>
            </span>
          );
        })}
      </div>
      <ul className="week-lines">
        <li>{t('assist.week.vsLast', { diff: week.done - week.lastDone })}</li>
        {week.dueSoon > 0 && <li>{t('assist.week.dueSoon', { n: week.dueSoon })}</li>}
      </ul>
      {children}
    </details>
  );
}

/** 짝꿍 일기 (오늘 탭 "나와 펫" 열과 큰 창 기록 구역이 같이 쓴다) */
export function DiaryBox({ s, open }: { s: PanelState; open?: boolean }) {
  return (
    <details className="achieve diary" open={open}>
      <summary>{t('diary.title', { name: s.petName })}</summary>
      {s.diary.length === 0 ? (
        <p className="empty-line">{t('diary.empty')}</p>
      ) : (
        <ul>
          {s.diary.map((d) => (
            <li key={d.day}>
              <small className="diary-day">
                {d.today ? t('diary.today') : dayHeading(d.day, s.today)}
                {d.ai && <span className="diary-ai">AI</span>}
              </small>
              <span className="diary-text">{d.text}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
