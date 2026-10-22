import type { ReactNode } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState, PanelTab } from '../../../shared/ipc.ts';
import { PetFace } from '../PetFace.tsx';
import { CoinIcon, GearIcon } from '../panel/icons.tsx';
import { HOME_SECTIONS, type HomeSection, sectionShortcut, visibleSections } from './sections.ts';

const bridge = window.jjakkungPanel;
const MAC = navigator.userAgent.includes('Mac');
/** 구역 풀이와 바닥 단추에 보이는 수식키 */
const MOD = MAC ? 'Cmd' : 'Ctrl';

interface HomeShellProps {
  s: PanelState;
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
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
 * 채팅과 친구는 따로 창을 열고(1단계), 설정은 늘 따로 창이다.
 */
export function HomeShell({
  s,
  tab,
  setTab,
  setOverlayRoot,
  fed,
  onFeed,
  mainEl,
  planSheet,
  toastStack,
}: HomeShellProps) {
  const sections = visibleSections(s.friendsOn);
  const current = HOME_SECTIONS.find((x) => x.id === tab);
  const pick = (sec: HomeSection) => {
    if (sec.id === 'chat') bridge.openChat();
    else if (sec.id === 'friends') bridge.openFriends();
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
          {sections.map((sec) => {
            const key = sectionShortcut(sec.id, s.friendsOn, MOD);
            const own = sec.kind === 'window';
            return (
              <button
                key={sec.id}
                type="button"
                id={`ptab-${sec.id}`}
                aria-current={!own && tab === sec.id ? 'page' : undefined}
                aria-controls={own ? undefined : 'ptab-panel'}
                className={!own && tab === sec.id ? 'on' : ''}
                title={own ? t('home.opensWindow') : undefined}
                onClick={() => pick(sec)}
              >
                <span className="name">{t(sec.label)}</span>
                {own && (
                  <span className="out" aria-hidden="true">
                    ↗
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
        <div className="panel home-panel">
          {mainEl}
          {planSheet}
          {toastStack}
        </div>
      </div>
    </div>
  );
}
