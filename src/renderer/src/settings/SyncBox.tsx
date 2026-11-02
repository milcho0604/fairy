// 기기 간 동기화 (docs/sync-plan.md 7절): 설정 > 데이터와 계정, 서버 계정 칸 아래.
// 서버 계정을 켜고 로그인했고 서버가 기능 키 sync 를 열었을 때만 보인다 (규칙은 shared/sync-ui.ts).
// 꺼짐, 복구 코드 넣기(다른 기기), 올릴지 묻기, 켜짐의 네 모양과, 복구 코드를 한 번 보여 주는 칸.
// 복구 코드는 메인이 답으로 한 번 준다. 이 창은 메모리에만 들고 있다가 "적어 뒀어"를 누르고 닫으면 버린다.
import { type FormEvent, useEffect, useState } from 'react';
import { type I18nKey, locale, t } from '../../../shared/i18n/index.ts';
import type { SyncBoxMode } from '../../../shared/sync-ui.ts';
import {
  codeWhy,
  problemKey,
  sizeText,
  syncBoxMode,
  syncErrorKey,
  syncLines,
  syncShown,
  syncUnavailable,
} from '../../../shared/sync-ui.ts';
import type { SyncReply, SyncView } from '../../../shared/sync-view.ts';
import { useNear } from './NearResult.tsx';
import { useServerStatus } from './ServerAccountBox.tsx';
import { Section } from './ui.tsx';

type Why = 'created' | 'new' | 'rotate' | 'kept';
interface Reveal {
  code: string;
  why: Why;
  /** 코드를 받은 때의 서버 계정 코드 (계정이 바뀌거나 로그아웃하면 버린다) */
  acct: string | null;
}

/**
 * 막 받은 복구 코드. 탭을 옮겨 이 칸이 사라져도 "적어 뒀어"를 누르기 전에는 이 창의 메모리에 남긴다
 * (켜기는 이미 끝났는데 코드를 못 본 채 잃는 일을 막는다). 디스크나 저장소에는 쓰지 않는다
 */
let pending: Reveal | null = null;

const server = () => window.jjakkungServer;
/** 키가 합집합일 때 쓰는 느슨한 t (채울 값은 줄마다 다르다) */
const tt = t as (key: I18nKey, vars?: Record<string, string | number>) => string;

const parts = (code: string) => code.split('-');

