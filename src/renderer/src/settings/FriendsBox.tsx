// 서버 친구 (이슈 #110 1부): 설정 > 데이터의 친구 칸. 친구 맺기(코드, 초대 링크), 받은 신청, 선물, 바쁜 시간 공유, 친구별 일정 제목 공유.
// 칸은 서버 모드(만 14세 이상, 서버 주소 있음), 로그인, 서버가 켠 친구 기능일 때만 보인다 (아니면 아무것도 그리지 않는다).
// 다른 서버 칸(ServerAccountBox 등)과 따로 둔다: 그 칸들의 마크업은 건드리지 않는다. 모양은 friends.css 에만.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type I18nKey, locale, t } from '../../../shared/i18n/index.ts';
import {
  type BusyView,
  busyByDay,
  type FriendItem,
  type FriendPerson,
  type FriendResult,
  type FriendsBridge,
  type FriendsState,
  spansWithoutTitles,
  titlesByDay,
  type VisitInfo,
} from '../../../shared/server-friends.ts';
import { useNear } from './NearResult.tsx';
import './friends.css';

declare global {
  interface Window {
    jjakkungFriends?: FriendsBridge;
  }
}

const bridge = () => window.jjakkungFriends;

const ERRORS = [
  'code',
  'no_user',
  'self',
  'already_friends',
  'already_requested',
  'blocked_by_you',
  'unavailable',
  'limit',
  'rate_limited',
  'offline',
  'not_friend',
  'balance',
  'no_passes',
  'passes_age',
  'passes_not_allowed',
  'passes_not_giftable',
  'daily_send_limit',
  'daily_receive_limit',
  'feature_off',
  'expired',
  'no_request',
  'not_shared',
  'title_age',
  'busy_off',
];
const errorText = (e: string) =>
  t((ERRORS.includes(e) ? `friends.err.${e}` : 'friends.err.other') as I18nKey);

const nameOf = (p: FriendPerson) => p.nickname ?? (p.code || t('friends.left'));
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
/** 시각 글: 앞에 0을 붙이지 않는다 ("오후 3:00", 설정 창의 다른 시각과 같은 모양) */
const clock = (dayStart: number, minute: number) =>
  new Date(dayStart + minute * 60_000).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });

/** 설정 창이 열려 있는 동안 친구 목록을 다시 받는 간격 (서버는 계정마다 1분 120번까지 받는다) */
export const FRIENDS_POLL_MS = 20_000;

/** 상태를 받아 두고 바뀌면 다시 그린다 */
function useFriends(): [FriendsState | undefined, (s: FriendsState | undefined) => void] {
  const [s, setS] = useState<FriendsState>();
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let live = true;
    void b
      .state()
      .then((v) => live && v && setS(v))
      .catch(() => undefined);
    const off = b.onChanged((v) => live && setS(v));
    return () => {
      live = false;
      off();
    };
  }, []);
  return [s, (v) => v && setS(v)];
}

