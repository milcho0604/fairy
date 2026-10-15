// 페어리 서버 계정 (이슈 #99, 기획서 5, 6, 21절): 설정 > 데이터 칸. 나이 확인과 두 모드, 서버 코인, 구글 로그인,
// 합치기 확인, 탈퇴. 창은 상태(ServerStatus)만 받는다. 토큰과 네트워크는 메인(main/server.ts)에만 있다.
// 서버 주소 없이 만든 판에서는 칸을 통째로 숨긴다 (serverView 'hidden').
import { useEffect, useRef, useState } from 'react';
import { locale, t } from '../../../shared/i18n/index.ts';
import {
  AGE_ANSWERS,
  type AgeAnswer,
  type ServerBridge,
  type ServerStatus,
  serverView,
} from '../../../shared/server-account.ts';
import { NicknameStep, ProfileRows } from './ServerProfile.tsx';
import { Section } from './ui.tsx';

declare global {
  interface Window {
    jjakkungServer?: ServerBridge;
  }
}

const server = () => window.jjakkungServer;

const AGE_KEY = {
  under14: 'server.age.under14',
  teen: 'server.age.teen',
  adult: 'server.age.adult',
} as const;

/** 상태를 받아 두고 바뀌면 다시 그린다 (복원 확인 칸도 서버 모드인지 본다) */
export function useServerStatus(): [ServerStatus | undefined, (s: ServerStatus | undefined) => void] {
  const [s, setS] = useState<ServerStatus>();
  useEffect(() => {
    const b = server();
    if (!b) return;
    let live = true;
    void b
      .status()
      .then((v) => {
        if (live && v) setS(v);
      })
      .catch(() => undefined);
    const off = b.onChanged((v) => {
      if (live) setS(v);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return [s, (v) => v && setS(v)];
}

const itemCount = (items: Record<string, number>) => Object.keys(items).length;

export function ServerAccountBox({ flash }: { flash: (message: string, error?: boolean) => void }) {
  const [s, setS] = useServerStatus();
  const [busy, setBusy] = useState(false);
  const [changingAge, setChangingAge] = useState(false);
  const [sureRemove, setSureRemove] = useState(false);
  /** 나이 답을 고르고 닉네임을 기다리는 중 (서버 모드를 처음 켤 때, #101) */
  const [nickFor, setNickFor] = useState<AgeAnswer | null>(null);
  const mergeRef = useRef<HTMLButtonElement>(null);
  const view = serverView(s);
  // 합치기 확인이 뜨면 "합치지 않기"에 초점 (Enter 를 잘못 눌러도 합치지 않게)
  useEffect(() => {
    if (s?.merge) mergeRef.current?.focus();
  }, [s?.merge]);
  if (view === 'hidden' || !s) return null;
  const b = server();
  if (!b) return null;

  const run = async (f: () => Promise<ServerStatus | undefined>) => {
    setBusy(true);
    try {
      setS(await f());
    } catch {
      // 상태는 메인이 다시 보낸다
    } finally {
      setBusy(false);
    }
  };
  const pickAge = (age: AgeAnswer) => {
    setChangingAge(false);
    // 만 14세 이상으로 서버 모드를 처음 켤 때는 닉네임부터 (만 14세 미만은 서버로 보내지 않는다)
    if (age !== 'under14' && !s.nickname && (view === 'askAge' || view === 'appMode')) return setNickFor(age);
    void run(() => b.setAge(age));
  };
  const remove = async () => {
    if (!sureRemove) return setSureRemove(true);
    setSureRemove(false);
    setBusy(true);
    try {
      const r = await b.remove();
      setS(r.status);
      flash(t(r.ok ? 'server.removed' : 'server.removeFailed'), !r.ok);
    } catch {
      flash(t('server.removeFailed'), true);
    } finally {
      setBusy(false);
    }
  };

  const ageButtons = (
    <div className="action-row server-ages">
      {AGE_ANSWERS.map((a) => (
        <button
          key={a}
          type="button"
          className={`ghost${s.age === a ? ' on' : ''}`}
          aria-pressed={s.age === a}
          disabled={busy}
          onClick={() => pickAge(a)}
        >
          {t(AGE_KEY[a])}
        </button>
      ))}
      {changingAge && (
        <button type="button" className="ghost small" onClick={() => setChangingAge(false)}>
          {t('server.age.keep')}
        </button>
      )}
    </div>
  );

  if (nickFor)
    return (
      <Section title={t('server.title')}>
        <NicknameStep
          busy={busy}
          onBack={() => setNickFor(null)}
          onStart={(nickname) => {
            const age = nickFor;
            setNickFor(null);
            void run(() => b.setAge(age, nickname));
          }}
        />
      </Section>
    );

  if (view === 'askAge')
    return (
      <Section title={t('server.title')}>
        <div className="server-box">
          <small className="server-ask">{t('server.ask.title')}</small>
          <small>{t('server.ask.why')}</small>
          {ageButtons}
        </div>
      </Section>
    );

  const ageLine = (
    <div className="action-row server-age-line">
      <small>{t('server.age.line', { age: t(AGE_KEY[s.age ?? 'adult']) })}</small>
      {!changingAge && (
        <button type="button" className="ghost small" disabled={busy} onClick={() => setChangingAge(true)}>
          {t('server.age.change')}
        </button>
      )}
    </div>
  );
  const removeRow = (
    <>
      <small>{t('server.removeHint')}</small>
      <div className="action-row">
        <button
          type="button"
          className={`ghost${sureRemove ? ' danger' : ''}`}
          disabled={busy}
          onClick={() => void remove()}
          onBlur={() => setSureRemove(false)}
        >
          {sureRemove ? t('server.removeSure') : t('server.remove')}
        </button>
      </div>
    </>
  );
  const problem = s.problem ? (
    <small className="warn server-problem">{t(`server.problem.${s.problem}`)}</small>
  ) : null;

  if (view === 'appMode' || view === 'serverOff')
    return (
      <Section title={t('server.title')}>
        <div className="server-box">
          <small>{t(view === 'appMode' ? 'server.appMode' : 'server.off')}</small>
          {problem}
          {ageLine}
          {changingAge && ageButtons}
          {view === 'serverOff' && (
            <div className="action-row">
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void run(() => b.turnOn())}
              >
                {t('server.turnOn')}
              </button>
            </div>
          )}
          {s.leftover && (
            <>
              <small className="warn">{t('server.leftover')}</small>
              {removeRow}
            </>
          )}
        </div>
      </Section>
    );

  const syncLine = [
    s.balance === null ? t('server.balanceNone') : t('server.balance', { n: s.balance }),
    s.syncing
      ? t('server.syncing')
      : s.lastSyncAt
        ? t('server.lastSync', {
            time: new Date(s.lastSyncAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }),
          })
        : '',
    s.pending > 0 ? t('server.pending', { n: s.pending }) : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Section title={t('server.title')}>
      <div className="server-box">
        <small className="server-sync">{syncLine}</small>
        {problem}
        <div className="action-row">
          <button
            type="button"
            className="ghost small"
            disabled={busy || s.syncing}
            onClick={() => void run(() => b.syncNow())}
          >
            {t('server.syncNow')}
          </button>
        </div>
        <small>{t('server.what')}</small>
        <ProfileRows s={s} b={b} setS={setS} flash={flash} />
        {s.merge ? (
          <div className="notice server-merge" role="alertdialog" aria-labelledby="server-merge-ask">
            <small id="server-merge-ask" className="server-ask">
              {t('server.merge.ask')}
            </small>
            <small>
              {t('server.merge.current', {
                n: s.merge.current.balance,
                items: itemCount(s.merge.current.items),
              })}
            </small>
            <small>
              {t('server.merge.other', { n: s.merge.other.balance, items: itemCount(s.merge.other.items) })}
            </small>
            <small className="warn">{t('server.merge.note')}</small>
            <div className="action-row">
              <button
                type="button"
                className="ghost danger"
                disabled={busy}
                onClick={() => void run(() => b.merge(true))}
              >
                {t('server.merge.yes')}
              </button>
              <button
                type="button"
                className="ghost"
                ref={mergeRef}
                disabled={busy}
                onClick={() => void run(() => b.merge(false))}
              >
                {t('server.merge.no')}
              </button>
            </div>
          </div>
        ) : s.loggingIn ? (
          <div className="action-row">
            <small>{t('server.loggingIn')}</small>
            <button type="button" className="ghost small" onClick={() => b.cancelLogin()}>
              {t('server.cancel')}
            </button>
          </div>
        ) : s.signedIn ? (
          <>
            <small>{t('server.signedIn')}</small>
            {/* AI 대화권 (#100): 만 18세 이상 로그인일 때만. 14~17 이나 서버 주소가 없으면 보이지 않는다 */}
            {s.ai && s.tickets !== null && <small>{t('ticket.settings', { n: s.tickets })}</small>}
            <div className="action-row">
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void run(() => b.logout())}
              >
                {t('server.logout')}
              </button>
            </div>
          </>
        ) : (
          <>
            <small>{t('server.noLoginHint')}</small>
            <div className="action-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !s.device}
                onClick={() => {
                  // 브라우저 로그인은 몇 분 걸릴 수 있다: 칸을 막지 않는다 (그만두기는 메인이 보내는 상태로 뜬다)
                  void b
                    .login()
                    .then(setS)
                    .catch(() => undefined);
                }}
              >
                {t('server.login')}
              </button>
            </div>
          </>
        )}
        {ageLine}
        {changingAge && ageButtons}
        {removeRow}
      </div>
    </Section>
  );
}
