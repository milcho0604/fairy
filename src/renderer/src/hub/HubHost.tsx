// 큰 창의 페어리, 비서 구역 (설정에서 꺼낸 것). 설정 창과 같은 스냅샷과 저장 길을 쓰고, 한 번 연 구역은 숨기기만 한다
// (쓰던 글, 보던 위치, 펫 이름 칸이 구역을 오가도 남도록). 모양은 hub.css 가 .hub 아래로 가둔 설정 창 CSS 를 쓴다.
import { useRef } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelTab } from '../../../shared/ipc.ts';
import { useSettingsSnap } from '../settings/use-snap.ts';
import { AssistPage } from './AssistPage.tsx';
import { PetPage } from './PetPage.tsx';
import './hub.css';
import './hub-layout.css';

export const isHubTab = (tab: PanelTab): tab is 'pet' | 'assist' => tab === 'pet' || tab === 'assist';

export function HubHost({ tab }: { tab: PanelTab }) {
  const seen = useRef({ pet: false, assist: false });
  if (isHubTab(tab)) seen.current[tab] = true;
  if (!seen.current.pet && !seen.current.assist) return null;
  return <HubBody tab={tab} seen={seen.current} />;
}

function HubBody({ tab, seen }: { tab: PanelTab; seen: { pet: boolean; assist: boolean } }) {
  const { props, saved, savedError } = useSettingsSnap();
  const show = isHubTab(tab);
  return (
    <div className={`hub${navigator.userAgent.includes('Mac') ? ' mac' : ''}`} hidden={!show}>
      <span className={`hub-saved${savedError ? ' error' : ''}`} role="status" aria-live="polite">
        {saved}
      </span>
      {!props ? (
        <p className="hub-loading">{t('hub.loading')}</p>
      ) : (
        <>
          {seen.pet && (
            <div className="hub-page" hidden={tab !== 'pet'} id="hub-page-pet">
              <PetPage {...props} />
            </div>
          )}
          {seen.assist && (
            <div className="hub-page" hidden={tab !== 'assist'} id="hub-page-assist">
              <AssistPage {...props} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
