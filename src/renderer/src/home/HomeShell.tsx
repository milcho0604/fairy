import { type ReactNode, useEffect, useRef } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState, PanelTab } from '../../../shared/ipc.ts';
import { PetFace } from '../PetFace.tsx';
import { CoinIcon, GearIcon } from '../panel/icons.tsx';
import { useMailUnread } from '../panel/mail-state.ts';
import { HOME_SECTIONS, type HomeSection, sectionShortcut } from './sections.ts';

const bridge = window.jjakkungPanel;
const MAC = navigator.userAgent.includes('Mac');
/** 구역 풀이와 바닥 단추에 보이는 수식키 */
const MOD = MAC ? 'Cmd' : 'Ctrl';

interface HomeShellProps {
  s: PanelState;
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  /** 채팅 구역이 열려 있다: 본문 칸 자리에 채팅 view 가 얹힌다 (메인이 놓는다, #165) */
  chatOn: boolean;
  /** 면의 덮개 자리 (surface.tsx): 시트와 줄 메뉴가 이 창 기준으로 깔린다 */
  setOverlayRoot: (el: HTMLElement | null) => void;
  /** 밥 주기 단추에 잠깐 보이는 결과 글 */
  fed: string;
  onFeed: () => void;
  /** 본문 칸 (PanelApp 이 만든 main). 작은 패널과 같은 탭 본문이다 */
  mainEl: ReactNode;
  planSheet: ReactNode;
  toastStack: ReactNode;
}

/**
 * 큰 창의 껍데기 (이슈 #161): 사이드바(머리, 구역, 바닥)와 본문 칸. 본문은 작은 패널의 탭 본문을 그대로 쓴다.
 * 채팅은 본문 칸 자리에 채팅 화면(별도 view)이 얹히고 (#165), 친구는 본문 칸에 목록을 보이고 (관리는 설정 창), 설정은 늘 따로 창이다.
 */
export function HomeShell({
  s,
  tab,
  setTab,
  chatOn,
  setOverlayRoot,
  fed,
  onFeed,
  mainEl,
  planSheet,
  toastStack,
}: HomeShellProps) {
  /** 쪽지함 구역 옆 안 읽음 숫자 */
  const mailUnread = useMailUnread();
  const current = HOME_SECTIONS.find((x) => x.id === (chatOn ? 'chat' : tab));
  /** 지금 고른 구역인가 */
  const picked = (sec: HomeSection) => (sec.kind === 'chat' ? chatOn : !chatOn && tab === sec.id);
  const pick = (sec: HomeSection) => {
    // 채팅 열기는 메인을 거친다 (대화권 잠금을 보고, 따로 뜬 채팅 창을 닫는다)
    if (sec.id === 'chat') bridge.openChat();
    else setTab(sec.id);
  };
  const full = s.fullness >= 100;
  return (
    <div className={`surface home${MAC ? ' mac' : ''}`} ref={setOverlayRoot}>
      <aside className="home-side">
        {/* 맥은 제목 표시줄이 없는 창이라 윗부분을 잡고 끈다 */}
        <div className="home-grab" aria-hidden="true" />
        <div className="home-head">
          <PetFace />
          <h1 className="sr-only">{s.petName}</h1>
          <strong aria-hidden="true">{s.petName}</strong>
          <span className="coins" title={t('panel.coinsHint')}>
            <CoinIcon />
            {s.balance}
          </span>
        </div>
        <div className="home-fullness">
          <span className="label">{t('panel.fullness')}</span>
          <span className={`track ${s.fullness < s.hungryBelow ? 'low' : ''}`} aria-hidden="true">
            <span className="fill" style={{ width: `${s.fullness}%` }} />
          </span>
          <span className="value">{s.fullness}</span>
          <button
            type="button"
            className="ghost small"
            disabled={s.balance < s.foodCost || full}
            title={
              full
                ? t('pet.full')
                : s.balance < s.foodCost
                  ? t('panel.feedNeed', { n: s.foodCost })
                  : undefined
            }
            onClick={onFeed}
          >
            {fed || t('panel.feed', { n: s.foodCost })}
          </button>
        </div>
        <nav className="home-nav" aria-label={t('home.nav')}>
          {HOME_SECTIONS.map((sec) => {
            const key = sectionShortcut(sec.id, MOD);
            return (
              <button
                key={sec.id}
                type="button"
                id={`ptab-${sec.id}`}
                aria-current={picked(sec) ? 'page' : undefined}
                aria-controls={sec.kind === 'tab' ? 'ptab-panel' : undefined}
                className={picked(sec) ? 'on' : ''}
                onClick={() => pick(sec)}
              >
                <span className="name">{t(sec.label)}</span>
                {sec.id === 'mail' && mailUnread > 0 && (
                  <span className="mail-badge" role="img" aria-label={t('mail.unreadN', { n: mailUnread })}>
                    {mailUnread > 99 ? '99+' : mailUnread}
                  </span>
                )}
                {key && <kbd>{key.replace('Cmd+', '⌘').replace('Ctrl+', 'Ctrl ')}</kbd>}
              </button>
            );
          })}
        </nav>
        <div className="home-foot">
          <label className="home-check">
            <input
              type="checkbox"
              checked={s.panelView === 'window'}
              onChange={(e) => bridge.setPanelView(e.target.checked ? 'window' : 'compact')}
            />
            <span>{t('home.openOnPet')}</span>
          </label>
          <button type="button" className="ghost home-settings" onClick={() => bridge.openSettings()}>
            <GearIcon />
            <span>{t('home.settings')}</span>
            <kbd>{MAC ? '⌘,' : 'Ctrl ,'}</kbd>
          </button>
        </div>
      </aside>
      <div className="home-main">
        <div className="home-bar">
          <h2>{current ? t(current.label) : ''}</h2>
        </div>
        {chatOn && <ChatSlot />}
        {/* 채팅 구역 동안은 가려 두기만 한다: 쓰던 글과 보던 위치가 그대로 남아 돌아오면 이어진다 */}
        <div className="panel home-panel" hidden={chatOn}>
          {mainEl}
          {planSheet}
          {toastStack}
        </div>
      </div>
    </div>
  );
}

/**
 * 채팅 자리. 이 칸 위에 메인이 채팅 view 를 얹는다 (BaseWindow 위 별도 view, 이슈 #165).
 * 칸의 위치와 크기가 바뀔 때마다 메인에 알리고, 사라지면 null 로 채팅 view 를 감추게 한다.
 */
function ChatSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = '';
    const send = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const rect = { x: r.left, y: r.top, width: r.width, height: r.height };
      const key = JSON.stringify(rect);
      if (key === last) return;
      last = key;
      bridge.homeChat(rect);
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', send);
      bridge.homeChat(null);
    };
  }, []);
  return <div className="home-chat-slot" ref={ref} />;
}
