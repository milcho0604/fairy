import { useEffect, useState } from 'react';
import { locale, t } from '../../../shared/i18n/index.ts';
import type { FriendItem, FriendPerson, FriendsState } from '../../../shared/server-friends.ts';
import { friendsView } from './friends-view.ts';
import './friends-page.css';

const panel = window.jjakkungPanel;
const view = window.jjakkungFriendsView;

/** 열려 있는 동안 목록을 다시 받는 간격 (설정 창 친구 칸과 같다. 서버는 계정마다 1분 120번까지 받는다) */
export const FRIENDS_PAGE_POLL_MS = 20_000;

const nameOf = (p: FriendPerson) => p.nickname ?? (p.code || t('friends.left'));
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * 큰 창 친구 구역: 친구 목록을 읽기만 한다. 신청, 수락, 선물, 일정 공유는 설정 창의 친구 칸에서 한다 (거기로 가는 단추).
 * 친구 기능을 쓸 수 없으면 빈 목록 대신 까닭과 설정으로 가는 길을 보인다 (friends-view.ts).
 */
export function FriendsPage() {
  const [s, setS] = useState<FriendsState>();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (!view) return;
    let live = true;
    const load = () =>
      void view
        .state()
        .then((v) => live && v && setS(v))
        .catch(() => undefined);
    load();
    const off = view.onChanged((v) => live && setS(v));
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, FRIENDS_PAGE_POLL_MS);
    return () => {
      live = false;
      off();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const v = friendsView(s);
  const copy = (which: 'code' | 'link') =>
    void (which === 'code' ? view?.copyCode() : view?.copyLink())
      ?.then((ok) => ok && setCopied(which))
      .catch(() => undefined);
  const settingsButton = (label: string, primary = false) => (
    <button type="button" className={primary ? '' : 'ghost'} onClick={() => panel.openFriends()}>
      {label}
    </button>
  );

  return (
    <div className="fp" data-state={v.kind}>
      {v.kind === 'loading' && <p className="fp-note">{t('home.friends.loading')}</p>}
      {v.kind === 'problem' && <p className="fp-note">{t('home.friends.problem')}</p>}
      {v.kind === 'off' && (
        <div className="fp-card fp-off" data-reason={v.reason}>
          <p>{t(v.text)}</p>
          {settingsButton(t('home.friends.openSettings'), true)}
        </div>
      )}
      {(v.kind === 'empty' || v.kind === 'list') && s?.list && (
        <>
          <div className="fp-me">
            <span className="fp-code">{t('friends.myCode', { code: s.list.me.code })}</span>
            <span className="fp-me-actions">
              <button type="button" className="ghost small" onClick={() => copy('code')}>
                {copied === 'code' ? t('friends.copiedCode') : t('friends.copyCode')}
              </button>
              <button type="button" className="ghost small" onClick={() => copy('link')}>
                {copied === 'link' ? t('friends.copiedLink') : t('friends.copyLink')}
              </button>
            </span>
          </div>
          {v.kind === 'empty' && (
            <div className="fp-card fp-empty">
              <strong>{t('home.friends.emptyTitle')}</strong>
              <p>{t('home.friends.emptyBody')}</p>
            </div>
          )}
          {v.kind === 'list' && (
            <>
              {v.list.incoming.length > 0 && (
                <section className="fp-group">
                  <h3>{t('home.friends.incomingN', { n: v.list.incoming.length })}</h3>
                  <ul className="fp-list">
                    {v.list.incoming.map((r) => (
                      <li key={r.id}>
                        <span className="fp-name">{nameOf(r)}</span>
                        <small className="fp-sub">{r.code}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="fp-group">
                <h3>{t('friends.list', { n: v.list.friends.length, max: v.list.limits.friends })}</h3>
                {v.list.friends.length > 0 && (
                  <ul className="fp-list">
                    {v.list.friends.map((f) => (
                      <FriendLine key={f.code} f={f} s={s} />
                    ))}
                  </ul>
                )}
              </section>
              {v.list.outgoing.length > 0 && (
                <section className="fp-group">
                  <h3>{t('home.friends.outgoingN', { n: v.list.outgoing.length })}</h3>
                  <ul className="fp-list">
                    {v.list.outgoing.map((r) => (
                      <li key={r.id}>
                        <span className="fp-name">{nameOf(r)}</span>
                        <small className="fp-sub">{t('friends.until', { when: dayText(r.expiresAt) })}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          <div className="fp-manage">
            <small>{t('home.friends.manageHint')}</small>
            {settingsButton(t('home.friends.manage'))}
          </div>
        </>
      )}
    </div>
  );
}

function FriendLine({ f, s }: { f: FriendItem; s: FriendsState }) {
  const tags: string[] = [];
  if (s.calendar && f.theyShare) tags.push(t('home.friends.theyShare'));
  if (s.calendar && f.iShare) tags.push(t('home.friends.iShare'));
  if (s.visit && f.iVisit) tags.push(t('home.friends.visit'));
  return (
    <li>
      <span className="fp-name">{nameOf(f)}</span>
      <small className="fp-sub">{t('home.friends.since', { when: dayText(f.since) })}</small>
      {tags.length > 0 && (
        <span className="fp-tags">
          {tags.map((x) => (
            <small key={x} className="fp-tag">
              {x}
            </small>
          ))}
        </span>
      )}
    </li>
  );
}
