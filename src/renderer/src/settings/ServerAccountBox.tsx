// 페어리 서버 계정 (이슈 #99, 기획서 5, 6, 21절): 설정 > 데이터 칸. 나이 확인과 두 모드, 서버 코인, 구글 로그인,
// 합치기 확인, 탈퇴. 창은 상태(ServerStatus)만 받는다. 토큰과 네트워크는 메인(main/server.ts)에만 있다.
// 서버 주소 없이 만든 판에서는 칸을 통째로 숨긴다 (serverView 'hidden').
// 칸은 뜻 묶음 차례로: 내 정보, 로그인, 채팅 이용권(쓸 수 있을 때만), 코인 동기화, 서버 백업, 서버로 가는 것, 맨 아래 따로 둔 되돌릴 수 없는 일.
// 운영자 쪽지 안내는 묶음 밖 한 줄이다 (코인 동기화 아래).
// 단추는 두 크기: 줄 끝 동작(복사, 바꾸기, 코인 동기화)은 작은 것, 묶음 동작(로그인, 올리기)은 보통. 위험한 것은 빨간 테두리
// 하나 (줄 격자와 간격은 settings.css "서버 계정과 코인").
import { useEffect, useRef, useState } from 'react';
import { locale, t } from '../../../shared/i18n/index.ts';
import {
  AGE_ANSWERS,
  type AgeAnswer,
  type LoginService,
  type ServerBridge,
  type ServerStatus,
  serverView,
} from '../../../shared/server-account.ts';
import { useNear } from './NearResult.tsx';
import { ServerBackupBox } from './ServerBackupBox.tsx';
import { NicknameStep, ProfileRows, Row } from './ServerProfile.tsx';
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

const LOGIN_KEY = { google: 'server.login', kakao: 'server.login.kakao' } as const;
const LINK_KEY = { google: 'server.link.google', kakao: 'server.link.kakao' } as const;
const VIA_KEY = { google: 'server.via.google', kakao: 'server.via.kakao' } as const;

/** 이은 서비스 이름 ("구글", "구글, 카카오"). 모르면 구글 (예전 판이 남긴 세션) */
function viaText(logins: readonly LoginService[]): string {
  const names = (logins.length ? logins : (['google'] as const)).map((s) => t(VIA_KEY[s]));
  return names.length === 2
    ? t('server.via.and', { a: names[0] ?? '', b: names[1] ?? '' })
    : (names[0] ?? '');
}

