import {
  getLang,
  type I18nKey,
  isLang,
  type LangPref,
  resolveLang,
  setLang,
  setLineOverrides,
  t,
} from '../../shared/i18n/index.ts';

// 화면 말 (v2 다국어). preload 가 실행 인자에서 읽어 둔 말을 받는다. 그리기 전에 부른다.
declare global {
  interface Window {
    jjakkungLang?: string;
    jjakkungLineOverrides?: { ko?: Record<string, string>; en?: Record<string, string> };
  }
}

/** 말을 정하고 html lang 과 창 제목을 맞춘다 */
export function initLang(titleKey?: I18nKey): void {
  activeTitle = titleKey;
  const lang = window.jjakkungLang;
  setLang(isLang(lang) ? lang : 'ko');
  const mine = window.jjakkungLineOverrides;
  setLineOverrides({ ko: mine?.ko ?? {}, en: mine?.en ?? {} });
  document.documentElement.lang = getLang();
  if (titleKey) document.title = t(titleKey);
}

let activeTitle: I18nKey | undefined;

/** 설정에서 말 preference를 바꿨을 때 현재 창에 바로 반영한다. */
export function applyLangPreference(pref: LangPref): void {
  const language = resolveLang(pref, navigator.languages.length ? navigator.languages : [navigator.language]);
  setLang(language);
  document.documentElement.lang = language;
  if (activeTitle) document.title = t(activeTitle);
}
