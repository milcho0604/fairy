// 이벤트와 쿠폰 (이슈 #101, 기획서 9절): 설정 > 데이터. 목록은 홈페이지 정적 파일 events.json 이라 서버 없이도 보인다.
// 선물 받기와 쿠폰 쓰기는 서버 모드(만 14세 이상, 서버 주소 있음)에서만 단추가 보인다.
import { useEffect, useState } from 'react';
import type { EventList, EventsBridge } from '../../../shared/events-ipc.ts';
import { getLang, locale, t } from '../../../shared/i18n/index.ts';
import { serverView } from '../../../shared/server-account.ts';
import { eventPhase, normalizeCoupon, type SiteEvent } from '../../../shared/site-events.ts';
import { useNear } from './NearResult.tsx';
import { useServerStatus } from './ServerAccountBox.tsx';
import { Section } from './ui.tsx';

declare global {
  interface Window {
    jjakkungEvents?: EventsBridge;
  }
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(locale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function what(e: SiteEvent): string {
  if (e.kind === 'gift') return t('events.gift', { n: e.coins ?? 0 });
  const names = (e.boost?.reasons ?? []).map((r) => t(`events.reason.${r}`)).join(t('events.and'));
  return t('events.boost', { what: names, n: e.boost?.times ?? 1 });
}

const claimError = (e: string) =>
  [
    'already_claimed',
    'not_started',
    'ended',
    'no_event',
    'offline',
    'rate_limited',
    'login_required',
  ].includes(e)
    ? t(`events.err.${e as 'already_claimed'}`)
    : t('events.err.other');
const couponError = (e: string) =>
  ['code', 'no_coupon', 'already_used', 'sold_out', 'not_started', 'ended'].includes(e)
    ? t(`coupon.err.${e as 'code'}`)
    : e === 'offline' || e === 'rate_limited' || e === 'login_required'
      ? t(`events.err.${e}`)
      : t('events.err.other');

export function EventsBox() {
  const [list, setList] = useState<EventList>();
  const [s] = useServerStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // 결과는 누른 단추 아래에 남긴다 (창 맨 위 안내는 2초 뒤 사라진다)
  const [claimNear, claimSay, claimClear] = useNear();
  const [claimFor, setClaimFor] = useState<string | null>(null);
  const [couponNear, couponSay] = useNear();
  /** 서버가 모른다고 답한 이벤트 (목록은 홈페이지가, 선물은 서버 장부가 정한다. 둘이 어긋나면 이 판에서는 단추를 숨긴다) */
  const [unknown, setUnknown] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const b = window.jjakkungEvents;
    if (!b) return;
    let live = true;
    void b.list().then((l) => live && l && setList(l));
    const off = b.onChanged((l) => live && setList(l));
    return () => {
      live = false;
      off();
    };
  }, []);
  const server = window.jjakkungServer;
  const serverMode = serverView(s) === 'server' && !!server;
  if (!list) return null;
  const lang = getLang();
  const now = Date.now();

  const claim = async (id: string) => {
    if (!server) return;
    setBusy(id);
    setClaimFor(id);
    claimClear();
    try {
      const r = await server.claim(id);
      if (r.ok) claimSay(t('events.claimOk', { n: r.coins }));
      else {
        if (r.error === 'no_event') setUnknown((u) => new Set(u).add(id));
        claimSay(claimError(r.error), r.error !== 'already_claimed');
      }
    } finally {
      setBusy(null);
    }
  };
  const applyCoupon = async () => {
    if (!server) return;
    const norm = normalizeCoupon(code);
    if (!norm) return couponSay(t('coupon.err.code'), true);
    setBusy('coupon');
    try {
      const r = await server.coupon(norm);
      if (r.ok) {
        setCode('');
        couponSay(t('coupon.ok', { coins: r.coins, passes: r.tickets }));
      } else couponSay(couponError(r.error), true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title={t('events.title')}>
      <div className="events-box">
        {list.events.length === 0 ? (
          <small>{t('events.empty')}</small>
        ) : (
          <ul className="event-list">
            {list.events.map((e) => {
              const phase = eventPhase(e, now);
              const got = list.claimed.includes(e.id);
              return (
                <li key={e.id} className={`event-item ${phase}`}>
                  <div className="event-text">
                    <strong dir="auto">{e.title[lang]}</strong>
                    <div className="event-meta">
                      <small className="event-what">{what(e)}</small>
                      <small className="event-when">
                        {phase === 'soon'
                          ? t('events.soon', { when: when(e.from) })
                          : phase === 'live'
                            ? t('events.live', { when: when(e.until) })
                            : t('events.ended')}
                      </small>
                    </div>
                    <small dir="auto">{e.body[lang]}</small>
                    {e.kind === 'boost' && phase !== 'ended' && <small>{t('events.boostNote')}</small>}
                  </div>
                  {/* 선물 받기: 줄 끝 동작이라 작은 단추, 글 오른쪽에 */}
                  {serverMode && e.kind === 'gift' && phase === 'live' && (
                    <div className="action-row item-actions">
                      {unknown.has(e.id) ? (
                        <small className="event-pending">{t('events.pending')}</small>
                      ) : (
                        <button
                          type="button"
                          className="ghost small"
                          disabled={got || busy !== null}
                          onClick={() => void claim(e.id)}
                        >
                          {got ? t('events.claimed') : t('events.claim')}
                        </button>
                      )}
                    </div>
                  )}
                  {claimFor === e.id && claimNear}
                </li>
              );
            })}
          </ul>
        )}
        {serverMode ? (
          <div className="server-group coupon-box">
            <h3 className="server-group-title">{t('coupon.label')}</h3>
            <div className="action-row coupon-row">
              <input
                className="plain-input coupon-input"
                aria-label={t('coupon.label')}
                placeholder={t('coupon.placeholder')}
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void applyCoupon();
                }}
              />
              <button
                type="button"
                className="ghost"
                disabled={busy !== null}
                onClick={() => void applyCoupon()}
              >
                {t('coupon.use')}
              </button>
            </div>
            {couponNear}
          </div>
        ) : (
          s?.enabled && <small>{t('events.serverOnly')}</small>
        )}
      </div>
    </Section>
  );
}
