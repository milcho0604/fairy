import { useEffect, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { FriendsState } from '../../../shared/server-friends.ts';
import { FriendsBox } from '../settings/FriendsBox.tsx';
import { friendsView } from './friends-view.ts';
import './friends-page.css';

const panel = window.jjakkungPanel;
const FLASH_MS = 4000;

/**
 * 큰 창 친구 구역: 설정의 친구 칸(settings/FriendsBox.tsx)을 그대로 쓴다. 친구 맺기, 받은 신청 수락과 거절, 보낸 신청 취소,
 * 바쁜 시간과 일정 제목 공유, 선물, 펫 놀러 가기(운영자가 연 경우만), 끊기와 차단이 여기서 된다.
 * 친구 기능을 쓸 수 없으면 빈 목록 대신 까닭과 설정으로 가는 길을 보인다 (friends-view.ts).
 */
export function FriendsPage() {
  const [s, setS] = useState<FriendsState>();
  const [flash, setFlash] = useState<{ text: string; error: boolean }>();

  useEffect(() => {
    const b = window.jjakkungFriends;
    if (!b) return;
    let live = true;
    void b
      .state()
      .then((v) => live && v && setS(v))
      .catch(() => undefined);
    const off = b.onChanged((v) => live && setS(v));
    return () => {
      live = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(undefined), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const v = friendsView(s);
  return (
    <div className="fp" data-state={v.kind}>
      {flash && (
        <div className={`fp-flash${flash.error ? ' error' : ''}`} role="status">
          {flash.text}
        </div>
      )}
      {v.kind === 'loading' && <p className="fp-note">{t('home.friends.loading')}</p>}
      {v.kind === 'off' && (
        <div className="fp-card fp-off" data-reason={v.reason}>
          <p>{t(v.text)}</p>
          <button type="button" className="ghost" onClick={() => panel.openFriends()}>
            {t('home.friends.openSettings')}
          </button>
        </div>
      )}
      {v.kind === 'box' && <FriendsBox flash={(text, error) => setFlash({ text, error: !!error })} />}
    </div>
  );
}