export function SyncBox() {
  const [s] = useServerStatus();
  const [reveal, setReveal] = useState<Reveal | null>(pending);
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState<'rotate' | 'local' | 'wipe' | null>(null);
  const [input, setInput] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  const [near, flash, clearNear] = useNear();
  // "방금 맞췄어"가 시간이 가면 "몇 시에 맞춤"으로 바뀌게 가끔 다시 그린다
  const [, tick] = useState(0);
  // 설정 창이 열려 있는 동안 30초마다 기능 키와 상태를 다시 묻는다 (창이 닫히면 이 칸도 사라져 멈춘다)
  useEffect(() => {
    const id = setInterval(() => {
      tick((n) => n + 1);
      void server()
        ?.status()
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const hold = (next: Omit<Reveal, 'acct'> | null) => {
    const r = next && { ...next, acct: s?.code ?? null };
    pending = r;
    // 코드 칸에서 남긴 "복사했어" 같은 줄이 닫은 뒤 아래 칸에 남지 않게
    if (!r) clearNear();
    setReveal(r);
    setAcked(false);
  };

  // 코드를 들고 있는 동안 설정 창을 화면 캡처에서 가린다
  useEffect(() => {
    const sync = server()?.sync;
    if (!reveal || !sync) return;
    sync.protect(true);
    return () => sync.protect(false);
  }, [reveal]);
  // 계정이 바뀌거나 로그아웃하면 들고 있던 코드를 버린다
  useEffect(() => {
    if (reveal && s && (!s.signedIn || s.code !== reveal.acct)) hold(null);
  });

  const b = server()?.sync;
  if (!syncShown(s) || !s?.sync || !b) return null;
  const v: SyncView = s.sync;
  // 서버가 기능 키를 껐는데 이 기기는 켜 둔 상태: 쓸 수 없다는 한 줄과 끄기만
  const mode: SyncBoxMode | 'unavailable' = syncUnavailable(s) ? 'unavailable' : syncBoxMode(v);

  /** 단추 하나의 일: 누르는 동안 막고, 실패는 단추 아래에 보인다 */
  const run = async (f: () => Promise<SyncReply>, done: (r: SyncReply) => void) => {
    setBusy(true);
    try {
      const r = await f();
      done(r);
    } catch {
      flash(() => t('sync.err.failed'), true);
    } finally {
      setBusy(false);
    }
  };
  const fail = (r: Extract<SyncReply, { ok: false }>) => {
    if (r.code) hold({ code: r.code, why: 'kept' });
    flash(() => t(r.code ? 'sync.err.keptCode' : syncErrorKey(r.error)), true);
  };

  const enable = () =>
    run(
      () => b.enable(),
      (r) => {
        if (!r.ok) return fail(r);
        if (r.kind === 'created' && r.code) hold({ code: r.code, why: 'created' });
      },
    );
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setBad(null);
    void run(
      () => b.enterCode(input),
      (r) => {
        if (r.ok) return setInput('');
        if (r.error === 'code') return setBad(t('sync.need.bad'));
        setBad(t(syncErrorKey(r.error)));
      },
    );
  };
  const newCode = () =>
    run(
      () => b.newCode(),
      (r) => (r.ok ? r.code && hold({ code: r.code, why: 'new' }) : fail(r)),
    );
  const rotate = () =>
    run(
      () => b.rotateKey(),
      (r) => (r.ok ? r.code && hold({ code: r.code, why: 'rotate' }) : fail(r)),
    );
  const disable = (wipe: boolean) =>
    run(
      () => b.disable(wipe),
      (r) => (r.ok ? flash(() => t(wipe ? 'sync.wiped' : 'sync.disabled')) : fail(r)),
    );
  /** 위험한 단추는 두 번 눌러야 한다 (설정의 다른 위험 단추와 같은 방식) */
  const twice = (which: 'rotate' | 'local' | 'wipe', go: () => Promise<void>) => () => {
    if (sure !== which) return setSure(which);
    setSure(null);
    void go();
  };

  const lines = mode === 'on' ? syncLines(v, Date.now()) : [];
  const timeText = (at: number) =>
    new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Section title={t('sync.title')} id="sync-box">
      <div
        className="server-box sync-box"
        data-search={t('sync.searchKeys')}
        data-sync-mode={reveal ? 'code' : mode}
      >
        {reveal && (
          <div className="server-group sync-reveal">
            <h3 className="server-group-title">{t('sync.code.title')}</h3>
            <small>{t(reveal.why === 'kept' ? 'sync.err.keptCode' : 'sync.code.lede')}</small>
            {/* biome-ignore lint/a11y/useSemanticElements: 글자 묶음을 이어 붙인 한 값이라 fieldset 이 아니다 */}
            <div className="sync-code" role="group" aria-label={t('sync.code.groups')}>
              {parts(reveal.code).map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 코드 다섯 묶음의 자리
                <span key={i} className="sync-code-part">
                  {p}
                </span>
              ))}
            </div>
            <small className="warn">{t('sync.code.lost')}</small>
            {reveal.why === 'new' && <small>{t('sync.code.newNote')}</small>}
            {reveal.why === 'rotate' && <small>{t('sync.code.rotateNote')}</small>}
            <div className="action-row">
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  void b
                    .copyCode(reveal.code)
                    .then((ok) => flash(() => t(ok ? 'sync.code.copied' : 'sync.code.saveFailed'), !ok))
                    .catch(() => flash(() => t('sync.code.saveFailed'), true))
                }
              >
                {t('sync.code.copy')}
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  void b
                    .saveCode(reveal.code)
                    .then((r) => {
                      if (r.canceled) return;
                      flash(() => t(r.ok ? 'sync.code.saved' : 'sync.code.saveFailed'), !r.ok);
                    })
                    .catch(() => flash(() => t('sync.code.saveFailed'), true))
                }
              >
                {t('sync.code.save')}
              </button>
            </div>
            {near}
            <label className="sync-ack">
              <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
              <span>{t('sync.code.ack')}</span>
            </label>
            <div className="action-row">
              <button type="button" className="ghost" disabled={!acked} onClick={() => hold(null)}>
                {t('sync.code.done')}
              </button>
            </div>
          </div>
        )}

        {!reveal && mode === 'unavailable' && (
          <div className="server-group">
            <small className="warn">{t('sync.unavailable')}</small>
            <div className="action-row">
              <button
                type="button"
                className={`ghost${sure === 'local' ? ' danger' : ''}`}
                disabled={busy}
                onBlur={() => setSure(null)}
                onClick={twice('local', () => disable(false))}
              >
                {sure === 'local' ? t('sync.sure') : t('sync.disable.local')}
              </button>
            </div>
            {near}
          </div>
        )}

        {!reveal && mode === 'off' && (
          <div className="server-group">
            <small>{t('sync.off.lede')}</small>
            {v.problem && <small className="warn">{t(problemKey(v.problem))}</small>}
            <div className="action-row">
              <button type="button" className="ghost" disabled={busy} onClick={() => void enable()}>
                {busy ? t('sync.turningOn') : t('sync.turnOn')}
              </button>
            </div>
            {near}
          </div>
        )}

        {!reveal && mode === 'enabling' && (
          <div className="server-group">
            <small role="status">{t('sync.turningOn')}</small>
          </div>
        )}

        {!reveal && mode === 'code' && (
          <form className="server-group sync-need" onSubmit={submitCode}>
            <small>{t(codeWhy(v))}</small>
            <label className="sync-need-field">
              <span className="server-row-label">{t('sync.need.label')}</span>
              <input
                className="plain-input sync-code-input"
                value={input}
                placeholder={t('sync.need.placeholder')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={80}
                aria-invalid={bad ? true : undefined}
                aria-describedby={bad ? 'sync-need-bad' : undefined}
                onChange={(e) => {
                  setInput(e.target.value);
                  setBad(null);
                }}
              />
            </label>
            {bad && (
              <small id="sync-need-bad" className="warn" role="alert">
                {bad}
              </small>
            )}
            <div className="action-row">
              <button type="submit" className="ghost" disabled={busy || !input.trim()}>
                {busy ? t('sync.need.checking') : t('sync.need.submit')}
              </button>
              <button
                type="button"
                className="ghost small"
                disabled={busy}
                onClick={() => void disable(false)}
              >
                {t('sync.need.cancel')}
              </button>
            </div>
            {near}
          </form>
        )}

        {!reveal && mode === 'ask' && (
          <div className="server-group">
            <small className="sync-ask-lede">{t('sync.ask.lede')}</small>
            <small>{t('sync.ask.hint')}</small>
            <div className="action-row">
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => b.uploadLocal(),
                    (r) => !r.ok && fail(r),
                  )
                }
              >
                {t('sync.ask.upload')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => b.downloadOnly(),
                    (r) => !r.ok && fail(r),
                  )
                }
              >
                {t('sync.ask.download')}
              </button>
            </div>
            {near}
          </div>
        )}

        {!reveal && mode === 'on' && (
          <>
            <div className="server-group">
              <ul className="sync-status" aria-live="polite">
                {lines.map((l) => (
                  <li key={l.key} className={l.tone === 'ok' ? 'sync-line' : `sync-line ${l.tone}`}>
                    {tt(l.key, { time: l.at ? timeText(l.at) : '', n: l.n ?? 0, pct: l.pct ?? 0 })}
                  </li>
                ))}
              </ul>
              {v.usage && (
                <small className="sync-usage">
                  {t('sync.usage', {
                    used: v.usage.items.toLocaleString(locale()),
                    items: v.usage.maxItems.toLocaleString(locale()),
                    bytes: sizeText(v.usage.bytes),
                    size: sizeText(v.usage.maxBytes),
                  })}
                </small>
              )}
            </div>
            <div className="server-group">
              <h3 className="server-group-title">{t('sync.group.keys')}</h3>
              <div className="sync-do">
                <small>{t('sync.newCode.hint')}</small>
                <div className="action-row">
                  <button type="button" className="ghost" disabled={busy} onClick={() => void newCode()}>
                    {t('sync.newCode')}
                  </button>
                </div>
              </div>
              <div className="sync-do">
                <small>{t('sync.rotate.hint')}</small>
                <div className="action-row">
                  <button
                    type="button"
                    className={`ghost${sure === 'rotate' ? ' danger' : ''}`}
                    disabled={busy}
                    onBlur={() => setSure(null)}
                    onClick={twice('rotate', rotate)}
                  >
                    {sure === 'rotate' ? t('sync.sure') : t('sync.rotate')}
                  </button>
                </div>
              </div>
              {near}
            </div>
            <div className="server-danger">
              <h3 className="server-group-title">{t('sync.group.danger')}</h3>
              <div className="sync-do">
                <small>{t('sync.disable.local.hint')}</small>
                <div className="action-row">
                  <button
                    type="button"
                    className={`ghost${sure === 'local' ? ' danger' : ''}`}
                    disabled={busy}
                    onBlur={() => setSure(null)}
                    onClick={twice('local', () => disable(false))}
                  >
                    {sure === 'local' ? t('sync.sure') : t('sync.disable.local')}
                  </button>
                </div>
              </div>
              <div className="sync-do">
                <small className="warn">{t('sync.disable.wipe.hint')}</small>
                <div className="action-row">
                  <button
                    type="button"
                    className="ghost danger"
                    disabled={busy}
                    onBlur={() => setSure(null)}
                    onClick={twice('wipe', () => disable(true))}
                  >
                    {sure === 'wipe' ? t('sync.sure') : t('sync.disable.wipe')}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
