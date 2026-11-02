// 설정 값과 그것을 바꾸는 길 (설정 창과 큰 창의 페어리, 비서 구역이 같이 쓴다)
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveErrorText } from '../../../shared/download-error.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import { lookKey, type Settings } from '../../../shared/settings.ts';
import { bridge, type TabProps } from './ui.tsx';

export interface SettingsHandle {
  snap: SettingsSnapshot | undefined;
  /** 상태줄 안내 글 (비었으면 없음) */
  saved: string;
  savedError: boolean;
  /** 탭이 받는 값. snap 이 아직 없으면 undefined */
  props: TabProps | undefined;
  flash: (message: string, error?: boolean) => void;
}

/**
 * 설정 스냅샷을 받아 들고 메인이 바꾼 값을 따라간다. 실패나 막힘 안내는 빨간 글씨 (성공 안내와 같은 초록이면 된 것처럼 읽힌다).
 * 펫 만들기 창에서 새 펫을 저장하면 보관함과 지금 그림이 바뀐다. 그때만 스냅샷을 다시 받는다.
 */
export function useSettingsSnap(): SettingsHandle {
  const [snap, setSnap] = useState<SettingsSnapshot>();
  const [saved, setSaved] = useState('');
  const [savedError, setSavedError] = useState(false);
  const libraryKey = useRef('');
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    bridge.get().then(setSnap);
    bridge.onChanged((settings) => {
      // 몸을 다시 만들면(걸음새) 설계도 파일만 바뀐다. 그때도 지금 펫 카드와 몸 모양을 다시 받는다
      // 밀크, 초코의 네 발 피규어를 켜고 끌 때도 (사진이 피규어로 바뀐다, #28)
      const key = lookKey(settings);
      if (key !== libraryKey.current) {
        libraryKey.current = key;
        // 설정과 보관함을 한 번에 바꾼다. 설정만 먼저 바꾸면 잠깐 새 지금 펫과 옛 보관함이 섞여 카드가 사라졌다 나타났다
        void bridge
          .get()
          .then((next) =>
            setSnap(
              (s) => s && { ...s, settings: next.settings, library: next.library, current: next.current },
            ),
          );
        return;
      }
      setSnap((s) => s && { ...s, settings });
    });
    bridge.onPower((onBattery) => setSnap((s) => s && { ...s, onBattery }));
  }, []);

  // 앞 안내의 지우기 타이머가 새 안내를 일찍 지우지 않게 하나만 둔다 (빈 이름 안내 뒤 "이름을 바꿨어"가 바로 사라졌다)
  const flash = useCallback((message: string, error = false) => {
    setSaved(message);
    setSavedError(error);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSaved(''), 2400);
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const props: TabProps | undefined = snap && {
    snap,
    setSnap,
    flash,
    update: async (patch: Partial<Settings>, message = t('settings.saved')) => {
      let next: Settings;
      try {
        next = await bridge.set(patch);
      } catch (err) {
        // 저장 공간이 없거나 폴더에 쓸 수 없으면 바뀌지 않았다고 알린다 (예전에는 말없이 원래대로 돌아갔다)
        console.warn('settings save failed', err);
        flash(saveErrorText(err), true);
        return snap.settings;
      }
      setSnap((v) => v && { ...v, settings: next });
      // 언어를 바꾸면 화면이 새 말로 다시 그려진다. 옛 말로 만든 안내가 남지 않게 숨긴다
      if (patch.lang !== undefined) {
        clearTimeout(flashTimer.current);
        setSaved('');
      } else flash(message);
      return next;
    },
  };
  return { snap, saved, savedError, props, flash };
}