export function ServerAccountBox() {
  const [s, setS] = useServerStatus();
  const [busy, setBusy] = useState(false);
  const [changingAge, setChangingAge] = useState(false);
  const [sureRemove, setSureRemove] = useState(false);
  // 지우기 결과는 단추 아래에 남긴다 (지운 뒤 칸이 처음으로 돌아가도 거기에 보인다)
  const [removeNear, removeFlash] = useNear();
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
      removeFlash(() => t(r.ok ? 'server.removed' : 'server.removeFailed'), !r.ok);
    } catch {
      removeFlash(() => t('server.removeFailed'), true);
    } finally {
      setBusy(false);
    }
  };

  /** 나이 고르기 단추. 처음 묻는 칸은 보통 크기, 내 정보 줄 아래에서 바꿀 때는 그 묶음의 작은 크기 */
  const ageButtons = (size: 'ghost' | 'ghost small') => (
    <div className="action-row server-ages">
      {AGE_ANSWERS.map((a) => (
        <button
          key={a}
          type="button"
          className={`${size}${s.age === a ? ' on' : ''}`}
          aria-pressed={s.age === a}
          disabled={busy}
          onClick={() => pickAge(a)}
        >
          {t(AGE_KEY[a])}
        </button>
      ))}
      {changingAge && (
        <button type="button" className={size} onClick={() => setChangingAge(false)}>
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
        <div className="server-box" data-search={t('server.searchKeys')}>
          {/* 나이를 묻기 전에 서버 계정이 해 주는 것부터 (이 칸이 왜 있는지 모르고 지나치지 않게) */}
          <small className="server-benefit">{t('server.benefit')}</small>
          <div className="server-group">
            <h3 className="server-group-title server-ask">{t('server.ask.title')}</h3>
            <small>{t('server.ask.why')}</small>
            {ageButtons('ghost')}
          </div>
          {removeNear}
        </div>
      </Section>
    );

  const ageRow = (
    <Row
      label={t('server.age.label')}
      action={
        !changingAge && (
          <button type="button" className="ghost small" disabled={busy} onClick={() => setChangingAge(true)}>
            {t('server.age.change')}
          </button>
        )
      }
    >
      {t(AGE_KEY[s.age ?? 'adult'])}
    </Row>
  );
  // 브라우저 로그인은 몇 분 걸릴 수 있다: 칸을 막지 않는다 (그만두기는 메인이 보내는 상태로 뜬다)
  const loginWith = (service: LoginService) => {
    void b
      .login(service)
      .then(setS)
      .catch(() => undefined);
  };
  // 서버가 알려 준 서비스만 보인다. 아직 모르면(서버에 닿기 전) 구글만 예전처럼
  const loginServices: readonly LoginService[] = s.providers?.login ?? ['google'];
  const linkServices = (s.providers?.link ?? []).filter((x) => !s.logins.includes(x));
  /** 맨 아래 따로 둔 칸: 서버 계정 지우기 (두 번 눌러 지운다) */
  const dangerZone = (note?: string) => (
    <div className="server-danger">
      <h3 className="server-group-title">{t('server.group.danger')}</h3>
      {note && <small className="warn">{note}</small>}
      <small>{t('server.removeHint')}</small>
      <div className="action-row">
        <button
          type="button"
          className="ghost danger"
          disabled={busy}
          onClick={() => void remove()}
          onBlur={() => setSureRemove(false)}
        >
          {sureRemove ? t('server.removeSure') : t('server.remove')}
        </button>
      </div>
      {removeNear}
    </div>
  );
  const problem = s.problem ? (
    <small className="warn server-problem" role="status">
      {t(`server.problem.${s.problem}`)}
    </small>
  ) : null;
  // 업데이트 단추 (이슈 #120): 서버가 낡은 앱이라고 막았을 때만 (다시 쓰려면 업데이트)
  const updateNow =
    s.problem === 'update' ? (
      <div className="action-row">
        <button
          type="button"
          className="ghost small"
          disabled={busy}
          onClick={() => void run(() => b.updateNow())}
        >
          {t('server.updateNow')}
        </button>
      </div>
    ) : null;

  if (view === 'appMode' || view === 'serverOff')
    return (
      <Section title={t('server.title')}>
        <div className="server-box">
          <div className="server-group">
            <small>{t(view === 'appMode' ? 'server.appMode' : 'server.off')}</small>
            {problem}
            {updateNow}
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
          </div>
          <div className="server-group">
            <div className="server-rows">{ageRow}</div>
            {changingAge && ageButtons('ghost small')}
          </div>
          {s.leftover && dangerZone(t('server.leftover'))}
        </div>
      </Section>
    );

  /** 채팅 이용권 묶음을 보인다: 쓸 수 있거나 (남은 장수를 받았을 때), 자리가 차서 대기 중일 때 (#100, #101 와 같은 조건) */
  const passOn = (s.ai && s.tickets !== null) || s.aiWaitlisted;
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
        {problem}
        {updateNow}
        <ProfileRows s={s} b={b} setS={setS} after={changingAge && ageButtons('ghost small')}>
          {ageRow}
        </ProfileRows>

        <div className="server-group">
          <h3 className="server-group-title">{t('server.group.login')}</h3>
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
            <>
              <small>{t('server.loggingIn')}</small>
              <div className="action-row">
                <button type="button" className="ghost" onClick={() => b.cancelLogin()}>
                  {t('server.cancel')}
                </button>
              </div>
            </>
          ) : s.signedIn ? (
            <>
              <small>{t('server.signedIn', { via: viaText(s.logins) })}</small>
              <div className="action-row">
                {/* 다른 서비스도 잇기 (21절). 서버가 이 계정에 허락한 것만 (카카오는 기능 키) */}
                {linkServices.map((x) => (
                  <button
                    key={x}
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => loginWith(x)}
                  >
                    {t(LINK_KEY[x])}
                  </button>
                ))}
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
                {loginServices.map((x) => (
                  <button
                    key={x}
                    type="button"
                    className="ghost"
                    disabled={busy || !s.device}
                    onClick={() => loginWith(x)}
                  >
                    {t(LOGIN_KEY[x])}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 채팅 이용권 묶음 (#121): 남은 장수, 구독과 다음 채움일, 대기 안내, 고르는 법. 쓸 수 없는 계정은 묶음을 통째로 숨긴다 */}
        {passOn && (
          <div className="server-group server-pass">
            <h3 className="server-group-title">{t('ticket.label')}</h3>
            {s.ai && s.tickets !== null && (
              <>
                <span className="server-pass-count">{t('ticket.passCount', { n: s.tickets })}</span>
                <small>{t('ticket.passHow')}</small>
              </>
            )}
            {s.subscription && (
              <small>
                {t('ticket.subscription', { n: s.subscription.monthly, day: s.subscription.nextFill ?? '-' })}
              </small>
            )}
            {s.aiWaitlisted && <small className="warn">{t('ticket.waitlisted')}</small>}
          </div>
        )}

        <div className="server-group">
          <h3 className="server-group-title">{t('server.group.sync')}</h3>
          <div className="server-line">
            <small className="server-sync">{syncLine}</small>
            <button
              type="button"
              className="ghost small"
              disabled={busy || s.syncing}
              onClick={() => void run(() => b.syncNow())}
            >
              {t('server.syncNow')}
            </button>
          </div>
        </div>

        {/* 운영자 쪽지 안내: 묶음 밖 한 줄 (패널 쪽지함에서 연다) */}
        {s.inbox > 0 && <small className="server-inbox">{t('server.inbox', { n: s.inbox })}</small>}

        {!s.merge && !s.loggingIn && s.signedIn && s.backup && (
          <ServerBackupBox b={b} view={s.backup} setS={setS} />
        )}

        <details className="server-what">
          <summary>
            <small className="server-what-short">{t('server.what')}</small>
            <span className="server-more">{t('server.what.more')}</span>
          </summary>
          <ul>
            <li>{t('server.what.basic')}</li>
            <li>{t('server.what.login')}</li>
            <li>{t('server.what.chat')}</li>
            <li>{t('server.what.backup')}</li>
          </ul>
        </details>

        {dangerZone()}
      </div>
    </Section>
  );
}