export function FriendsBox({ flash }: { flash: (message: string, error?: boolean) => void }) {
  const [s] = useFriends();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [giftTo, setGiftTo] = useState<string | null>(null);
  const [busyOf, setBusyOf] = useState<({ code: string } & BusyView) | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  const [vi, setVi] = useState<VisitInfo>();
  const [refreshNear, refreshSay] = useNear();
  const [refreshing, setRefreshing] = useState(false);
  const b = bridge();
  const available = !!s?.available;

  // 칸이 보이는 동안은 몇 분을 기다리지 않고 조금씩 다시 받는다 (새 신청이 바로 보이게). 다른 탭이나 숨은 창에서는 쉰다
  useEffect(() => {
    if (!b || !available) return;
    const timer = setInterval(() => {
      if (document.hidden || !boxRef.current || boxRef.current.offsetParent === null) return;
      void b.refresh().catch(() => undefined);
    }, FRIENDS_POLL_MS);
    return () => clearInterval(timer);
  }, [b, available]);

  // 오늘 놀러 온 친구 펫 수와 "오늘은 그만" (손님 창을 맡은 메인이 답한다). 상태가 바뀔 때마다 다시 읽는다
  // biome-ignore lint/correctness/useExhaustiveDependencies: s?.list 는 읽지 않지만 목록이 바뀔 때 다시 읽으려고 넣었다
  useEffect(() => {
    if (!b || !s?.visit) return;
    let live = true;
    void b
      .visitInfo()
      .then((v) => live && setVi(v))
      .catch(() => undefined);
    // 창이 다시 앞에 오면 다시 읽는다 (트레이, 펫 메뉴에서 "오늘은 그만"을 눌렀을 수 있다)
    const again = () =>
      void b
        .visitInfo()
        .then((v) => live && setVi(v))
        .catch(() => undefined);
    window.addEventListener('focus', again);
    return () => {
      live = false;
      window.removeEventListener('focus', again);
    };
  }, [b, s?.visit, s?.list]);

  // 초대 링크(fairy://friend/<코드>)로 열었으면 코드를 칸에 넣고 이 칸이 보이게 내린다
  useEffect(() => {
    if (!s?.prefill) return;
    setText(s.prefill);
    boxRef.current?.scrollIntoView({ block: 'start' });
    b?.clearPrefill();
  }, [s?.prefill, b]);

  if (!b || !s?.available) return null;
  const list = s.list;

  /** 단추 하나: 누르는 동안 다른 단추를 막고, 결과를 상태줄에 */
  async function run<T>(
    key: string,
    f: () => Promise<FriendResult<T>>,
    ok: string,
  ): Promise<FriendResult<T>> {
    setBusy(key);
    setSure(null);
    try {
      const r = await f();
      if (r.ok) flash(ok);
      else flash(errorText(r.error), true);
      return r;
    } catch {
      flash(t('friends.err.other'), true);
      return { ok: false, error: 'other' };
    } finally {
      setBusy(null);
    }
  }

  /** 두 번 눌러 하는 단추 (끊기, 차단) */
  const twice = (key: string, go: () => void) => () => {
    if (sure !== key) return setSure(key);
    go();
  };

  const send = async () => {
    const r = await run('send', () => b.request(text), t('friends.sent'));
    if (r.ok) {
      setText('');
      if (r.data.accepted) flash(t('friends.acceptedNow'));
    }
  };

  const showBusy = async (f: FriendItem) => {
    if (busyOf?.code === f.code) return setBusyOf(null);
    setBusy(`busy:${f.code}`);
    try {
      const r = await b.busy(f.code);
      if (r.ok) setBusyOf({ code: f.code, ...r.data });
      else flash(errorText(r.error), true);
    } finally {
      setBusy(null);
    }
  };

  const off = busy !== null;
  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const r = await b.refresh();
      if (r?.problem) refreshSay(errorText(r.problem), true);
      else refreshSay(t('friends.refreshed'));
    } catch {
      refreshSay(t('friends.err.other'), true);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section ref={boxRef} id="friends" className="friends-box">
      <h2>{t('friends.title')}</h2>
      <div className="card">
        <small>{t('friends.hint')}</small>
        {s.visit && vi && (
          <div className="friends-visitbar">
            <small className="friends-visitinfo">
              {vi.paused ? t('friends.visitPaused') : t('friends.visitToday', { n: vi.today, max: vi.max })}
            </small>
            <button
              type="button"
              className="ghost small"
              onClick={() => void b.visitPause(!vi.paused).then((v) => v && setVi(v))}
            >
              {vi.paused ? t('friends.visitResume') : t('friends.visitPause')}
            </button>
            <small className="friends-note">{t('friends.visitMeeting')}</small>
          </div>
        )}
        {list && (
          <div className="action-row friends-me">
            <small className="friends-code">{t('friends.myCode', { code: list.me.code })}</small>
            <button
              type="button"
              className="ghost small"
              onClick={() => void b.copyCode().then((ok) => ok && flash(t('friends.copiedCode')))}
            >
              {t('friends.copyCode')}
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => void b.copyLink().then((ok) => ok && flash(t('friends.copiedLink')))}
            >
              {t('friends.copyLink')}
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={refreshing}
              onClick={() => void refreshNow()}
            >
              {t('friends.refresh')}
            </button>
          </div>
        )}
        {refreshNear}
        <div className="action-row friends-add">
          <input
            className="plain-input friends-input"
            aria-label={t('friends.paste')}
            placeholder={t('friends.paste')}
            maxLength={300}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) void send();
            }}
          />
          <button type="button" className="ghost" disabled={off || !text.trim()} onClick={() => void send()}>
            {t('friends.send')}
          </button>
        </div>
        {s.problem && !list && <small className="warn">{errorText(s.problem)}</small>}

        {list && list.incoming.length > 0 && (
          <div className="friends-group">
            <small className="friends-head">{t('friends.incoming')}</small>
            <ul className="friends-list">
              {list.incoming.map((r) => (
                <li key={r.id}>
                  <span className="friends-name">{nameOf(r)}</span>
                  <small className="friends-sub">{r.code}</small>
                  <span className="friends-actions">
                    <button
                      type="button"
                      className="ghost small"
                      disabled={off}
                      onClick={() => void run('accept', () => b.accept(r.id), t('friends.accepted'))}
                    >
                      {t('friends.accept')}
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={off}
                      onClick={() => void run('decline', () => b.decline(r.id), t('friends.declined'))}
                    >
                      {t('friends.decline')}
                    </button>
                    <button
                      type="button"
                      className={`ghost small${sure === `block:${r.code}` ? ' danger' : ''}`}
                      disabled={off}
                      onBlur={() => setSure(null)}
                      onClick={twice(
                        `block:${r.code}`,
                        () => void run('block', () => b.block(r.code), t('friends.blockedOk')),
                      )}
                    >
                      {sure === `block:${r.code}` ? t('friends.blockSure') : t('friends.block')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {list && list.outgoing.length > 0 && (
          <div className="friends-group">
            <small className="friends-head">{t('friends.outgoing')}</small>
            <ul className="friends-list">
              {list.outgoing.map((r) => (
                <li key={r.id}>
                  <span className="friends-name">{nameOf(r)}</span>
                  <small className="friends-sub">{t('friends.until', { when: dayText(r.expiresAt) })}</small>
                  <span className="friends-actions">
                    <button
                      type="button"
                      className="ghost small"
                      disabled={off}
                      onClick={() => void run('cancel', () => b.cancel(r.id), t('friends.cancel'))}
                    >
                      {t('friends.cancel')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {list && (
          <div className="friends-group">
            <small className="friends-head">
              {t('friends.list', { n: list.friends.length, max: list.limits.friends })}
            </small>
            {list.friends.length === 0 ? (
              <small className="below">{t('friends.none')}</small>
            ) : (
              <ul className="friends-list">
                {list.friends.map((f) => (
                  <FriendRow
                    key={f.code}
                    f={f}
                    s={s}
                    off={off}
                    sure={sure}
                    setSure={setSure}
                    giftOpen={giftTo === f.code}
                    onGift={() => setGiftTo(giftTo === f.code ? null : f.code)}
                    busyView={busyOf?.code === f.code ? busyOf : null}
                    onBusy={() => void showBusy(f)}
                    run={run}
                    twice={twice}
                    b={b}
                    closeGift={() => setGiftTo(null)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {list && list.blocked.length > 0 && (
          <div className="friends-group">
            <small className="friends-head">{t('friends.blocked')}</small>
            <ul className="friends-list">
              {list.blocked.map((p) => (
                <li key={p.code}>
                  <span className="friends-name">{nameOf(p)}</span>
                  <small className="friends-sub">{p.code}</small>
                  <span className="friends-actions">
                    <button
                      type="button"
                      className="ghost small"
                      disabled={off}
                      onClick={() => void run('unblock', () => b.unblock(p.code), t('friends.unblock'))}
                    >
                      {t('friends.unblock')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function FriendRow(o: {
  f: FriendItem;
  s: FriendsState;
  off: boolean;
  sure: string | null;
  setSure: (v: string | null) => void;
  giftOpen: boolean;
  onGift: () => void;
  closeGift: () => void;
  busyView: BusyView | null;
  onBusy: () => void;
  run: <T>(key: string, f: () => Promise<FriendResult<T>>, ok: string) => Promise<FriendResult<T>>;
  twice: (key: string, go: () => void) => () => void;
  b: FriendsBridge;
}) {
  const { f, s, b } = o;
  const notes: ReactNode[] = [];
  if (s.calendar && f.iShare)
    notes.push(
      <small key="share" className="friends-note">
        {t('friends.shareHint')}
      </small>,
    );
  if (s.calendar && f.iShare && f.canTitle && f.iTitle)
    notes.push(
      <small key="title" className="friends-note">
        {t('friends.shareTitleHint')}
      </small>,
    );
  if (s.calendar && f.iShare && !f.canTitle)
    notes.push(
      <small key="adults" className="friends-note">
        {t('friends.shareTitleAdults')}
      </small>,
    );
  if (s.visit && f.iVisit)
    notes.push(
      <small key="visit" className="friends-note">
        {t('friends.visitHint')}
      </small>,
    );
  if (s.visit && f.iVisit && s.visitCustom)
    notes.push(
      <small key="custom" className="friends-note">
        {t('friends.visitCustom')}
      </small>,
    );
  return (
    <li className="friends-friend">
      <div className="friends-line">
        <span className="friends-name">{nameOf(f)}</span>
        <small className="friends-sub">{f.code}</small>
        {f.theyShare && <small className="friends-tag">{t('friends.theyShare')}</small>}
        {f.theyTitle && <small className="friends-tag">{t('friends.theyShareTitle')}</small>}
        {s.visit && f.theyVisit && <small className="friends-tag">{t('friends.theyVisit')}</small>}
        <span className="friends-actions">
          {s.gifts && (
            <button type="button" className="ghost small" disabled={o.off} onClick={o.onGift}>
              {t('friends.gift')}
            </button>
          )}
          {s.calendar && f.theyShare && (
            <button type="button" className="ghost small" disabled={o.off} onClick={o.onBusy}>
              {o.busyView ? t('friends.busyClose') : t('friends.busy')}
            </button>
          )}
          <button
            type="button"
            className={`ghost small${o.sure === `remove:${f.code}` ? ' danger' : ''}`}
            disabled={o.off}
            onBlur={() => o.setSure(null)}
            onClick={o.twice(
              `remove:${f.code}`,
              () => void o.run('remove', () => b.remove(f.code), t('friends.removed')),
            )}
          >
            {o.sure === `remove:${f.code}` ? t('friends.removeSure') : t('friends.remove')}
          </button>
          <button
            type="button"
            className={`ghost small${o.sure === `block:${f.code}` ? ' danger' : ''}`}
            disabled={o.off}
            onBlur={() => o.setSure(null)}
            onClick={o.twice(
              `block:${f.code}`,
              () => void o.run('block', () => b.block(f.code), t('friends.blockedOk')),
            )}
          >
            {o.sure === `block:${f.code}` ? t('friends.blockSure') : t('friends.block')}
          </button>
        </span>
      </div>
      {s.calendar && (
        <label className="friends-share">
          <input
            type="checkbox"
            checked={f.iShare}
            disabled={o.off}
            onChange={(e) => {
              const on = e.target.checked;
              void o.run('share', () => b.share(f.code, on), t(on ? 'friends.shareOn' : 'friends.shareOff'));
            }}
          />
          <span>{t('friends.share')}</span>
        </label>
      )}
      {s.calendar && f.iShare && f.canTitle && (
        <label className="friends-titleshare">
          <input
            type="checkbox"
            checked={f.iTitle}
            disabled={o.off}
            onChange={(e) => {
              const on = e.target.checked;
              void o.run(
                'shareTitle',
                () => b.shareTitle(f.code, on),
                t(on ? 'friends.shareTitleOn' : 'friends.shareTitleOff'),
              );
            }}
          />
          <span>{t('friends.shareTitle')}</span>
        </label>
      )}
      {s.visit && (
        <label className="friends-visit">
          <input
            type="checkbox"
            checked={f.iVisit}
            disabled={o.off}
            onChange={(e) => {
              const on = e.target.checked;
              void o.run('visit', () => b.visit(f.code, on), t(on ? 'friends.visitOn' : 'friends.visitOff'));
            }}
          />
          <span>{t('friends.visit')}</span>
        </label>
      )}
      {s.visit && <small className="friends-note">{t('friends.visitDirection', { name: nameOf(f) })}</small>}
      {s.visit && f.iVisit && !f.theyVisit && (
        <small className="friends-note">{t('friends.visitWaiting')}</small>
      )}
      {/* 스위치 설명은 접어 둔다 (친구마다 같은 긴 글이 늘어서지 않게) */}
      {notes.length > 0 && (
        <details className="friends-more">
          <summary>{t('friends.more')}</summary>
          {notes}
        </details>
      )}
      {o.giftOpen && <GiftForm f={f} s={s} off={o.off} run={o.run} b={b} close={o.closeGift} />}
      {o.busyView && (
        <BusyWeek
          name={nameOf(f)}
          blocks={o.busyView.blocks}
          titles={o.busyView.titles}
          at={o.busyView.updatedAt}
        />
      )}
    </li>
  );
}

function GiftForm(o: {
  f: FriendItem;
  s: FriendsState;
  off: boolean;
  run: <T>(key: string, f: () => Promise<FriendResult<T>>, ok: string) => Promise<FriendResult<T>>;
  b: FriendsBridge;
  close: () => void;
}) {
  const { s } = o;
  const [coins, setCoins] = useState('');
  const [passes, setPasses] = useState('');
  const limits = s.list?.limits;
  const today = s.list?.today ?? { coins: 0, passes: 0 };
  const leftCoins = Math.max(0, (limits?.giftCoinsPerDay ?? 500) - today.coins);
  const leftPasses = Math.max(0, (limits?.giftPassesPerDay ?? 5) - today.passes);
  const c = Number(coins || 0);
  const p = s.passGifts ? Number(passes || 0) : 0;
  const valid = Number.isInteger(c) && Number.isInteger(p) && c >= 0 && p >= 0 && c + p > 0;
  const go = async () => {
    if (!valid) return;
    const r = await o.run(
      'gift',
      () => o.b.gift(o.f.code, c, p),
      t('friends.giftOk', { coins: c, passes: p }),
    );
    if (r.ok) o.close();
  };
  return (
    <div className="friends-gift">
      <div className="action-row">
        <label className="friends-amount">
          <span>{t('friends.giftCoins')}</span>
          <input
            className="plain-input"
            type="number"
            min={0}
            max={leftCoins}
            inputMode="numeric"
            aria-label={t('friends.giftCoins')}
            value={coins}
            onChange={(e) => setCoins(e.target.value)}
          />
        </label>
        {s.passGifts && (
          <label className="friends-amount">
            <span>{t('friends.giftPasses')}</span>
            <input
              className="plain-input"
              type="number"
              min={0}
              max={leftPasses}
              inputMode="numeric"
              aria-label={t('friends.giftPasses')}
              value={passes}
              onChange={(e) => setPasses(e.target.value)}
            />
          </label>
        )}
        <button type="button" className="ghost small" disabled={o.off || !valid} onClick={() => void go()}>
          {t('friends.giftSend')}
        </button>
        <button type="button" className="ghost small" disabled={o.off} onClick={o.close}>
          {t('friends.giftClose')}
        </button>
      </div>
      <small className="friends-note">
        {s.passGifts
          ? t('friends.giftHint', {
              coins: limits?.giftCoinsPerDay ?? 500,
              passes: limits?.giftPassesPerDay ?? 5,
              leftCoins,
              leftPasses,
            })
          : t('friends.giftCoinsOnly', { coins: limits?.giftCoinsPerDay ?? 500, left: leftCoins })}
      </small>
      {s.balance !== null && (
        <small className="friends-note">
          {s.passGifts && s.passes !== null
            ? t('friends.havePasses', { coins: s.balance, passes: s.passes })
            : t('friends.have', { coins: s.balance })}
        </small>
      )}
    </div>
  );
}

/** 친구의 이번 주(오늘부터 7일) 바쁜 시간. 날마다 막대와 시간 글 */
function BusyWeek(o: {
  name: string;
  blocks: BusyView['blocks'];
  titles: BusyView['titles'];
  at: string | null;
}) {
  const now = Date.now();
  const days = busyByDay(o.blocks, now, 7);
  const titled = titlesByDay(o.titles, now, 7);
  const any = days.some((d) => d.spans.length > 0);
  return (
    <section className="friends-busy" aria-label={t('friends.busyTitle', { name: o.name })}>
      <small className="friends-head">{t('friends.busyTitle', { name: o.name })}</small>
      {!any && <small className="below">{t('friends.busyNone')}</small>}
      <ul>
        {days.map((d) => {
          const items = titled.find((x) => x.day === d.day)?.items ?? [];
          // 제목이 있는 일정은 제목 줄에 시간이 있다. 같은 시간을 한 번 더 적지 않고, 제목 없는 바쁜 시간만 따로 적는다
          const plain = spansWithoutTitles(d.spans, items);
          return (
            <li key={d.day}>
              <small className="friends-day">
                {new Date(d.day).toLocaleDateString(locale(), {
                  weekday: 'short',
                  month: 'numeric',
                  day: 'numeric',
                })}
              </small>
              <span className="friends-bar" aria-hidden="true">
                {d.spans.map((x) => (
                  <i
                    key={`${x.from}-${x.to}`}
                    style={{ left: `${(x.from / 1440) * 100}%`, width: `${((x.to - x.from) / 1440) * 100}%` }}
                  />
                ))}
              </span>
              {(d.spans.length === 0 || plain.length > 0) && (
                <small className="friends-times">
                  {d.spans.length === 0
                    ? t('friends.busyFree')
                    : plain.map((x) => `${clock(d.day, x.from)}~${clock(d.day, x.to)}`).join(', ')}
                </small>
              )}
              {items.length > 0 && (
                <span className="friends-titles">
                  {items.map((x) => (
                    <span className="friends-event" key={`${x.from}-${x.to}-${x.title}`}>
                      <small className="friends-when">{`${clock(d.day, x.from)}~${clock(d.day, x.to)}`}</small>
                      <span className="friends-event-title">{x.title}</span>
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {o.at && (
        <small className="friends-note">
          {t('friends.busyAt', {
            when: new Date(o.at).toLocaleString(locale(), {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }),
          })}
        </small>
      )}
    </section>
  );
}
