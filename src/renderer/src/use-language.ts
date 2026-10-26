import { useEffect, useState } from 'react';
import { applyResolvedLanguage } from './lang.ts';

/** 열린 창에서 언어 변경 알림을 받고 사전을 바꾼 뒤 React 화면을 다시 그린다. */
export function useLanguageUpdates(): void {
  const [, refresh] = useState(0);
  useEffect(
    () =>
      window.jjakkungLanguage.onChanged((lang) => {
        applyResolvedLanguage(lang);
        refresh((value) => value + 1);
      }),
    [],
  );
}
