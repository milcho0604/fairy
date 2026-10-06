import { getLang, type I18nKey, isLang, setLang, t } from '../../shared/i18n/index.ts';

// 화면 말 (v2 다국어). preload 가 실행 인자에서 읽어 둔 말을 받는다. 그리기 전에 부른다.
declare global {
  interface Window {
    jjakkungLang?: string;
  }
}

/** 말을 정하고 html lang 과 창 제목을 맞춘다 */
export function initLang(titleKey?: I18nKey): void {
  const lang = window.jjakkungLang;
  setLang(isLang(lang) ? lang : 'ko');
  document.documentElement.lang = getLang();
  if (titleKey) document.title = t(titleKey);
}
