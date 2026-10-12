import { useCallback, useEffect, useRef, useState } from 'react';
import {
  asksScreen,
  type ChatLookView,
  type LookAi,
  lookPhase,
  shouldShoot,
} from '../../../shared/chat-look.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { OutgoingImage, ProviderView } from '../../../shared/ipc.ts';
import './screen-look.css';

const bridge = window.jjakkungChat;
const MAX_IMAGES = 4;
const OFF: ChatLookView = { on: false, agreed: false, access: 'unknown' };

/**
 * 채팅 창의 같이 보기 상태와 보내기 전 화면 찍기 (shared/chat-look.ts).
 * prepare 는 보낼 그림 목록을 돌려준다. 묻는 중(같이 보기를 꺼 둔 채 "화면 봐 줘")이거나 찍지 못했으면 undefined 라 보내지 않는다
 */
export function useChatLook(spec: ProviderView | undefined, ready: boolean) {
  const [view, setView] = useState<ChatLookView>(OFF);
  const [confirming, setConfirming] = useState(false);
  /** 같이 보기를 꺼 둔 채 화면을 물었다: 화면도 보낼지 묻는 줄 */
  const [asking, setAsking] = useState(false);
  /** 처음 켜는 안내에서 켜면 바로 보낼지 (묻는 줄의 "켜고 보내기"에서 왔다) */
  const sendAfter = useRef(false);
  const [shooting, setShooting] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const next = await bridge.look();
    if (next) setView(next);
  }, []);
  useEffect(() => {
    void refresh();
    bridge.onLook(setView);
    // 권한은 시스템 설정에서 바뀐다. 창으로 돌아오면 다시 본다
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const ai: LookAi | undefined = spec && { images: spec.images, ready };
  const phase = lookPhase(view, ai, confirming);

  async function prepare(text: string, images: OutgoingImage[], screen?: boolean) {
    setError('');
    // 꺼 둔 채 "지금 화면 봐 줘": 글만 보내 버리지 않고 화면도 보낼지 묻는다 (화면을 볼 수 있는 AI 일 때만)
    if (screen === undefined && phase === 'off' && ai?.images && ai.ready && asksScreen(text)) {
      setAsking(true);
      return undefined;
    }
    setAsking(false);
    if (!(screen ?? shouldShoot(phase))) return images;
    setShooting(true);
    const shot = await bridge.lookShot();
    setShooting(false);
    if (typeof shot === 'string') {
      // 권한이 없으면 상태 줄이 권한 안내로 바뀐다 (메인이 다시 알려 준다). 쓰던 글과 그림은 그대로 둔다
      if (shot === 'denied') void refresh();
      setError(t('chatLook.shotFailed'));
      return undefined;
    }
    return [...images.slice(0, MAX_IMAGES - 1), shot];
  }

  return {
    phase,
    view,
    shooting,
    error,
    asking,
    prepare,
    setOn(on: boolean) {
      setError('');
      if (!on) {
        setConfirming(false);
        bridge.setLook(false);
      } else if (view.agreed) bridge.setLook(true);
      else setConfirming(true);
    },
    agree(onSend: (screen: boolean) => void) {
      setConfirming(false);
      bridge.setLook(true, true);
      if (sendAfter.current) onSend(true);
      sendAfter.current = false;
    },
    cancel() {
      setConfirming(false);
      sendAfter.current = false;
    },
    answerAsk(yes: boolean, onSend: (screen: boolean) => void) {
      setAsking(false);
      if (!yes) {
        onSend(false);
        return;
      }
      if (view.agreed) {
        bridge.setLook(true);
        onSend(true);
        return;
      }
      sendAfter.current = true;
      setConfirming(true);
    },
  };
}

export type ChatLook = ReturnType<typeof useChatLook>;

/** 같이 보기 켜기 칸 (아래 옵션 줄에 다른 칸과 나란히) */
export function LookToggle({ look }: { look: ChatLook }) {
  const checked = look.view.on || look.phase === 'confirm';
  return (
    <label className="opt" title={t('chatLook.toggleTitle')}>
      <input
        type="checkbox"
        checked={checked}
        aria-describedby="look-state"
        onChange={(e) => look.setOn(e.target.checked)}
      />
      {t('chatLook.toggle')}
    </label>
  );
}

/** 같이 보기 상태 줄: 처음 켤 때 안내, 켬, 권한 없음, AI 없음, 화면도 보낼지 묻기, 찍기 실패 */
export function LookStatus({
  look,
  petName,
  spec,
  onSend,
}: {
  look: ChatLook;
  petName: string;
  spec: ProviderView | undefined;
  onSend: (screen: boolean) => void;
}) {
  const label = spec?.label ?? '';
  const mac = bridge.platform === 'darwin';
  return (
    <div id="look-state" className="look-state" aria-live="polite">
      {look.phase === 'confirm' && (
        <section className="look-confirm" aria-label={t('chatLook.confirmTitle', { name: petName })}>
          <strong>{t('chatLook.confirmTitle', { name: petName })}</strong>
          <p>{t('chatLook.what')}</p>
          <p>{spec?.images ? t('chatLook.where', { label }) : t('chatLook.whereNoAi', { label })}</p>
          <div className="action-row look-buttons">
            <button type="button" className="ghost" onClick={look.cancel}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" onClick={() => look.agree(onSend)}>
              {t('chatLook.agree')}
            </button>
          </div>
        </section>
      )}
      {look.phase === 'on' && (
        <div className="look-line on action-row">
          <span className="grow">
            <span className="look-dot" aria-hidden="true" />
            {look.shooting ? t('chatLook.shooting') : t('chatLook.on', { label })}
          </span>
          <button type="button" className="ghost" title={t('chatLook.pickTitle')} onClick={bridge.lookPick}>
            {t('chatLook.pick')}
          </button>
        </div>
      )}
      {look.phase === 'no-permission' && (
        <div className="look-line warn action-row">
          <span className="grow">
            {t('chatLook.noPermission', { name: petName })}{' '}
            {mac ? t('chatLook.noPermissionMac') : t('chat.look.permissionOther')}
          </span>
          {mac && (
            <button type="button" className="ghost" onClick={bridge.lookSettings}>
              {t('chat.look.openSettings')}
            </button>
          )}
        </div>
      )}
      {look.phase === 'no-ai' && (
        <div className="look-line warn">
          {spec?.images ? t('chatLook.notReady', { label }) : t('chatLook.noImages', { label })}
        </div>
      )}
      {look.asking && (
        <div className="look-line ask action-row">
          <span className="grow">{t('chatLook.ask', { name: petName })}</span>
          <button type="button" className="ghost" onClick={() => look.answerAsk(false, onSend)}>
            {t('chatLook.askNo')}
          </button>
          <button type="button" className="primary" onClick={() => look.answerAsk(true, onSend)}>
            {t('chatLook.askYes')}
          </button>
        </div>
      )}
      {look.error && <p className="look-line warn">{look.error}</p>}
    </div>
  );
}
