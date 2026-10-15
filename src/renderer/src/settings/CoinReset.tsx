import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { CoinState } from '../../../shared/ipc.ts';
import { type CoinResetScope, nothingToReset } from '../../../shared/shop.ts';
import { bridge } from './ui.tsx';

/**
 * 코인 초기화 (설정 > 데이터). 범위를 고르고(기본 코인만) 단추를 누르면 이 화면 안에서 한 번 더 묻는다 (OS 팝업 없이).
 * 묻는 글은 누를 때 새로 읽은 숫자이고, 메인은 그 잔액이 그대로일 때만 한다: 그사이 패널에서 사거나 받으면 하지 않는다
 */
export function CoinReset({ flash }: { flash: (message: string, error?: boolean) => void }) {
  const [scope, setScope] = useState<CoinResetScope>('coins');
  const [view, setView] = useState<CoinState>();
  /** 묻는 중: 그때 읽은 숫자 */
  const [ask, setAsk] = useState<CoinState>();
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const s = await bridge.coinState().catch(() => undefined);
    if (s) setView(s);
    // 서버 모드에서는 코인만 (산 물건은 서버에 남아 다음 맞추기 때 돌아온다)
    if (s?.serverCoins) setScope('coins');
    return s;
  }, []);
  useEffect(() => {
    void refresh();
    // 패널에서 코인을 받거나 쓴 뒤 설정 창으로 돌아오면 숫자를 새로 읽는다
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  // 묻는 상자가 열리면 "그만두기"에 초점 (Enter 를 잘못 눌러도 지우지 않게)
  useEffect(() => {
    if (ask) cancelRef.current?.focus();
  }, [ask]);

  const pick = (next: CoinResetScope) => {
    setScope(next);
    // 범위를 바꾸면 묻던 글이 맞지 않다. 다시 누르게 한다
    setAsk(undefined);
  };
  const start = async () => {
    const s = await refresh();
    if (!s) return flash(t('settings.coinReset.failed'), true);
    if (nothingToReset(s, scope))
      return flash(t(scope === 'all' ? 'settings.coinReset.nothingAll' : 'settings.coinReset.nothing'));
    setAsk(s);
  };
  const sure = async () => {
    if (!ask || busy) return;
    setBusy(true);
    try {
      const r = await bridge.resetCoins(scope, ask.balance);
      setView(r.state);
      setAsk(undefined);
      if (r.result.ok)
        flash(
          t(scope === 'all' && r.result.items > 0 ? 'settings.coinReset.doneAll' : 'settings.coinReset.done'),
        );
      else flash(t('settings.coinReset.changed'), true);
    } catch {
      flash(t('settings.coinReset.failed'), true);
    } finally {
      setBusy(false);
    }
  };

  const empty = !view || nothingToReset(view, scope);
  return (
    <div className="coin-reset">
      <small>{t('settings.coinReset.hint')}</small>
      {view && (
        <small className="coin-now">
          {t('settings.coinReset.now', { n: view.balance, items: view.items })}
        </small>
      )}
      <div className="field">
        <span id="coin-reset-scope">{t('settings.coinReset.scope')}</span>
        <fieldset className="segmented" aria-labelledby="coin-reset-scope" disabled={busy}>
          {(view?.serverCoins ? (['coins'] as const) : (['coins', 'all'] as const)).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              className={scope === s ? 'on' : undefined}
              onClick={() => pick(s)}
            >
              {t(s === 'all' ? 'settings.coinReset.all' : 'settings.coinReset.coins')}
            </button>
          ))}
        </fieldset>
        {scope === 'all' && <small>{t('settings.coinReset.allHint')}</small>}
        {view?.serverCoins && <small>{t('server.coinResetNote')}</small>}
      </div>
      {ask ? (
        <div
          className="notice coin-ask"
          role="alertdialog"
          aria-labelledby="coin-ask-text"
          aria-describedby="coin-ask-warn"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAsk(undefined);
          }}
        >
          <small id="coin-ask-text">
            {scope === 'all' && ask.items > 0
              ? t('settings.coinReset.confirmAll', { n: ask.balance, items: ask.items })
              : t('settings.coinReset.confirmCoins', { n: ask.balance })}
          </small>
          <small id="coin-ask-warn" className="warn">
            {t('settings.coinReset.warn')}
          </small>
          <div className="action-row">
            <button type="button" className="ghost danger" disabled={busy} onClick={() => void sure()}>
              {t('settings.coinReset.sure')}
            </button>
            <button
              type="button"
              className="ghost"
              ref={cancelRef}
              disabled={busy}
              onClick={() => setAsk(undefined)}
            >
              {t('settings.coinReset.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="action-row">
          <button type="button" className="ghost" disabled={empty} onClick={() => void start()}>
            {t('settings.coinReset.start')}
          </button>
        </div>
      )}
      {view && empty && !ask && (
        <small className="below">
          {t(scope === 'all' ? 'settings.coinReset.nothingAll' : 'settings.coinReset.nothing')}
        </small>
      )}
    </div>
  );
}
